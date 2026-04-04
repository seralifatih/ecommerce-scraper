import { Actor } from 'apify';
import { MemoryStorage } from '@crawlee/memory-storage';
import { CheerioCrawler, log } from 'crawlee';
import { ZodError } from 'zod';

import {
  classifyError,
  getProxyConfig,
  getRetryDelay,
  RateLimiter,
  shouldRetry,
} from '@workspace/shared';
import type { Platform } from '@workspace/shared';

import { scrapeSeller as scrapeHepsiburadaSeller } from './platforms/hepsiburada.js';
import { scrapeSeller as scrapeN11Seller } from './platforms/n11.js';
import { scrapeSeller as scrapeTrendyolSeller } from './platforms/trendyol.js';
import {
  actorInputSchema,
  createEmptyPlatformBreakdown,
  REQUEST_LABEL,
  runSummarySchema,
  sellerProfileSchema,
  type ActorInput,
  type DiscoveryRequestUserData,
  type SellerCrawlerState,
} from './types.js';
import {
  buildGuessedSellerUrl,
  collectProductLinks,
  collectSellerLinks,
  detectPlatformFromUrl,
  matchesSellerQuery,
  normalizeUrl,
} from './utils.js';

interface DiscoveryRequest {
  url: string;
  uniqueKey: string;
  userData: DiscoveryRequestUserData;
}

const scraperByPlatform: Record<Platform, typeof scrapeTrendyolSeller> = {
  trendyol: scrapeTrendyolSeller,
  hepsiburada: scrapeHepsiburadaSeller,
  n11: scrapeN11Seller,
};

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function formatValidationError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
    .join('; ');
}

function countDiscoveredPlatforms(urls: Iterable<string>): Record<Platform, number> {
  const counts = createEmptyPlatformBreakdown();

  for (const sellerUrl of urls) {
    const platform = detectPlatformFromUrl(sellerUrl);

    if (platform) {
      counts[platform] += 1;
    }
  }

  return counts;
}

function addSellerCandidate(
  state: SellerCrawlerState,
  input: ActorInput,
  sellerUrl: string,
): void {
  const platform = detectPlatformFromUrl(sellerUrl);

  if (!platform || !input.platforms.includes(platform)) {
    return;
  }

  state.discoveredSellerUrls.add(normalizeUrl(sellerUrl));
}

function buildDiscoveryRequests(input: ActorInput, state: SellerCrawlerState): DiscoveryRequest[] {
  const requests: DiscoveryRequest[] = [];
  const pushRequest = (request: DiscoveryRequest) => {
    requests.push(request);
  };

  for (const sellerUrl of input.sellerUrls) {
    addSellerCandidate(state, input, sellerUrl);
  }

  if (input.searchBySeller) {
    if (input.platforms.includes('trendyol')) {
      const searchUrl = new URL('https://www.trendyol.com/sr');
      searchUrl.searchParams.set('q', input.searchBySeller);
      pushRequest({
        url: searchUrl.toString(),
        uniqueKey: `seller:trendyol:${input.searchBySeller}`,
        userData: {
          label: REQUEST_LABEL.TRENDYOL_SEARCH,
          platform: 'trendyol',
          mode: 'seller',
          query: input.searchBySeller,
        },
      });
    }

    if (input.platforms.includes('hepsiburada')) {
      const guessedSellerUrl = buildGuessedSellerUrl('hepsiburada', input.searchBySeller);

      if (guessedSellerUrl) {
        addSellerCandidate(state, input, guessedSellerUrl);
      }

      const letter = input.searchBySeller.charAt(0).toLocaleLowerCase('tr-TR');
      pushRequest({
        url: `https://www.hepsiburada.com/magaza?filter=${encodeURIComponent(letter)}`,
        uniqueKey: `seller:hepsiburada:directory:${letter}`,
        userData: {
          label: REQUEST_LABEL.HEPSIBURADA_DIRECTORY,
          platform: 'hepsiburada',
          mode: 'seller',
          query: input.searchBySeller,
        },
      });
    }

    if (input.platforms.includes('n11')) {
      const guessedSellerUrl = buildGuessedSellerUrl('n11', input.searchBySeller);

      if (guessedSellerUrl) {
        addSellerCandidate(state, input, guessedSellerUrl);
      }

      const searchUrl = new URL('https://www.n11.com/arama');
      searchUrl.searchParams.set('q', input.searchBySeller);
      pushRequest({
        url: searchUrl.toString(),
        uniqueKey: `seller:n11:${input.searchBySeller}`,
        userData: {
          label: REQUEST_LABEL.N11_SEARCH,
          platform: 'n11',
          mode: 'seller',
          query: input.searchBySeller,
        },
      });
    }
  }

  if (input.searchByCategory) {
    if (input.platforms.includes('trendyol')) {
      const searchUrl = new URL('https://www.trendyol.com/sr');
      searchUrl.searchParams.set('q', input.searchByCategory);
      pushRequest({
        url: searchUrl.toString(),
        uniqueKey: `category:trendyol:${input.searchByCategory}`,
        userData: {
          label: REQUEST_LABEL.TRENDYOL_SEARCH,
          platform: 'trendyol',
          mode: 'category',
          query: input.searchByCategory,
        },
      });
    }

    if (input.platforms.includes('hepsiburada')) {
      const searchUrl = new URL('https://www.hepsiburada.com/ara');
      searchUrl.searchParams.set('q', input.searchByCategory);
      pushRequest({
        url: searchUrl.toString(),
        uniqueKey: `category:hepsiburada:${input.searchByCategory}`,
        userData: {
          label: REQUEST_LABEL.HEPSIBURADA_SEARCH,
          platform: 'hepsiburada',
          mode: 'category',
          query: input.searchByCategory,
        },
      });
    }

    if (input.platforms.includes('n11')) {
      const searchUrl = new URL('https://www.n11.com/arama');
      searchUrl.searchParams.set('q', input.searchByCategory);
      pushRequest({
        url: searchUrl.toString(),
        uniqueKey: `category:n11:${input.searchByCategory}`,
        userData: {
          label: REQUEST_LABEL.N11_SEARCH,
          platform: 'n11',
          mode: 'category',
          query: input.searchByCategory,
        },
      });
    }
  }

  return requests;
}

