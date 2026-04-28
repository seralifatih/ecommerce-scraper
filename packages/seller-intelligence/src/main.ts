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

interface TrendyolSellerCandidate {
  id?: number | string;
  sellerId?: number | string;
  name?: string;
  sellerName?: string;
  title?: string;
  url?: string;
  link?: string;
  storeUrl?: string;
}

function buildTrendyolSellerUrl(candidate: TrendyolSellerCandidate): string | null {
  const candidateUrl = candidate.url ?? candidate.link ?? candidate.storeUrl;

  if (typeof candidateUrl === 'string' && candidateUrl) {
    if (candidateUrl.startsWith('http')) {
      return candidateUrl;
    }

    return `https://www.trendyol.com${candidateUrl.startsWith('/') ? '' : '/'}${candidateUrl}`;
  }

  const id = candidate.id ?? candidate.sellerId;
  const name = candidate.name ?? candidate.sellerName ?? candidate.title;

  if (id === undefined || id === null || typeof name !== 'string' || !name) {
    return null;
  }

  const slug = name
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) {
    return null;
  }

  return `https://www.trendyol.com/magaza/${slug}-m-${id}`;
}

function extractTrendyolSellerCandidates(payload: unknown): TrendyolSellerCandidate[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const candidatePaths = [
    (data: any) => data?.result?.sellers,
    (data: any) => data?.result?.products,
    (data: any) => data?.data?.sellers,
    (data: any) => data?.sellers,
    (data: any) => data?.merchants,
    (data: any) => data?.result?.merchants,
  ];

  for (const accessor of candidatePaths) {
    const items = accessor(payload);

    if (Array.isArray(items) && items.length > 0) {
      return items as TrendyolSellerCandidate[];
    }
  }

  return [];
}

async function discoverTrendyolSellersViaApi(
  query: string,
  limit: number,
  crawler?: CheerioCrawler,
): Promise<string[]> {
  const size = Math.max(20, limit);
  // Single best-known endpoint. Multiple attempts here previously burned 5-15s
  // per run because all variants get blocked by Cloudflare on residential
  // proxies. If this one fails we fall through to the HTML SRP path.
  const endpoints = [
    `https://public-mdc.trendyol.com/discovery-web-searchgw-service/v2/api/sellers/search?keyword=${encodeURIComponent(query)}&size=${size}&culture=tr-TR&storefrontId=1`,
  ];

  for (const endpoint of endpoints) {
    const response = await fetchJson<unknown>(endpoint, crawler);

    if (!response) {
      log.info('Trendyol seller-search endpoint did not return parseable JSON.', {
        endpoint,
      });
      continue;
    }

    const candidates = extractTrendyolSellerCandidates(response);

    if (candidates.length === 0) {
      log.info('Trendyol seller-search endpoint returned no sellers.', {
        endpoint,
        topLevelKeys: Object.keys(response as Record<string, unknown>).slice(0, 8),
        responseSample: JSON.stringify(response).slice(0, 400),
      });
      continue;
    }

    const urls = candidates
      .map(buildTrendyolSellerUrl)
      .filter((value): value is string => Boolean(value));

    if (urls.length > 0) {
      return urls;
    }
  }

  return [];
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
  const HARD_TIMEOUT_MS = 35_000;
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`loadDiscoveryPage hard timeout (${HARD_TIMEOUT_MS}ms) for ${url}.`)),
      HARD_TIMEOUT_MS,
    );
  });

  const work = (async () => {
    log.info('Discovery: opening browser page.', { url });
    const page = await context.newPage();
    log.info('Discovery: page opened, navigating.', { url });

    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      });
      log.info('Discovery: navigation complete.', { url, finalUrl: page.url() });

      // Wait for the page to settle, but cap the wait so a slow/stalling site
      // can't drain the actor's budget. networkidle resolves earlier than the
      // cap on most pages.
      await Promise.race([
        page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined),
        page.waitForTimeout(5_000),
      ]);

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
  })();

  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
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
  deadline: number;
}): Promise<void> {
  const {
    requests,
    input,
    state,
    rateLimiter,
    browserContext,
    deadline,
  } = options;
  const pendingRequests = [...requests];
  const seenRequests = new Set<string>(pendingRequests.map((request) => request.uniqueKey));
  const platformFailures: Record<Platform, number> = createEmptyPlatformBreakdown();
  const skippedPlatforms = new Set<Platform>();
  const PLATFORM_FAILURE_LIMIT = 2;

  while (pendingRequests.length > 0) {
    if (Date.now() > deadline) {
      log.warning('Discovery deadline reached, abandoning remaining requests.', {
        remaining: pendingRequests.length,
      });
      return;
    }

    const request = pendingRequests.shift();

    if (!request) {
      continue;
    }

    const { label, platform, query, mode } = request.userData;

    if (skippedPlatforms.has(platform)) {
      continue;
    }

    try {
      const hostname = new URL(request.url).hostname;
      log.info('Discovery: starting request.', { url: request.url, platform, label });
      await rateLimiter.wait(hostname);

      log.info('Discovery: rate-limit cleared, loading page.', { url: request.url });
      const document = await loadDiscoveryPage(request.url, browserContext);
      log.info('Discovery: page loaded.', { url: request.url, finalUrl: document.finalUrl });
      const $ = load(document.html);
      const currentUrl = document.finalUrl;
      platformFailures[platform] = 0;

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
      platformFailures[platform] += 1;
      log.warning('Discovery request failed.', {
        url: request.url,
        platform,
        consecutiveFailures: platformFailures[platform],
        error: toError(error).message,
      });

      if (platformFailures[platform] >= PLATFORM_FAILURE_LIMIT) {
        skippedPlatforms.add(platform);
        log.warning('Skipping further discovery on platform after repeated failures.', {
          platform,
          consecutiveFailures: platformFailures[platform],
        });
      }
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
  const actorTimeoutSecs = Number.parseInt(process.env.ACTOR_TIMEOUT_SECS ?? '0', 10);
  const safetyMarginMs = 30_000;
  const overallDeadline = actorTimeoutSecs > 0
    ? startedAt + actorTimeoutSecs * 1_000 - safetyMarginMs
    : Number.POSITIVE_INFINITY;
  // Reserve at most 60% of the remaining budget for discovery so per-seller scraping has room.
  const discoveryDeadline = Number.isFinite(overallDeadline)
    ? Math.min(overallDeadline, startedAt + Math.floor((overallDeadline - startedAt) * 0.6))
    : overallDeadline;
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
        deadline: discoveryDeadline,
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
  const deadline = overallDeadline;
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
