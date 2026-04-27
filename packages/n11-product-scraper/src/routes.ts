import { Actor } from 'apify';
import { load } from 'cheerio';
import { createPlaywrightRouter, log, type PlaywrightCrawlingContext } from 'crawlee';

import { RateLimiter, classifyError, getRetryDelay, shouldRetry } from '@workspace/shared';

import {
  buildProductFromDetailPage,
  extractInternalProductIdFromDetailPage,
  parseDescriptionEnrichment,
} from './parsers/detail-parser.js';
import { parseListingPage } from './parsers/search-parser.js';
import {
  RequestLabel,
  n11ProductSchema,
  type ActorInput,
  type DetailEnrichment,
  type ListingProductCandidate,
  type N11CrawlerState,
} from './types.js';

interface RouterDependencies {
  input: ActorInput;
  rateLimiter: RateLimiter;
  state: N11CrawlerState;
}

function getRequestUrl(context: Pick<PlaywrightCrawlingContext, 'request'>): string {
  return context.request.loadedUrl ?? context.request.url;
}

function shouldContinueCrawling(input: ActorInput, state: N11CrawlerState): boolean {
  return state.pushedProductIds.size < input.maxProducts;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function fetchDescriptionEnrichment(
  context: PlaywrightCrawlingContext,
  internalProductId: string | null,
  scrapeDetails: boolean,
): Promise<DetailEnrichment> {
  if (!scrapeDetails || !internalProductId) {
    return {
      description: null,
      descriptionHtml: null,
      specifications: {},
    };
  }

  try {
    const responseText = await context.page.evaluate(async (productId) => {
      const response = await fetch(`https://www.n11.com/rest/v1/getProductDescriptions/${productId}`);
      return response.ok ? await response.text() : '';
    }, internalProductId);

    if (!responseText) {
      return {
        description: null,
        descriptionHtml: null,
        specifications: {},
      };
    }

    return parseDescriptionEnrichment(responseText);
  } catch (error) {
    log.warning('Could not fetch product description enrichment.', {
      productId: internalProductId,
      error: toError(error).message,
    });

    return {
      description: null,
      descriptionHtml: null,
      specifications: {},
    };
  }
}

async function handleListingPage(
  context: PlaywrightCrawlingContext,
  dependencies: RouterDependencies,
): Promise<void> {
  if (!shouldContinueCrawling(dependencies.input, dependencies.state)) {
    log.info('Product limit reached, skipping additional listing processing.');
    return;
  }

  const requestUrl = getRequestUrl(context);

  await context.page.waitForSelector('a.product-item, .not-found-wrapper', { timeout: 15_000 }).catch(() => undefined);
  const html = await context.page.content();
  const $ = load(html);
  const parseResult = parseListingPage($, html, requestUrl);
  const remainingCapacity = dependencies.input.maxProducts - dependencies.state.enqueuedProductUrls.size;

  const detailRequests = parseResult.items
    .filter((item) => !dependencies.state.enqueuedProductUrls.has(item.productUrl))
    .slice(0, Math.max(remainingCapacity, 0))
    .map((item) => {
      dependencies.state.enqueuedProductUrls.add(item.productUrl);

      return {
        url: item.productUrl,
        uniqueKey: `detail:${item.productUrl}`,
        label: RequestLabel.DETAIL,
        userData: {
          listingCandidate: item,
        },
      };
    });

  if (detailRequests.length > 0) {
    await context.addRequests(detailRequests);
  }

  if (parseResult.nextPageUrl && shouldContinueCrawling(dependencies.input, dependencies.state)) {
    const requestLabel = context.request.label === RequestLabel.CATEGORY
      ? RequestLabel.CATEGORY
      : RequestLabel.SEARCH;

    await context.addRequests([{
      url: parseResult.nextPageUrl,
      uniqueKey: `${requestLabel}:${parseResult.nextPageUrl}`,
      label: requestLabel,
    }]);
  }

  log.info('Parsed listing page.', {
    requestUrl,
    discoveredProducts: parseResult.items.length,
    enqueuedProducts: detailRequests.length,
    nextPageUrl: parseResult.nextPageUrl,
    currentPage: parseResult.currentPage,
    pageCount: parseResult.pageCount,
  });
}

async function handleDetailPage(
  context: PlaywrightCrawlingContext,
  dependencies: RouterDependencies,
): Promise<void> {
  const requestUrl = getRequestUrl(context);
  const listingCandidate = context.request.userData.listingCandidate as ListingProductCandidate | undefined;

  if (!shouldContinueCrawling(dependencies.input, dependencies.state)) {
    log.info('Product limit reached before detail extraction.', {
      requestUrl,
    });
    return;
  }

  await context.page.waitForSelector('h1.title, .not-found-wrapper', { timeout: 15_000 }).catch(() => undefined);
  const html = await context.page.content();
  const $ = load(html);
  const internalProductId = extractInternalProductIdFromDetailPage(html, listingCandidate);
  const enrichment = await fetchDescriptionEnrichment(context, internalProductId, dependencies.input.scrapeDetails);
  const candidateRecord = buildProductFromDetailPage({
    $,
    html,
    url: requestUrl,
    listingCandidate,
    enrichment,
  });
  const validationResult = n11ProductSchema.safeParse(candidateRecord);

  if (!validationResult.success) {
    dependencies.state.errorCount += 1;
    log.warning('Skipping product because the extracted data did not pass schema validation.', {
      requestUrl,
      issues: validationResult.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    });
    return;
  }

  if (dependencies.state.pushedProductIds.has(validationResult.data.productId)) {
    return;
  }

  await Actor.pushData(validationResult.data);
  dependencies.state.pushedProductIds.add(validationResult.data.productId);
  dependencies.state.processedProductCount += 1;

  log.info(`Scraped ${dependencies.state.pushedProductIds.size}/${dependencies.input.maxProducts} products...`, {
    productId: validationResult.data.productId,
    title: validationResult.data.title,
    pushedCount: dependencies.state.pushedProductIds.size,
  });
}

export function createN11Router(dependencies: RouterDependencies) {
  const router = createPlaywrightRouter();

  router.use(async (context) => {
    const requestUrl = getRequestUrl(context);
    const domain = new URL(requestUrl).hostname;
    await dependencies.rateLimiter.wait(domain);

    const statusCode = context.response?.status() ?? null;

    if (statusCode === 429 || statusCode === 503) {
      dependencies.rateLimiter.backoff(domain);
      throw new Error(`N11 returned ${statusCode} for ${requestUrl}`);
    }

    dependencies.rateLimiter.reset(domain);
  });

  router.addHandler(RequestLabel.SEARCH, async (context) => {
    await handleListingPage(context, dependencies);
  });

  router.addHandler(RequestLabel.CATEGORY, async (context) => {
    await handleListingPage(context, dependencies);
  });

  router.addHandler(RequestLabel.DETAIL, async (context) => {
    await handleDetailPage(context, dependencies);
  });

  router.addDefaultHandler(async (context) => {
    log.warning('Received a request without a known label, defaulting to detail extraction.', {
      url: getRequestUrl(context),
      label: context.request.label,
    });

    await handleDetailPage(context, dependencies);
  });

  return router;
}

export function handleFailedRequest(
  context: PlaywrightCrawlingContext,
  error: unknown,
  state?: Pick<N11CrawlerState, 'errorCount'>,
) {
  const requestUrl = getRequestUrl(context);
  const normalizedError = toError(error);
  const errorType = classifyError(normalizedError, context.response?.status());
  if (state) {
    state.errorCount += 1;
  }

  if (shouldRetry(errorType)) {
    const retryDelay = getRetryDelay(context.request.retryCount ?? 0);
    log.warning('Request failed with a retryable error.', {
      url: requestUrl,
      errorType,
      retryDelay,
      retryCount: context.request.retryCount,
    });
    return;
  }

  log.error('Request failed and will not be retried.', {
    url: requestUrl,
    errorType,
    errorMessage: normalizedError.message,
  });
}
