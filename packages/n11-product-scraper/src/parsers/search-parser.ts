import type { CheerioAPI } from 'cheerio';

import { cleanText, normalizeRating } from '@workspace/shared';

import type { ListingParseResult, ListingProductCandidate } from '../types.js';

function extractNumericValue(value: string): number | null {
  const digitsOnly = value.replace(/[^\d]/g, '');

  if (!digitsOnly) {
    return null;
  }

  return Number.parseInt(digitsOnly, 10);
}

function extractGroupProductId(productUrl: string): string | null {
  const match = productUrl.match(/-(\d+)(?:\?.*)?$/);
  return match?.[1] ?? null;
}

function extractPaginationFromHtml(html: string): { currentPage: number | null; pageCount: number | null } {
  const paginationMatch = html.match(/"pagination":\{"currentPage":(\d+).*?"pageCount":(\d+)/);

  if (!paginationMatch) {
    return {
      currentPage: null,
      pageCount: null,
    };
  }

  return {
    currentPage: Number.parseInt(paginationMatch[1], 10),
    pageCount: Number.parseInt(paginationMatch[2], 10),
  };
}

function buildNextPageUrl(currentUrl: string, currentPage: number | null, pageCount: number | null): string | null {
  if (!currentPage || !pageCount || currentPage >= pageCount) {
    return null;
  }

  const nextUrl = new URL(currentUrl);
  nextUrl.searchParams.set('pg', String(currentPage + 1));
  return nextUrl.toString();
}

function parseProductCard($: CheerioAPI, element: unknown, requestUrl: string): ListingProductCandidate | null {
  const productElement = $(element as never);
  const href = productElement.attr('href');

  if (!href) {
    return null;
  }

  const productUrl = new URL(href, requestUrl).toString();
  const title = cleanText(productElement.find('.product-item-title').first().text());

  if (!title) {
    return null;
  }

  const priceText = cleanText(productElement.find('.price-currency').first().text()) || null;
  const imageUrl = productElement.find('.listing-items-image').first().attr('src')
    ?? productElement.find('.listing-items-image').first().attr('data-src')
    ?? null;
  const ratingWidth = productElement.find('.rate-stars-active').first().attr('style') ?? '';
  const ratingWidthMatch = ratingWidth.match(/width:\s*([\d.]+)%/);
  const rating = ratingWidthMatch
    ? normalizeRating(Number.parseFloat(ratingWidthMatch[1]), 100)
    : null;
  const reviewCount = extractNumericValue(productElement.find('.rate-number-text').first().text());

  return {
    internalProductId: productElement.attr('data-prod-id') ?? null,
    productId: extractGroupProductId(productUrl) ?? productUrl,
    title,
    priceText,
    imageUrl,
    rating,
    reviewCount,
    sellerName: null,
    productUrl,
  };
}

export function parseListingPage($: CheerioAPI, html: string, requestUrl: string): ListingParseResult {
  const items: ListingProductCandidate[] = [];

  $('a.product-item').each((_, element) => {
    const parsedCard = parseProductCard($, element, requestUrl);

    if (parsedCard) {
      items.push(parsedCard);
    }
  });

  const { currentPage, pageCount } = extractPaginationFromHtml(html);

  return {
    items,
    nextPageUrl: buildNextPageUrl(requestUrl, currentPage, pageCount),
    currentPage,
    pageCount,
  };
}
