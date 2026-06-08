import { Actor, type ProxyConfiguration } from 'apify';
import { MemoryStorage } from '@crawlee/memory-storage';
import { log } from 'crawlee';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { ZodError } from 'zod';

import {
  classifyError,
  getProxyConfig,
  getRetryDelay,
  RateLimiter,
  shouldRetry,
} from '@workspace/shared';

import { scrapeReviews as scrapeN11Reviews } from './platforms/n11.js';
import {
  SEARCH_RESULTS_PER_PLATFORM,
  actorInputSchema,
  createEmptyPlatformBreakdown,
  productReviewSchema,
  runSummarySchema,
  type ActorInput,
  type PlatformScraper,
  type SentimentTag,
} from './types.js';
import {
  buildSearchUrl,
  collectSearchProductUrls,
  detectPlatformFromUrl,
  normalizeProductUrl,
} from './utils.js';
import { ensurePublicPage, getPageText } from './platforms/common.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

interface RunState {
  discoveredProductUrls: Set<string>;
  processedProductUrls: Set<string>;
  pushedReviewKeys: Set<string>;
  errorCount: number;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function formatValidationError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
    .join('; ');
}

function toPlaywrightProxy(proxyUrl: string): {
  server: string;
  username?: string;
  password?: string;
} {
  const parsedUrl = new URL(proxyUrl);

  return {
    server: `${parsedUrl.protocol}//${parsedUrl.host}`,
    username: parsedUrl.username || undefined,
    password: parsedUrl.password || undefined,
  };
}

async function createBrowserContext(proxyConfiguration?: ProxyConfiguration): Promise<{
  browser: Browser;
  context: BrowserContext;
}> {
  const proxyUrl = await proxyConfiguration?.newUrl('review_aggregator');
  const browser = await chromium.launch({
    headless: process.env.APIFY_HEADLESS === '0' ? false : true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--lang=tr-TR',
    ],
    proxy: proxyUrl ? toPlaywrightProxy(proxyUrl) : undefined,
  });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'tr-TR',
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: {
      'accept-language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  return {
    browser,
    context,
  };
}

async function discoverProductUrlsForQuery(options: {
  context: BrowserContext;
  input: ActorInput;
  rateLimiter: RateLimiter;
}): Promise<string[]> {
  const { context, input, rateLimiter } = options;
  const discoveredUrls = new Set<string>();
  const searchQuery = input.searchQuery;

  if (!searchQuery) {
    return [];
  }

  for (const platform of input.platforms) {
    const searchUrl = buildSearchUrl(platform, searchQuery);
    const page = await context.newPage();

    try {
      await rateLimiter.wait(new URL(searchUrl).hostname);
      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 120_000,
      });
      await page.waitForTimeout(8_000);

      const pageText = await getPageText(page);
      ensurePublicPage(pageText, searchUrl);

      const productUrls = collectSearchProductUrls(
        await page.content(),
        page.url(),
        platform,
        SEARCH_RESULTS_PER_PLATFORM,
      );

      if (productUrls.length === 0) {
        log.warning('No product URLs were discovered from search results.', {
          platform,
          searchQuery,
          searchUrl,
        });
      }

      for (const productUrl of productUrls) {
        discoveredUrls.add(productUrl);
      }
    } catch (error) {
      log.warning('Search discovery failed for a marketplace.', {
        platform,
        searchQuery,
        searchUrl,
        error: toError(error).message,
      });
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  return [...discoveredUrls];
}

function addSeedProductUrl(
  input: ActorInput,
  state: RunState,
  rawUrl: string,
): void {
  const platform = detectPlatformFromUrl(rawUrl);

  if (platform !== 'n11') {
    log.warning('Skipping unsupported product URL. Only N11 URLs are accepted.', { rawUrl });
    return;
  }

  if (!input.platforms.includes(platform)) {
    log.warning('Skipping product URL because its platform is not selected.', {
      platform,
      rawUrl,
    });
    return;
  }

  state.discoveredProductUrls.add(normalizeProductUrl(rawUrl));
}

