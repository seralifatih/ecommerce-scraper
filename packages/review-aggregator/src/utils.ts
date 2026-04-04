import { load } from 'cheerio';

import {
  cleanText,
  parseTurkishPrice,
  turkishLowerCase,
} from '@workspace/shared';
import type { Platform } from '@workspace/shared';

import type { ProductReview, SortBy } from './types.js';

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

export function normalizeProductUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = '';
  url.search = '';
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

export function buildSearchUrl(platform: Platform, query: string): string {
  const url = new URL(
    platform === 'trendyol'
      ? 'https://www.trendyol.com/sr'
      : platform === 'hepsiburada'
        ? 'https://www.hepsiburada.com/ara'
        : 'https://www.n11.com/arama',
  );

  url.searchParams.set('q', query);
  return url.toString();
}

export function isProductUrl(candidateUrl: string, platform: Platform): boolean {
  try {
    const url = new URL(candidateUrl);

    if (platform === 'trendyol') {
      return /-p-\d+$/i.test(url.pathname);
    }

    if (platform === 'hepsiburada') {
      return /-p-[a-z0-9]+$/i.test(url.pathname);
    }

    return url.pathname.startsWith('/urun/');
  } catch {
    return false;
  }
}

export function resolveHepsiburadaTrackingUrl(candidateUrl: string): string | null {
  try {
    const url = new URL(candidateUrl);

    if (!url.hostname.includes('adservice.hepsiburada.com')) {
      return candidateUrl;
    }

    const redirectUrl = url.searchParams.get('redirect');
    return redirectUrl ? redirectUrl : null;
  } catch {
    return null;
  }
}

function looksLikeProductCard(text: string): boolean {
  const normalizedText = cleanText(text);

  if (!normalizedText) {
    return false;
  }

  try {
    parseTurkishPrice(normalizedText);
    return true;
  } catch {
    return /(?:\bTL\b|\u20ba|TRY)/i.test(normalizedText);
  }
}

export function collectSearchProductUrls(
  html: string,
  baseUrl: string,
  platform: Platform,
  limit: number,
): string[] {
  const $ = load(html);
  const links = new Set<string>();

  $('a[href]').each((_: unknown, element: unknown) => {
    if (links.size >= limit) {
      return false;
    }

    const href = $(element as any).attr('href');
    const absoluteUrl = toAbsoluteUrl(baseUrl, href);
    const resolvedUrl = absoluteUrl && platform === 'hepsiburada'
      ? resolveHepsiburadaTrackingUrl(absoluteUrl)
      : absoluteUrl;

    if (!resolvedUrl || !isProductUrl(resolvedUrl, platform)) {
      return;
    }

    const cardText = cleanText(
      $(element as any)
        .closest('article, li, div, section')
        .text(),
    );
    const anchorText = cleanText($(element as any).text());

    if (!looksLikeProductCard(cardText) && !looksLikeProductCard(anchorText)) {
      return;
    }

    links.add(normalizeProductUrl(resolvedUrl));
  });

  return [...links];
}

export function parseN11Date(rawDate: string | null | undefined, fallbackEpoch?: number | null): string | null {
  if (rawDate) {
    const match = cleanText(rawDate).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

    if (match) {
      const [, dayText, monthText, yearText] = match;
      const day = Number.parseInt(dayText, 10);
      const month = Number.parseInt(monthText, 10) - 1;
      const year = Number.parseInt(yearText, 10);

      return new Date(Date.UTC(year, month, day)).toISOString();
    }
  }

  if (typeof fallbackEpoch === 'number' && Number.isFinite(fallbackEpoch)) {
    return new Date(fallbackEpoch).toISOString();
  }

  return null;
}

export function sortReviews(reviews: ProductReview[], sortBy: SortBy): ProductReview[] {
  const sortedReviews = [...reviews];

  sortedReviews.sort((left, right) => {
    if (sortBy === 'helpful') {
      return (right.helpfulCount ?? 0) - (left.helpfulCount ?? 0)
        || Date.parse(right.reviewDate) - Date.parse(left.reviewDate);
    }

    if (sortBy === 'highest') {
      return right.rating - left.rating
        || (right.helpfulCount ?? 0) - (left.helpfulCount ?? 0)
        || Date.parse(right.reviewDate) - Date.parse(left.reviewDate);
    }

    if (sortBy === 'lowest') {
      return left.rating - right.rating
        || (right.helpfulCount ?? 0) - (left.helpfulCount ?? 0)
        || Date.parse(right.reviewDate) - Date.parse(left.reviewDate);
    }

    return Date.parse(right.reviewDate) - Date.parse(left.reviewDate);
  });

  return sortedReviews;
}

export function titleFromDocumentTitle(title: string, suffixPatterns: RegExp[]): string | null {
  const cleanedTitle = cleanText(title);

  if (!cleanedTitle) {
    return null;
  }

  let current = cleanedTitle;

  for (const pattern of suffixPatterns) {
    current = current.replace(pattern, '').trim();
  }

  return current || null;
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