function addDiscoveredProduct(
  state: SellerCrawlerState,
  productUrl: string,
): boolean {
  if (state.discoveredProductUrls.has(productUrl)) {
    return false;
  }

  state.discoveredProductUrls.add(productUrl);
  return true;
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
let finalStatusMessage = 'Seller intelligence run did not start.';
const startedAt = Date.now();
const state: SellerCrawlerState = {
  discoveredSellerUrls: new Set(),
  discoveredProductUrls: new Set(),
  pushedSellerUrls: new Set(),
  errorCount: 0,
};
const platformBreakdown = createEmptyPlatformBreakdown();

try {
  const rawInput = (await Actor.getInput<Record<string, unknown>>()) ?? {};
  const input = actorInputSchema.parse(rawInput);
  const proxyConfiguration = await getProxyConfig(input.proxyConfig);
  const rateLimiter = new RateLimiter(2_000, 3);
  const discoveryRequests = buildDiscoveryRequests(input, state);

  Actor.on('migrating', async () => {
    await Actor.setValue('MIGRATION_STATE', {
      discoveredSellerCount: state.discoveredSellerUrls.size,
      discoveredProductCount: state.discoveredProductUrls.size,
      pushedSellerCount: state.pushedSellerUrls.size,
      timestamp: new Date().toISOString(),
    });

    log.info('Persisted seller intelligence migration state.', {
      discoveredSellerCount: state.discoveredSellerUrls.size,
      discoveredProductCount: state.discoveredProductUrls.size,
      pushedSellerCount: state.pushedSellerUrls.size,
    });
  });

  const discoveryCrawler = new CheerioCrawler({
    proxyConfiguration,
    maxConcurrency: 5,
    maxRequestRetries: 2,
    maxRequestsPerCrawl: Math.max(discoveryRequests.length, input.maxSellers * 6),
    useSessionPool: true,
    requestHandlerTimeoutSecs: 90,
    requestHandler: async ({ $, request, enqueueLinks }) => {
      const { label, platform, query, mode } = request.userData as DiscoveryRequestUserData;
      const currentUrl = request.loadedUrl ?? request.url;
      const hostname = new URL(currentUrl).hostname;

      await rateLimiter.wait(hostname);

      if (label === REQUEST_LABEL.TRENDYOL_SEARCH) {
        const sellerLinks = collectSellerLinks($, currentUrl, platform, input.maxSellers * 2);

        if (sellerLinks.length === 0) {
          log.warning('No Trendyol seller links were discovered from the search page.', {
            query,
            mode,
            url: currentUrl,
          });
        }

        for (const sellerLink of sellerLinks) {
          addSellerCandidate(state, input, sellerLink);
        }

        return;
      }

      if (label === REQUEST_LABEL.HEPSIBURADA_DIRECTORY) {
        $('a[href*="/magaza/"]').each((_: unknown, element: unknown) => {
          const href = $(element as any).attr('href');
          const absoluteUrl = href ? new URL(href, currentUrl).toString() : null;
          const sellerText = $(element as any).text();

          if (!absoluteUrl || !matchesSellerQuery(sellerText, query)) {
            return;
          }

          addSellerCandidate(state, input, absoluteUrl);
        });

        return;
      }

      if (label === REQUEST_LABEL.HEPSIBURADA_SEARCH) {
        const sellerLinks = collectSellerLinks($, currentUrl, platform, input.maxSellers * 2);

        for (const sellerLink of sellerLinks) {
          addSellerCandidate(state, input, sellerLink);
        }

        const productLinks = collectProductLinks($, currentUrl, platform, input.maxSellers * 2);

        for (const productLink of productLinks) {
          if (!addDiscoveredProduct(state, productLink)) {
            continue;
          }

          await enqueueLinks({
            urls: [productLink],
            userData: {
              label: REQUEST_LABEL.HEPSIBURADA_PRODUCT,
              platform,
              query,
              mode,
            } satisfies DiscoveryRequestUserData,
          });
        }

        return;
      }

      if (label === REQUEST_LABEL.HEPSIBURADA_PRODUCT) {
        const sellerLinks = collectSellerLinks($, currentUrl, 'hepsiburada', 3);

        for (const sellerLink of sellerLinks) {
          addSellerCandidate(state, input, sellerLink);
        }

        return;
      }

      if (label === REQUEST_LABEL.N11_SEARCH) {
        const sellerLinks = collectSellerLinks($, currentUrl, platform, input.maxSellers);

        for (const sellerLink of sellerLinks) {
          addSellerCandidate(state, input, sellerLink);
        }

        const productLinks = collectProductLinks($, currentUrl, platform, input.maxSellers * 2);

        for (const productLink of productLinks) {
          if (!addDiscoveredProduct(state, productLink)) {
            continue;
          }

          await enqueueLinks({
            urls: [productLink],
            userData: {
              label: REQUEST_LABEL.N11_PRODUCT,
              platform,
              query,
              mode,
            } satisfies DiscoveryRequestUserData,
          });
        }

        return;
      }

      if (label === REQUEST_LABEL.N11_PRODUCT) {
        const sellerLinks = collectSellerLinks($, currentUrl, 'n11', 3);

        for (const sellerLink of sellerLinks) {
          addSellerCandidate(state, input, sellerLink);
        }
      }
    },
    failedRequestHandler: async ({ request }, error) => {
      state.errorCount += 1;
      log.warning('Discovery request failed.', {
        url: request.url,
        error: toError(error).message,
      });
    },
  });

  log.info('Starting seller intelligence run.', {
    platforms: input.platforms,
    sellerUrlCount: input.sellerUrls.length,
    hasSearchBySeller: Boolean(input.searchBySeller),
    hasSearchByCategory: Boolean(input.searchByCategory),
    maxSellers: input.maxSellers,
  });

  if (discoveryRequests.length > 0) {
    await discoveryCrawler.run(discoveryRequests);
  }

  const discoveredPlatformCounts = countDiscoveredPlatforms(state.discoveredSellerUrls);
  for (const platform of input.platforms) {
    log.info(`Platform: ${platform} - ${discoveredPlatformCounts[platform]} sellers found`, {
      platform,
      discoveredSellerCount: discoveredPlatformCounts[platform],
    });
  }

  const sellerUrls = [...state.discoveredSellerUrls].slice(0, input.maxSellers);

  if (sellerUrls.length === 0) {
    log.warning('No seller URLs were discovered for this run.');
  } else {
    for (const sellerUrl of sellerUrls) {
      const platform = detectPlatformFromUrl(sellerUrl);

      if (!platform) {
        log.warning('Skipping seller URL because the platform could not be detected.', { sellerUrl });
        continue;
      }

      const scraper = scraperByPlatform[platform];
      const hostname = new URL(sellerUrl).hostname;
      let attempt = 0;

      while (attempt <= 3) {
        await rateLimiter.wait(hostname);

        try {
          const profile = await scraper(sellerUrl, discoveryCrawler);
          const validatedProfile = sellerProfileSchema.parse(profile);

          if (!state.pushedSellerUrls.has(validatedProfile.sellerUrl)) {
            await Actor.pushData(validatedProfile);
            state.pushedSellerUrls.add(validatedProfile.sellerUrl);
            platformBreakdown[validatedProfile.platform] += 1;

            log.info(`Scraped ${state.pushedSellerUrls.size}/${sellerUrls.length} sellers...`, {
              platform: validatedProfile.platform,
              sellerName: validatedProfile.sellerName,
            });
          }

          rateLimiter.reset(hostname);
          break;
        } catch (error) {
          const resolvedError = toError(error);
          const errorType = classifyError(resolvedError);

          log.warning('Seller profile scrape failed.', {
            sellerUrl,
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
        }
      }
    }
  }
  finalStatusMessage = `Completed after scraping ${state.pushedSellerUrls.size} seller profiles.`;
  await Actor.setStatusMessage(finalStatusMessage, { isStatusMessageTerminal: true });
} catch (error) {
  exitCode = 1;
  const resolvedError = toError(error);
  const message = error instanceof ZodError ? formatValidationError(error) : resolvedError.message;
  state.errorCount += 1;
  finalStatusMessage = `Failed after scraping ${state.pushedSellerUrls.size} seller profiles.`;

  log.error('Unhandled seller intelligence error.', {
    error: message,
    stack: resolvedError.stack,
    scrapedSellers: state.pushedSellerUrls.size,
    errors: state.errorCount,
  });
  log.warning('Run ended with partial completion.', {
    scrapedSellers: state.pushedSellerUrls.size,
    discoveredSellers: state.discoveredSellerUrls.size,
    errors: state.errorCount,
  });

  await Actor.setStatusMessage(finalStatusMessage, { isStatusMessageTerminal: true }).catch(() => undefined);
} finally {
  const durationSeconds = Number(((Date.now() - startedAt) / 1_000).toFixed(2));
  const successfulRecords = state.pushedSellerUrls.size;
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