const scraperByPlatform: Record<'n11', PlatformScraper> = {
  n11: scrapeN11Reviews,
};

await Actor.init({
  storage: process.env.APIFY_IS_AT_HOME === '1'
    ? undefined
    : new MemoryStorage({
      localDataDirectory: process.env.CRAWLEE_STORAGE_DIR
        ?? process.env.APIFY_LOCAL_STORAGE_DIR
        ?? './storage',
    }),
});

log.info(
  'Running N11 review scraper. Note: Trendyol and Hepsiburada were removed due to '
  + 'anti-bot protection — see separate actors for those platforms.',
);

let exitCode = 0;
let finalStatusMessage = 'Review aggregation run did not start.';
const startedAt = Date.now();
const state: RunState = {
  discoveredProductUrls: new Set(),
  processedProductUrls: new Set(),
  pushedReviewKeys: new Set(),
  errorCount: 0,
};
const platformBreakdown = createEmptyPlatformBreakdown();
const sentimentBreakdown: Record<SentimentTag, number> = {
  positive: 0,
  negative: 0,
  neutral: 0,
  mixed: 0,
};

try {
  const rawInput = (await Actor.getInput<Record<string, unknown>>()) ?? {};
  const input = actorInputSchema.parse(rawInput);
  const proxyConfiguration = await getProxyConfig(input.proxyConfig);
  const rateLimiter = new RateLimiter(2_000, 3);

  for (const productUrl of input.productUrls) {
    addSeedProductUrl(input, state, productUrl);
  }

  const needsBrowser = state.discoveredProductUrls.size > 0 || Boolean(input.searchQuery);

  if (!needsBrowser) {
    log.warning('No product URLs and no search query provided — nothing to scrape.');
    finalStatusMessage = 'Completed after collecting 0 reviews.';
    await Actor.setStatusMessage(finalStatusMessage, { isStatusMessageTerminal: true });
  } else {
  const { browser, context } = await createBrowserContext(proxyConfiguration);

  try {
    Actor.on('migrating', async () => {
      await Actor.setValue('MIGRATION_STATE', {
        discoveredProductUrls: [...state.discoveredProductUrls],
        processedProductUrls: [...state.processedProductUrls],
        pushedReviewCount: state.pushedReviewKeys.size,
        timestamp: new Date().toISOString(),
      });

      log.info('Persisted review aggregation migration state.', {
        discoveredProductCount: state.discoveredProductUrls.size,
        processedProductCount: state.processedProductUrls.size,
        pushedReviewCount: state.pushedReviewKeys.size,
      });
    });

    const discoveredFromSearch = await discoverProductUrlsForQuery({
      context,
      input,
      rateLimiter,
    });

    for (const productUrl of discoveredFromSearch) {
      addSeedProductUrl(input, state, productUrl);
    }

    const emitReview = async (review: unknown): Promise<void> => {
      const result = productReviewSchema.safeParse(review);
      const reviewObject = review !== null && typeof review === 'object'
        ? review as Record<string, unknown>
        : null;

      if (!result.success) {
        state.errorCount += 1;
        log.warning('Skipping invalid review record.', {
          productUrl: typeof reviewObject?.productUrl === 'string' ? reviewObject.productUrl : undefined,
          issues: result.error.flatten(),
        });
        return;
      }

      const reviewKey = `${result.data.platform}:${result.data.reviewId}`;

      if (state.pushedReviewKeys.has(reviewKey)) {
        return;
      }

      await Actor.pushData(result.data);
      state.pushedReviewKeys.add(reviewKey);
      platformBreakdown[result.data.platform] += 1;
      sentimentBreakdown[result.data.sentimentTag] += 1;

      log.info(
        `Reviews collected: ${state.pushedReviewKeys.size} (${sentimentBreakdown.positive} positive, ${sentimentBreakdown.negative} negative, ${sentimentBreakdown.neutral} neutral, ${sentimentBreakdown.mixed} mixed)`,
        {
          platform: result.data.platform,
          productUrl: result.data.productUrl,
        },
      );
    };

    log.info('Starting review aggregation run.', {
      platforms: input.platforms,
      directProductUrlCount: input.productUrls.length,
      discoveredProductUrlCount: state.discoveredProductUrls.size,
      hasSearchQuery: Boolean(input.searchQuery),
      maxReviewsPerProduct: input.maxReviewsPerProduct,
      minRating: input.minRating,
      sortBy: input.sortBy,
    });

    if (state.discoveredProductUrls.size === 0) {
      log.warning('No product URLs were queued for review aggregation.');
    }

    for (const productUrl of state.discoveredProductUrls) {
      const platform = detectPlatformFromUrl(productUrl);

      if (platform !== 'n11') {
        log.warning('Skipping URL because the platform is not supported.', { productUrl });
        continue;
      }

      const scraper = scraperByPlatform[platform];
      const hostname = new URL(productUrl).hostname;
      let attempt = 0;

      while (attempt <= 3) {
        const page = await context.newPage();

        try {
          await rateLimiter.wait(hostname);
          await page.goto(productUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 120_000,
          });
          await page.waitForTimeout(8_000);

          const pageText = await getPageText(page);
          ensurePublicPage(pageText, productUrl);

          await scraper({
            productUrl,
            input,
            page,
            context,
            rateLimiter,
            emitReview,
          });

          state.processedProductUrls.add(productUrl);
          rateLimiter.reset(hostname);
          break;
        } catch (error) {
          const resolvedError = toError(error);
          const errorType = classifyError(resolvedError);

          log.warning('Product review scrape failed.', {
            productUrl,
            platform,
            attempt: attempt + 1,
            errorType,
            error: resolvedError.message,
          });

          if (!shouldRetry(errorType) || attempt >= 3) {
            state.errorCount += 1;
            break;
          }

          rateLimiter.backoff(hostname);
          await sleep(getRetryDelay(attempt));
          attempt += 1;
        } finally {
          await page.close().catch(() => undefined);
        }
      }
    }
    finalStatusMessage = `Completed after collecting ${state.pushedReviewKeys.size} reviews.`;
    await Actor.setStatusMessage(finalStatusMessage, { isStatusMessageTerminal: true });
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
  } // end else (needsBrowser)
} catch (error) {
  exitCode = 1;
  const resolvedError = toError(error);
  const message = error instanceof ZodError ? formatValidationError(error) : resolvedError.message;
  state.errorCount += 1;
  finalStatusMessage = `Failed after collecting ${state.pushedReviewKeys.size} reviews.`;

  log.error('Unhandled review aggregation error.', {
    error: message,
    stack: resolvedError.stack,
    collectedReviews: state.pushedReviewKeys.size,
    processedProducts: state.processedProductUrls.size,
    errors: state.errorCount,
  });
  log.warning('Run ended with partial completion.', {
    collectedReviews: state.pushedReviewKeys.size,
    discoveredProducts: state.discoveredProductUrls.size,
    processedProducts: state.processedProductUrls.size,
    errors: state.errorCount,
  });

  await Actor.setStatusMessage(finalStatusMessage, { isStatusMessageTerminal: true }).catch(() => undefined);
} finally {
  const durationSeconds = Number(((Date.now() - startedAt) / 1_000).toFixed(2));
  const successfulRecords = state.pushedReviewKeys.size;
  const attemptedRecords = successfulRecords + state.errorCount;
  const summaryRecord = runSummarySchema.parse({
    type: 'RUN_SUMMARY',
    totalRecords: successfulRecords,
    successRate: attemptedRecords === 0 ? 0 : Number((successfulRecords / attemptedRecords).toFixed(4)),
    platformBreakdown,
    durationSeconds,
    errors: state.errorCount,
  });

  await Actor.pushData(summaryRecord).catch((error) => {
    log.warning('Could not push run summary record.', {
      error: toError(error).message,
    });
  });

  await Actor.exit({
    exitCode,
    statusMessage: finalStatusMessage,
  });
}
