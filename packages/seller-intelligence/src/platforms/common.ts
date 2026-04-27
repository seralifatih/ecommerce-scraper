import { load } from 'cheerio';
import { CheerioCrawler, log, ProxyConfiguration } from 'crawlee';
import { ProxyAgent } from 'undici';

import { cleanText } from '@workspace/shared';
import type { Platform } from '@workspace/shared';
import { normalizeForMatching } from '../utils.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

const DEFAULT_HEADERS: Record<string, string> = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'sec-ch-ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
  'user-agent': USER_AGENT,
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

function looksBlocked(text: string, html?: string): boolean {
  const normalized = normalizeForMatching(text);

  if (html) {
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const normalizedTitle = titleMatch ? normalizeForMatching(titleMatch[1] ?? '') : '';

    if (
      normalizedTitle.includes('hepsiburada | guvenlik')
      || normalizedTitle.includes('attention required')
      || normalizedTitle.includes('just a moment')
    ) {
      return true;
    }
  }

  return normalized.length < 80
    || normalized.includes('sorry, you have been blocked')
    || normalized.includes('unable to access')
    || normalized.includes('please enable cookies')
    || normalized.includes('access denied')
    || normalized.includes('captcha')
    || normalized.includes('robot dogrulamasi')
    || normalized.includes('cloudflare');
}

function shouldUseBrowserFallback(url: string, text: string, html?: string): boolean {
  if (url.includes('trendyol.com/magaza/')) {
    return true;
  }

  return looksBlocked(text, html);
}

function buildRequestHeaders(url: string): Record<string, string> {
  try {
    const parsed = new URL(url);
    const referer = `${parsed.protocol}//${parsed.hostname}/`;

    return {
      ...DEFAULT_HEADERS,
      referer,
      'sec-fetch-site': 'same-origin',
    };
  } catch {
    return { ...DEFAULT_HEADERS };
  }
}

async function resolveProxyUrl(crawler?: CheerioCrawler): Promise<string | null> {
  const proxy = crawler?.proxyConfiguration as ProxyConfiguration | undefined;

  if (!proxy) {
    return null;
  }

  try {
    return (await proxy.newUrl()) ?? null;
  } catch {
    return null;
  }
}

async function fetchDocumentWithPlaywright(url: string, proxyUrl: string | null): Promise<FetchedDocument> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    proxy: proxyUrl ? { server: proxyUrl } : undefined,
  });

  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: 'tr-TR',
      extraHTTPHeaders: {
        'accept-language': DEFAULT_HEADERS['accept-language'],
      },
    });
    const page = await context.newPage();

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
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

async function fetchDocumentDirect(url: string, proxyUrl: string | null): Promise<FetchedDocument> {
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  const response = await fetch(url, {
    headers: buildRequestHeaders(url),
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
    ...(dispatcher ? { dispatcher } : {}),
  } as RequestInit);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} with status ${response.status}.`);
  }

  const html = await response.text();
  const $ = load(html);

  return {
    html,
    $,
    text: cleanText($('body').text()),
    finalUrl: response.url,
  };
}

export async function fetchDocument(url: string, crawler?: CheerioCrawler): Promise<FetchedDocument> {
  const proxyUrl = await resolveProxyUrl(crawler);
  let directError: Error | null = null;

  try {
    const document = await fetchDocumentDirect(url, proxyUrl);

    if (!shouldUseBrowserFallback(url, document.text, document.html)) {
      return document;
    }
  } catch (error) {
    directError = toError(error);
  }

  try {
    return await fetchDocumentWithPlaywright(url, proxyUrl);
  } catch (browserError) {
    throw directError ?? toError(browserError);
  }
}

export async function fetchJson<T>(url: string, crawler?: CheerioCrawler): Promise<T | null> {
  const proxyUrl = await resolveProxyUrl(crawler);
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

  try {
    const response = await fetch(url, {
      headers: {
        ...buildRequestHeaders(url),
        accept: 'application/json,text/plain,*/*',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit);

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
