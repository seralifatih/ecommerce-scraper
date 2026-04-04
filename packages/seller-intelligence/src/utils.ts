import {
  cleanText,
  generateSlug,
  parseTurkishPrice,
  turkishLowerCase,
} from '@workspace/shared';
import type { Platform } from '@workspace/shared';

const MONTH_INDEX: Record<string, number> = {
  ocak: 0,
  subat: 1,
  mart: 2,
  nisan: 3,
  mayis: 4,
  haziran: 5,
  temmuz: 6,
  agustos: 7,
  eylul: 8,
  ekim: 9,
  kasim: 10,
  aralik: 11,
};

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeForMatching(text: string): string {
  return turkishLowerCase(cleanText(text))
    .replace(/\u015f/g, 's')
    .replace(/\u011f/g, 'g')
    .replace(/\u00fc/g, 'u')
    .replace(/\u00f6/g, 'o')
    .replace(/\u0131/g, 'i')
    .replace(/\u00e7/g, 'c');
}

export function detectPlatformFromUrl(rawUrl: string): Platform | null {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.replace(/^www\./i, '').toLowerCase();

    if (hostname.endsWith('trendyol.com')) {
      return 'trendyol';
    }

    if (hostname.endsWith('hepsiburada.com')) {
      return 'hepsiburada';
    }

    if (hostname.endsWith('n11.com')) {
      return 'n11';
    }

    return null;
  } catch {
    return null;
  }
}

export function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = '';

  if (url.pathname.startsWith('/magaza/')) {
    url.search = '';
  }

  return url.toString();
}

export function toAbsoluteUrl(baseUrl: string, href: string | undefined | null): string | null {
  if (!href) {
    return null;
  }

  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

export function isSellerUrl(candidateUrl: string, platform: Platform): boolean {
  try {
    const url = new URL(candidateUrl);
    const segments = url.pathname.split('/').filter(Boolean);

    if (segments[0] !== 'magaza' || segments.length < 2) {
      return false;
    }

    if (platform === 'trendyol') {
      return /-m-\d+$/i.test(segments[1] ?? '');
    }

    if (platform === 'n11') {
      return segments[1] !== 'kampanyalar';
    }

    return true;
  } catch {
    return false;
  }
}

export function isProductUrl(candidateUrl: string, platform: Platform): boolean {
  try {
    const url = new URL(candidateUrl);

    if (platform === 'trendyol') {
      return /\/(?:pd|[a-z0-9-]+)\/.+-p-\d+/i.test(url.pathname);
    }

    if (platform === 'hepsiburada') {
      return /-p-[a-z0-9]+$/i.test(url.pathname);
    }

    return url.pathname.startsWith('/urun/');
  } catch {
    return false;
  }
}

export function parseCompactCount(rawText: string | null | undefined): number | null {
  if (!rawText) {
    return null;
  }

  const text = cleanText(rawText)
    .replaceAll('\u2022', ' ')
    .replaceAll('\u00b7', ' ');
  const match = text.match(/(\d+(?:[.,]\d+)?)(?:\s*)([bmk]|bin|milyon)?/i);

  if (!match) {
    return null;
  }

  const numericPart = match[1];
  const suffix = normalizeForMatching(match[2] ?? '');

  if (!suffix) {
    const digitsOnly = numericPart.replace(/\D/g, '');
    return digitsOnly ? Number.parseInt(digitsOnly, 10) : null;
  }

  let value = Number.parseFloat(numericPart.replace(',', '.'));

  if (Number.isNaN(value)) {
    return null;
  }

  if (suffix === 'b' || suffix === 'bin' || suffix === 'k') {
    value *= 1_000;
  } else if (suffix === 'm' || suffix === 'milyon') {
    value *= 1_000_000;
  }

  return Math.round(value);
}

export function parseTurkishDate(rawText: string | null | undefined): string | null {
  if (!rawText) {
    return null;
  }

  const text = cleanText(rawText);
  const numericDateMatch = text.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);

  if (numericDateMatch) {
    const day = Number.parseInt(numericDateMatch[1], 10);
    const month = Number.parseInt(numericDateMatch[2], 10) - 1;
    const year = Number.parseInt(numericDateMatch[3], 10);
    return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
  }

  const normalized = normalizeForMatching(text);
  const monthDateMatch = normalized.match(
    /(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\s+(\d{4})/,
  );

  if (!monthDateMatch) {
    return null;
  }

  const monthIndex = MONTH_INDEX[monthDateMatch[1]];
  const year = Number.parseInt(monthDateMatch[2], 10);

  if (monthIndex === undefined || Number.isNaN(year)) {
    return null;
  }

  return new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 10);
}

export function extractFirstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();

    if (value) {
      return cleanText(value);
    }
  }

  return null;
}

export function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase('tr-TR') + part.slice(1))
    .join(' ');
}

export function matchesSellerQuery(candidate: string, query: string): boolean {
  const normalizedCandidate = normalizeForMatching(candidate);
  const normalizedQuery = normalizeForMatching(query);

  return normalizedCandidate.includes(normalizedQuery)
    || normalizedQuery.includes(normalizedCandidate);
}

export function buildGuessedSellerUrl(platform: Platform, sellerName: string): string | null {
  const slug = generateSlug(sellerName);

  if (!slug) {
    return null;
  }

  if (platform === 'hepsiburada') {
    return `https://www.hepsiburada.com/magaza/${slug}`;
  }

  if (platform === 'n11') {
    return `https://www.n11.com/magaza/${slug}`;
  }

  return null;
}

export function collectSellerLinks(
  $: any,
  baseUrl: string,
  platform: Platform,
  limit: number,
): string[] {
  const links = new Set<string>();

  $('a[href]').each((_: unknown, element: unknown) => {
    if (links.size >= limit) {
      return false;
    }

    const href = $(element).attr('href');
    const absoluteUrl = toAbsoluteUrl(baseUrl, href);

    if (!absoluteUrl || !isSellerUrl(absoluteUrl, platform)) {
      return;
    }

    links.add(normalizeUrl(absoluteUrl));
  });

  return [...links];
}

export function collectProductLinks(
  $: any,
  baseUrl: string,
  platform: Platform,
  limit: number,
): string[] {
  const links = new Set<string>();

  $('a[href]').each((_: unknown, element: unknown) => {
    if (links.size >= limit) {
      return false;
    }

    const href = $(element).attr('href');
    const absoluteUrl = toAbsoluteUrl(baseUrl, href);

    if (!absoluteUrl || !isProductUrl(absoluteUrl, platform)) {
      return;
    }

    const cardText = cleanText($(element).closest('article, li, div').text());

    try {
      parseTurkishPrice(cardText);
      links.add(absoluteUrl);
    } catch {
      // Ignore non-product links that happen to match the URL pattern.
    }
  });

  return [...links];
}
