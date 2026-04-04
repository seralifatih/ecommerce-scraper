import { log } from 'crawlee';
import type { BrowserContext, Page } from 'playwright';

import { cleanText } from '@workspace/shared';
import type { Platform } from '@workspace/shared';

import { sortReviews, normalizeProductUrl } from '../utils.js';
import type {
  ActorInput,
  ProductReview,
  SortBy,
} from '../types.js';

const BLOCKED_PATTERNS = [
  'sorry, you have been blocked',
  'please enable cookies',
  'attention required',
  'captcha',
  'g\u00fcvenlik',
  'unable to access',
];

export function isBlockedText(text: string): boolean {
  const normalizedText = cleanText(text).toLowerCase();

  if (!normalizedText) {
    return true;
  }

  return BLOCKED_PATTERNS.some((pattern) => normalizedText.includes(pattern));
}

export function ensurePublicPage(text: string, url: string): void {
  if (isBlockedText(text)) {
    throw new Error(`Blocked or challenge page detected for ${url}.`);
  }
}

export async function getPageText(page: Page): Promise<string> {
  try {
    const bodyText = await page.locator('body').innerText();
    return cleanText(bodyText);
  } catch {
    return '';
  }
}

export async function readFirstText(page: Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();

      if (await locator.count()) {
        const value = cleanText(await locator.innerText());

        if (value) {
          return value;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

export async function readFirstAttribute(
  page: Page,
  selectors: string[],
  attributeName: string,
): Promise<string | null> {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();

      if (await locator.count()) {
        const value = await locator.getAttribute(attributeName);

        if (value?.trim()) {
          return value.trim();
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

export async function getCanonicalOrCurrentUrl(page: Page): Promise<string> {
  const canonicalHref = await readFirstAttribute(page, ['link[rel="canonical"]'], 'href');

  if (!canonicalHref) {
    return normalizeProductUrl(page.url());
  }

  try {
    return normalizeProductUrl(new URL(canonicalHref, page.url()).toString());
  } catch {
    return normalizeProductUrl(page.url());
  }
}

export async function loadJsonViaBrowser<T>(context: BrowserContext, url: string): Promise<T> {
  const apiPage = await context.newPage();

  try {
    const response = await apiPage.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });
    const bodyText = await apiPage.locator('body').innerText();

    if (!response) {
      throw new Error(`No response was received for ${url}.`);
    }

    if (response.status() >= 400) {
      throw new Error(`Received status ${response.status()} for ${url}.`);
    }

    if (!bodyText.trim().startsWith('{') && !bodyText.trim().startsWith('[')) {
      ensurePublicPage(bodyText, url);
      throw new Error(`Expected JSON response for ${url}.`);
    }

    return JSON.parse(bodyText) as T;
  } finally {
    await apiPage.close().catch(() => undefined);
  }
}

export async function emitSortedReviews(
  reviews: ProductReview[],
  input: ActorInput,
  emitReview: (review: ProductReview) => Promise<void>,
): Promise<number> {
  const filteredReviews = reviews.filter((review) => {
    if (input.minRating === null) {
      return true;
    }

    return review.rating >= input.minRating;
  });
  const sortedReviews = sortReviews(filteredReviews, input.sortBy);
  const limitedReviews = sortedReviews.slice(0, input.maxReviewsPerProduct);

  for (const review of limitedReviews) {
    await emitReview(review);
  }

  return limitedReviews.length;
}

export function warnMissingReviewFields(platform: Platform, productUrl: string, fields: string[]): void {
  const missingFields = fields.filter(Boolean);

  if (missingFields.length === 0) {
    return;
  }

  log.warning('Some review fields were not found for this product.', {
    platform,
    productUrl,
    missingFields,
  });
}

export function warnApproximateSort(
  platform: Platform,
  productUrl: string,
  sortBy: SortBy,
  totalCount: number | null,
  bufferSize: number,
): void {
  if (!totalCount || totalCount <= bufferSize || sortBy === 'recent') {
    return;
  }

  log.warning('Applied client-side sort with a capped review buffer.', {
    platform,
    productUrl,
    sortBy,
    totalCount,
    bufferSize,
  });
}
