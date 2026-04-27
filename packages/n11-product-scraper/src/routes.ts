import { Actor } from 'apify';
import { load } from 'cheerio';
import { createCheerioRouter, log, type CheerioCrawlingContext, type ProxyConfiguration } from 'crawlee';
import { ProxyAgent } from 'undici';

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
  proxyConfiguration?: ProxyConfiguration;
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

function getRequestUrl(context: Pick<CheerioCrawlingContext, 'request'>): string {
  return context.request.loadedUrl ?? context.request.url;
}

function shouldContinueCrawling(input: ActorInput, state: N11CrawlerState): boolean {
  return state.pushedProductIds.size < input.maxProducts;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function fetchDescriptionEnrichment(
  internalProductId: string | null,
  scrapeDetails: boolean,
  proxyConfiguration?: ProxyConfiguration,
): Promise<DetailEnrichment> {
  if (!scrapeDetails || !internalProductId) {
    return {
      description: null,
      descriptionHtml: null,
      specifications: {},
    };
  }

  try {
    const proxyUrl = proxyConfiguration ? (await proxyConfiguration.newUrl()) ?? null : null;
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
    const response = await fetch(`https://www.n11.com/rest/v1/getProductDescriptions/${internalProductId}`, {
      headers: {
        accept: 'application/json,text/plain,*/*',
        'accept-language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'user-agent': USER_AGENT,
        referer: 'https://www.n11.com/',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit);

    if (!response.ok) {
      return {
        description: null,
        descriptionHtml: null,
        specifications: {},
      };
    }

    const responseText = await response.text();

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
  context: CheerioCrawlingContext,
  dependencies: RouterDependencies,
): Promise<void> {
  if (!shouldContinueCrawling(dependencies.input, dependencies.state)) {
    log.info('Product limit reached, skipping additional listing processing.');
    return;
  }

  const requestUrl = getRequestUrl(context);
  const html = context.body.toString();
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
  context: CheerioCrawlingContext,
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

  const html = context.body.toString();
  const $ = load(html);
  const internalProductId = extractInternalProductIdFromDetailPage(html, listingCandidate);
  const enrichment = await fetchDescriptionEnrichment(
    internalProductId,
    dependencies.input.scrapeDetails,
    dependencies.proxyConfiguration,
  );
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
  const router = createCheerioRouter();

  router.use(async (context) => {
    const requestUrl = getRequestUrl(context);
    const domain = new URL(requestUrl).hostname;
    await dependencies.rateLimiter.wait(domain);

    const statusCode = context.response?.statusCode ?? null;

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
  context: CheerioCrawlingContext,
  error: unknown,
  state?: Pick<N11CrawlerState, 'errorCount'>,
) {
  const requestUrl = getRequestUrl(context);
  const normalizedError = toError(error);
  const errorType = classifyError(normalizedError, context.response?.statusCode);
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
