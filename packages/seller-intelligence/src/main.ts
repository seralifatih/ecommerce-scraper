import { Actor } from 'apify';
import { MemoryStorage } from '@crawlee/memory-storage';
import { load } from 'cheerio';
import { CheerioCrawler, log } from 'crawlee';
import { ZodError } from 'zod';

import {
  classifyError,
  cleanText,
  ErrorType,
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
import { fetchJson, looksBlocked } from './platforms/common.js';

interface TrendyolSellerSearchResponse {
  result?: {
    sellers?: Array<{
      id?: number | string;
      name?: string;
      url?: string;
    }>;
  };
}

async function discoverTrendyolSellersViaApi(
  query: string,
  limit: number,
  crawler?: CheerioCrawler,
): Promise<string[]> {
  const apiUrl = `https://public-mdc.trendyol.com/discovery-web-searchgw-service/v2/api/sellers/search?keyword=${encodeURIComponent(query)}&size=${Math.max(20, limit)}&culture=tr-TR&storefrontId=1`;
  const response = await fetchJson<TrendyolSellerSearchResponse>(apiUrl, crawler);
  const sellers = response?.result?.sellers ?? [];
  const urls: string[] = [];

  for (const seller of sellers) {
    if (typeof seller.url === 'string' && seller.url) {
      const absolute = seller.url.startsWith('http')
        ? seller.url
        : `https://www.trendyol.com${seller.url.startsWith('/') ? '' : '/'}${seller.url}`;
      urls.push(absolute);
      continue;
    }

    const id = seller.id;
    const name = seller.name;

    if (id !== undefined && id !== null && typeof name === 'string' && name) {
      const slug = name
        .toLocaleLowerCase('tr-TR')
        .normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      urls.push(`https://www.trendyol.com/magaza/${slug}-m-${id}`);
    }
  }

  return urls;
}

interface DiscoveryRequest {
  url: string;
  uniqueKey: string;
  userData: DiscoveryRequestUserData;
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

async function createBrowserContext(proxyConfiguration?: Awaited<ReturnType<typeof getProxyConfig>>) {
  const { chromium } = await import('playwright');
  const proxyUrl = await proxyConfiguration?.newUrl('seller_intelligence');
  const browser = await chromium.launch({
    headless: process.env.APIFY_HEADLESS === '0' ? false : true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--lang=tr-TR',
    ],
    proxy: proxyUrl ? toPlaywrightProxy(proxyUrl) : undefined,
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
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

  return { browser, context };
}

async function loadDiscoveryPage(
  url: string,
  context: Awaited<ReturnType<typeof createBrowserContext>>['context'],
): Promise<{
  html: string;
  text: string;
  finalUrl: string;
}> {
  const page = await context.newPage();

  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });
    await page.waitForTimeout(
      url.includes('hepsiburada.com') ? 10_000 : url.includes('n11.com') ? 8_000 : 5_000,
    );

    const html = await page.content();
    const text = cleanText(await page.locator('body').innerText().catch(() => ''));

    if (looksBlocked(text, html)) {
      throw new Error(`Blocked or challenge page detected for ${url}.`);
    }

    return {
      html,
      text,
      finalUrl: page.url(),
    };
  } finally {
    await page.close().catch(() => undefined);
  }
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

async function runDiscoveryRequests(options: {
  requests: DiscoveryRequest[];
  input: ActorInput;
  state: SellerCrawlerState;
  rateLimiter: RateLimiter;
  browserContext: Awaited<ReturnType<typeof createBrowserContext>>['context'];
}): Promise<void> {
  const {
    requests,
    input,
    state,
    rateLimiter,
    browserContext,
  } = options;
  const pendingRequests = [...requests];
  const seenRequests = new Set<string>(pendingRequests.map((request) => request.uniqueKey));

  while (pendingRequests.length > 0) {
    const request = pendingRequests.shift();

    if (!request) {
      continue;
    }

    const { label, platform, query, mode } = request.userData;

    try {
      const hostname = new URL(request.url).hostname;
      await rateLimiter.wait(hostname);

      const document = await loadDiscoveryPage(request.url, browserContext);
      const $ = load(document.html);
      const currentUrl = document.finalUrl;

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

        continue;
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

        continue;
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

          const nextRequest: DiscoveryRequest = {
            url: productLink,
            uniqueKey: `${REQUEST_LABEL.HEPSIBURADA_PRODUCT}:${productLink}`,
            userData: {
              label: REQUEST_LABEL.HEPSIBURADA_PRODUCT,
              platform,
              query,
              mode,
            },
          };

          if (!seenRequests.has(nextRequest.uniqueKey)) {
            seenRequests.add(nextRequest.uniqueKey);
            pendingRequests.push(nextRequest);
          }
        }

        continue;
      }

      if (label === REQUEST_LABEL.HEPSIBURADA_PRODUCT) {
        const sellerLinks = collectSellerLinks($, currentUrl, 'hepsiburada', 3);

        for (const sellerLink of sellerLinks) {
          addSellerCandidate(state, input, sellerLink);
        }

        continue;
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

          const nextRequest: DiscoveryRequest = {
            url: productLink,
            uniqueKey: `${REQUEST_LABEL.N11_PRODUCT}:${productLink}`,
            userData: {
              label: REQUEST_LABEL.N11_PRODUCT,
              platform,
              query,
              mode,
            },
          };

          if (!seenRequests.has(nextRequest.uniqueKey)) {
            seenRequests.add(nextRequest.uniqueKey);
            pendingRequests.push(nextRequest);
          }
        }

        continue;
      }

      if (label === REQUEST_LABEL.N11_PRODUCT) {
        const sellerLinks = collectSellerLinks($, currentUrl, 'n11', 3);

        for (const sellerLink of sellerLinks) {
          addSellerCandidate(state, input, sellerLink);
        }
      }
    } catch (error) {
      state.errorCount += 1;
      log.warning('Discovery request failed.', {
        url: request.url,
        error: toError(error).message,
      });
    }
  }
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
  const { browser, context } = await createBrowserContext(proxyConfiguration);

  try {
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
      maxConcurrency: 1,
      requestHandler: async () => undefined,
    });

    log.info('Starting seller intelligence run.', {
      platforms: input.platforms,
      sellerUrlCount: input.sellerUrls.length,
      hasSearchBySeller: Boolean(input.searchBySeller),
      hasSearchByCategory: Boolean(input.searchByCategory),
      maxSellers: input.maxSellers,
    });

    if (input.searchBySeller && input.platforms.includes('trendyol')) {
      try {
        const apiSellerUrls = await discoverTrendyolSellersViaApi(
          input.searchBySeller,
          input.maxSellers,
          discoveryCrawler,
        );

        for (const sellerUrl of apiSellerUrls) {
          addSellerCandidate(state, input, sellerUrl);
        }

        log.info('Discovered Trendyol sellers via search API.', {
          query: input.searchBySeller,
          count: apiSellerUrls.length,
        });
      } catch (error) {
        log.warning('Trendyol seller search API failed, falling back to browser discovery.', {
          error: toError(error).message,
        });
      }
    }

    if (discoveryRequests.length > 0) {
      await runDiscoveryRequests({
        requests: discoveryRequests,
        input,
        state,
        rateLimiter,
        browserContext: context,
      });
    }

  const discoveredPlatformCounts = countDiscoveredPlatforms(state.discoveredSellerUrls);
  for (const platform of input.platforms) {
    log.info(`Platform: ${platform} - ${discoveredPlatformCounts[platform]} sellers found`, {
      platform,
      discoveredSellerCount: discoveredPlatformCounts[platform],
    });
  }

  const sellerUrls = [...state.discoveredSellerUrls].slice(0, input.maxSellers);
  const PER_SELLER_MAX_ATTEMPTS = 2;
  const PLATFORM_CONCURRENCY = 3;
  const PLATFORM_BLOCK_THRESHOLD = 3;
  const timeoutSecs = Number.parseInt(process.env.ACTOR_TIMEOUT_SECS ?? '0', 10);
  const safetyMarginMs = 30_000;
  const deadline = timeoutSecs > 0 ? startedAt + timeoutSecs * 1_000 - safetyMarginMs : Number.POSITIVE_INFINITY;
  const blockedCountByPlatform: Record<Platform, number> = createEmptyPlatformBreakdown();
  const skippedPlatforms = new Set<Platform>();

  const sellerUrlsByPlatform = new Map<Platform, string[]>();

  for (const sellerUrl of sellerUrls) {
    const platform = detectPlatformFromUrl(sellerUrl);

    if (!platform) {
      log.warning('Skipping seller URL because the platform could not be detected.', { sellerUrl });
      continue;
    }

    const bucket = sellerUrlsByPlatform.get(platform);

    if (bucket) {
      bucket.push(sellerUrl);
    } else {
      sellerUrlsByPlatform.set(platform, [sellerUrl]);
    }
  }

  async function scrapeOne(sellerUrl: string, platform: Platform): Promise<void> {
    if (skippedPlatforms.has(platform)) {
      return;
    }

    if (Date.now() > deadline) {
      return;
    }

    const scraper = scraperByPlatform[platform];
    const hostname = new URL(sellerUrl).hostname;

    for (let attempt = 0; attempt < PER_SELLER_MAX_ATTEMPTS; attempt += 1) {
      if (skippedPlatforms.has(platform) || Date.now() > deadline) {
        return;
      }

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
        blockedCountByPlatform[platform] = 0;
        return;
      } catch (error) {
        const resolvedError = toError(error);
        const errorType = classifyError(resolvedError);
        const isLastAttempt = attempt + 1 >= PER_SELLER_MAX_ATTEMPTS;
        const retryable = (
          shouldRetry(errorType)
          || errorType === ErrorType.BLOCKED
          || errorType === ErrorType.CAPTCHA
        ) && !isLastAttempt;

        log.warning('Seller profile scrape failed.', {
          sellerUrl,
          platform,
          attempt: attempt + 1,
          errorType,
          error: resolvedError.message,
        });

        if (errorType === ErrorType.BLOCKED || errorType === ErrorType.CAPTCHA) {
          blockedCountByPlatform[platform] += 1;

          if (blockedCountByPlatform[platform] >= PLATFORM_BLOCK_THRESHOLD) {
            skippedPlatforms.add(platform);
            log.warning('Skipping remaining sellers on platform after repeated blocks.', {
              platform,
              consecutiveBlocks: blockedCountByPlatform[platform],
            });
          }
        }

        if (!retryable) {
          state.errorCount += 1;
          return;
        }

        rateLimiter.backoff(hostname);
        await sleep(getRetryDelay(attempt));
      }
    }
  }

  async function scrapePlatformBucket(platform: Platform, urls: string[]): Promise<void> {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(PLATFORM_CONCURRENCY, urls.length) }, async () => {
      while (cursor < urls.length) {
        const index = cursor;
        cursor += 1;
        await scrapeOne(urls[index], platform);
      }
    });

    await Promise.all(workers);
  }

  if (sellerUrls.length === 0) {
    log.warning('No seller URLs were discovered for this run.');
  } else {
    await Promise.all(
      [...sellerUrlsByPlatform.entries()].map(([platform, urls]) =>
        scrapePlatformBucket(platform, urls),
      ),
    );
  }
  finalStatusMessage = `Completed after scraping ${state.pushedSellerUrls.size} seller profiles.`;
  await Actor.setStatusMessage(finalStatusMessage, { isStatusMessageTerminal: true });
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
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
