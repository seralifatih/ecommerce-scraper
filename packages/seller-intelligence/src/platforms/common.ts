import { load } from 'cheerio';
import { CheerioCrawler, log } from 'crawlee';

import { cleanText } from '@workspace/shared';
import type { Platform } from '@workspace/shared';
import { normalizeForMatching } from '../utils.js';

const DEFAULT_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
};

export interface FetchedDocument {
  html: string;
  $: any;
  text: string;
  finalUrl: string;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function looksBlocked(text: string): boolean {
  const normalized = normalizeForMatching(text);

  return normalized.length < 80
    || normalized.includes('sorry, you have been blocked')
    || normalized.includes('unable to access')
    || normalized.includes('please enable cookies')
    || normalized.includes('guvenlik')
    || normalized.includes('access denied')
    || normalized.includes('captcha');
}

function shouldUseBrowserFallback(url: string, text: string): boolean {
  if (url.includes('trendyol.com/magaza/')) {
    return true;
  }

  if (looksBlocked(text)) {
    return true;
  }

  return false;
}

async function fetchDocumentWithPlaywright(url: string): Promise<FetchedDocument> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent: DEFAULT_HEADERS['user-agent'],
      locale: 'tr-TR',
    });
    const page = await context.newPage();

    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });

    const html = await page.content();
    const $ = load(html);
    const text = cleanText(await page.locator('body').innerText());

    return {
      html,
      $,
      text,
      finalUrl: page.url(),
    };
  } finally {
    await browser.close();
  }
}

export async function fetchDocument(url: string, crawler?: CheerioCrawler): Promise<FetchedDocument> {
  let crawlerDocument: FetchedDocument | null = null;
  let crawlerError: Error | null = null;

  if (crawler) {
    const singlePageCrawler = new CheerioCrawler({
      proxyConfiguration: crawler.proxyConfiguration,
      maxRequestsPerCrawl: 1,
      maxRequestRetries: 0,
      requestHandlerTimeoutSecs: 30,
      requestHandler: async ({ $, body, request }) => {
        crawlerDocument = {
          html: typeof body === 'string' ? body : String(body),
          $,
          text: cleanText($('body').text()),
          finalUrl: request.loadedUrl ?? request.url,
        };
      },
      failedRequestHandler: async ({ request }, error) => {
        crawlerError = error instanceof Error
          ? error
          : new Error(`Failed to fetch ${request.url}.`);
      },
    });

    await singlePageCrawler.run([url]);

    const capturedDocument = crawlerDocument as FetchedDocument | null;

    if (capturedDocument && !shouldUseBrowserFallback(url, capturedDocument.text)) {
      return capturedDocument;
    }

    if (crawlerError) {
      try {
        return await fetchDocumentWithPlaywright(url);
      } catch {
        throw crawlerError;
      }
    }
  }

  try {
    const response = await fetch(url, {
      headers: DEFAULT_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url} with status ${response.status}.`);
    }

    const html = await response.text();
    const $ = load(html);

    const document = {
      html,
      $,
      text: cleanText($('body').text()),
      finalUrl: response.url,
    };
 
    if (shouldUseBrowserFallback(url, document.text)) {
      throw new Error(`Blocked response detected for ${url}.`);
    }

    return document;
  } catch (error) {
    try {
      return await fetchDocumentWithPlaywright(url);
    } catch {
      throw toError(error);
    }
  }
}

export async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: {
        ...DEFAULT_HEADERS,
        accept: 'application/json,text/plain,*/*',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      return null;
    }

    return await response.json() as T;
  } catch {
    return null;
  }
}

export function pickFirstText($: any, selectors: string[]): string | null {
  for (const selector of selectors) {
    const value = cleanText($(selector).first().text());

    if (value) {
      return value;
    }
  }

  return null;
}

export function pickFirstAttribute(
  $: any,
  selectors: string[],
  attributeName: string,
): string | null {
  for (const selector of selectors) {
    const value = $(selector).first().attr(attributeName);

    if (value) {
      return value.trim();
    }
  }

  return null;
}

export function extractBadges(text: string, candidates: string[]): string[] {
  const badges = new Set<string>();

  for (const candidate of candidates) {
    if (text.includes(candidate)) {
      badges.add(candidate);
    }
  }

  return [...badges];
}

export function warnMissingFields(platform: Platform, sellerUrl: string, fields: string[]): void {
  const missingFields = fields.filter(Boolean);

  if (missingFields.length === 0) {
    return;
  }

  log.warning('Some seller fields were not found on the page.', {
    platform,
    sellerUrl,
    missingFields,
  });
}
