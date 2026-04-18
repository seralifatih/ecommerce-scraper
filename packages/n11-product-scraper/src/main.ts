import { Actor } from 'apify';
import { MemoryStorage } from '@crawlee/memory-storage';
import { PlaywrightCrawler, log } from 'crawlee';
import { ZodError } from 'zod';

import { RateLimiter, getProxyConfig } from '@workspace/shared';

import { createN11Router, handleFailedRequest } from './routes.js';
import {
  RequestLabel,
  actorInputSchema,
  createEmptyPlatformBreakdown,
  runSummarySchema,
  type ActorInput,
  type N11CrawlerState,
} from './types.js';

function buildStartRequests(input: ActorInput) {
  const requests: Array<{
    url: string;
    uniqueKey: string;
    label: RequestLabel;
  }> = [];

  for (const searchQuery of input.searchQueries) {
    const searchUrl = new URL('https://www.n11.com/arama');
    searchUrl.searchParams.set('q', searchQuery);
    requests.push({
      url: searchUrl.toString(),
      uniqueKey: `search:${searchQuery}`,
      label: RequestLabel.SEARCH,
    });
  }

  for (const categoryUrl of input.categoryUrls ?? []) {
    requests.push({
      url: categoryUrl,
      uniqueKey: `category:${categoryUrl}`,
      label: RequestLabel.CATEGORY,
    });
  }

  for (const productUrl of input.productUrls ?? []) {
    requests.push({
      url: productUrl,
      uniqueKey: `detail:${productUrl}`,
      label: RequestLabel.DETAIL,
    });
  }

  return requests;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function formatValidationError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
    .join('; ');
}

await Actor.init({
  storage: process.env.APIFY_IS_AT_HOME === '1'
    ? undefined
    : new MemoryStorage({
      localDataDirectory: process.env.CRAWLEE_STORAGE_DIR
        ?? process.env.APIFY_LOCAL_STORAGE_DIR
        ?? './storage',
    }),
});

let exitCode = 0;
let finalStatusMessage = 'N11 scraper run did not start.';
const startedAt = Date.now();
const crawlerState: N11CrawlerState = {
  enqueuedProductUrls: new Set(),
  pushedProductIds: new Set(),
  processedProductCount: 0,
  errorCount: 0,
};

try {
  const rawInput = (await Actor.getInput<Record<string, unknown>>()) ?? {};
  const input = actorInputSchema.parse(rawInput);
  const proxyConfiguration = await getProxyConfig(input.proxyConfig);
  const rateLimiter = new RateLimiter(2_500, 3);
  crawlerState.enqueuedProductUrls = new Set(input.productUrls ?? []);
  const router = createN11Router({
    input,
    rateLimiter,
    state: crawlerState,
  });
  const startRequests = buildStartRequests(input);

  Actor.on('migrating', async () => {
    await Actor.setValue('MIGRATION_STATE', {
      enqueuedProductCount: crawlerState.enqueuedProductUrls.size,
      pushedProductCount: crawlerState.pushedProductIds.size,
      timestamp: new Date().toISOString(),
    });

    log.info('Persisted crawler state before migration.', {
      enqueuedProductCount: crawlerState.enqueuedProductUrls.size,
      pushedProductCount: crawlerState.pushedProductIds.size,
    });
  });

  const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    requestHandler: router,
    maxRequestsPerCrawl: Math.max(startRequests.length, input.maxProducts * 4),
    maxRequestRetries: 3,
    maxConcurrency: 5,
    navigationTimeoutSecs: 90,
    requestHandlerTimeoutSecs: 120,
    preNavigationHooks: [
      async ({ page }, gotoOptions) => {
        gotoOptions.waitUntil = 'networkidle';

        await page.route('**/*', async (route) => {
          const resourceType = route.request().resourceType();

          if (resourceType === 'font' || resourceType === 'image' || resourceType === 'media') {
            await route.abort();
            return;
          }

          await route.continue();
        });
      },
    ],
    failedRequestHandler: async (context, error) => {
      handleFailedRequest(context, error, crawlerState);
    },
  });

  log.info('Starting N11 product scraper run.', {
    searchQueries: input.searchQueries?.length ?? 0,
    categoryUrls: input.categoryUrls?.length ?? 0,
    productUrls: input.productUrls?.length ?? 0,
    maxProducts: input.maxProducts,
    scrapeDetails: input.scrapeDetails,
  });

  await crawler.run(startRequests);
  finalStatusMessage = `Completed after scraping ${crawlerState.pushedProductIds.size} products from N11.`;
  await Actor.setStatusMessage(finalStatusMessage, { isStatusMessageTerminal: true });
} catch (error) {
  exitCode = 1;
  const resolvedError = toError(error);
  const message = error instanceof ZodError ? formatValidationError(error) : resolvedError.message;

  crawlerState.errorCount += 1;
  finalStatusMessage = `Failed after scraping ${crawlerState.pushedProductIds.size} products from N11.`;

  log.error('Unhandled N11 product scraper error.', {
    error: message,
    stack: resolvedError.stack,
    scrapedProducts: crawlerState.pushedProductIds.size,
    errors: crawlerState.errorCount,
  });
  log.warning('Run ended with partial completion.', {
    scrapedProducts: crawlerState.pushedProductIds.size,
    enqueuedProducts: crawlerState.enqueuedProductUrls.size,
    errors: crawlerState.errorCount,
  });

  await Actor.setStatusMessage(finalStatusMessage, { isStatusMessageTerminal: true }).catch(() => undefined);
} finally {
  const durationSeconds = Number(((Date.now() - startedAt) / 1_000).toFixed(2));
  const successfulRecords = crawlerState.pushedProductIds.size;
  const attemptedRecords = successfulRecords + crawlerState.errorCount;
  const platformBreakdown = createEmptyPlatformBreakdown();
  platformBreakdown.n11 = successfulRecords;
  const summaryRecord = runSummarySchema.parse({
    type: 'RUN_SUMMARY',
    totalRecords: successfulRecords,
    successRate: attemptedRecords === 0 ? 0 : Number((successfulRecords / attemptedRecords).toFixed(4)),
    platformBreakdown,
    durationSeconds,
    errors: crawlerState.errorCount,
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
