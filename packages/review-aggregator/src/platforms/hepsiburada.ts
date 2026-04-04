import { cleanText, normalizeRating } from '@workspace/shared';

import { tagSentiment } from '../sentiment.js';
import {
  collectMissingFields,
  createMissingFieldTracker,
  DATA_VERSION,
  markPresentFields,
  type PlatformScrapeParams,
  type ProductReview,
} from '../types.js';
import { normalizeProductUrl, titleFromDocumentTitle } from '../utils.js';
import {
  getPageText,
  readFirstText,
  warnMissingReviewFields,
} from './common.js';

interface HepsiburadaApprovedUserContentResponse {
  itemsPerPage?: number;
  currentItemCount?: number;
  totalItemCount?: number;
  data?: {
    approvedUserContent?: {
      approvedUserContentList?: HepsiburadaReview[];
    };
  };
}

interface HepsiburadaReview {
  id: string;
  customer?: {
    displayName?: string | null;
  } | null;
  product?: {
    sku?: string | null;
    name?: string | null;
    url?: string | null;
    variantProperties?: Array<{
      name?: string | null;
      value?: string | null;
    }> | null;
  } | null;
  order?: {
    merchantName?: string | null;
  } | null;
  review?: {
    content?: string | null;
  } | null;
  star?: number | null;
  media?: Array<{
    url?: string | null;
    fullMediaUrl?: string | null;
  }> | null;
  createdAt?: string | null;
  isPurchaseVerified?: boolean | null;
  reactions?: {
    clap?: number | null;
  } | null;
  explanation?: string | null;
}

function extractSkuFromUrl(productUrl: string): string | null {
  return productUrl.match(/-p-([a-z0-9]+)$/i)?.[1] ?? null;
}

function getApiSortParams(sortBy: PlatformScrapeParams['input']['sortBy']): Record<string, string> {
  if (sortBy === 'highest') {
    return { sortField: 'Star', sortDirection: 'Desc' };
  }

  if (sortBy === 'lowest') {
    return { sortField: 'Star', sortDirection: 'Asc' };
  }

  if (sortBy === 'helpful') {
    return { sortField: 'Helpful', sortDirection: 'Desc' };
  }

  return { sortField: 'Date', sortDirection: 'Desc' };
}

function buildApprovedUserContentsUrl(sku: string, from: number, size: number, sortBy: PlatformScrapeParams['input']['sortBy']): string {
  const url = new URL('https://user-content-gw-hermes.hepsiburada.com/queryapi/v2/ApprovedUserContents');
  const sortParams = getApiSortParams(sortBy);

  url.searchParams.set('sku', sku);
  url.searchParams.set('from', String(from));
  url.searchParams.set('size', String(size));
  url.searchParams.set('includeSiblingVariantContents', 'true');
  url.searchParams.set('sortField', sortParams.sortField);
  url.searchParams.set('sortDirection', sortParams.sortDirection);
  return url.toString();
}

async function fetchApprovedUserContents(
  url: string,
): Promise<HepsiburadaApprovedUserContentResponse> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      'accept-language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Received status ${response.status} for ${url}.`);
  }

  return await response.json() as HepsiburadaApprovedUserContentResponse;
}

function formatVariantInfo(review: HepsiburadaReview): string | null {
  const variants = review.product?.variantProperties ?? [];
  const normalizedVariants = variants
    .map((variant) => {
      const name = cleanText(variant.name ?? '');
      const value = cleanText(variant.value ?? '');

      if (!name || !value) {
        return null;
      }

      return `${name}: ${value}`;
    })
    .filter((variant): variant is string => Boolean(variant));

  return normalizedVariants.length > 0 ? normalizedVariants.join(', ') : null;
}

function mapReview(options: {
  fallbackProductTitle: string;
  fallbackProductUrl: string;
  sku: string;
  review: HepsiburadaReview;
}): ProductReview | null {
  const { fallbackProductTitle, fallbackProductUrl, review, sku } = options;
  const body = cleanText(review.review?.content ?? '');
  const rating = normalizeRating(review.star ?? 0, 5);

  if (!body || rating < 1) {
    return null;
  }

  const productUrl = review.product?.url
    ? normalizeProductUrl(review.product.url)
    : fallbackProductUrl;
  const productTitle = cleanText(review.product?.name ?? '') || fallbackProductTitle;
  const variantInfo = formatVariantInfo(review);

  return {
    scrapedAt: new Date().toISOString(),
    platform: 'hepsiburada',
    sourceUrl: productUrl,
    dataVersion: DATA_VERSION,
    productId: cleanText(review.product?.sku ?? '') || sku,
    productTitle,
    productUrl,
    reviewId: review.id,
    reviewerName: cleanText(review.customer?.displayName ?? '') || null,
    rating,
    title: cleanText(review.explanation ?? '') || null,
    body,
    reviewDate: review.createdAt ? new Date(review.createdAt).toISOString() : new Date().toISOString(),
    isVerifiedPurchase: Boolean(review.isPurchaseVerified),
    helpfulCount: typeof review.reactions?.clap === 'number' ? review.reactions.clap : null,
    reviewImages: (review.media ?? [])
      .map((mediaItem) => mediaItem.fullMediaUrl?.replace(':webp', '') ?? mediaItem.url ?? null)
      .filter((imageUrl): imageUrl is string => Boolean(imageUrl)),
    sentimentTag: tagSentiment(body, rating),
    sellerName: cleanText(review.order?.merchantName ?? '') || null,
    variantInfo,
  };
}

export async function scrapeReviews(params: PlatformScrapeParams): Promise<void> {
  const { emitReview, input, page, productUrl, rateLimiter } = params;
  const tracker = createMissingFieldTracker();
  const pageText = await getPageText(page);
  const sku = extractSkuFromUrl(productUrl);
  const fallbackTitle = await readFirstText(page, ['h1'])
    ?? titleFromDocumentTitle(await page.title(), [
      /\s+Fiyatlar[\u0131i],?\s+Modelleri.*$/i,
      /\s+\|\s+Hepsiburada$/i,
    ])
    ?? sku
    ?? productUrl;

  if (!sku) {
    throw new Error(`Could not determine Hepsiburada SKU from ${productUrl}.`);
  }

  if (pageText.toLowerCase().includes('g\u00fcvenlik')) {
    throw new Error(`Security page detected for ${productUrl}.`);
  }

  const pageSize = Math.min(25, Math.max(10, input.maxReviewsPerProduct));
  let from = 0;
  let emittedCount = 0;
  let totalItemCount = 0;

  while (emittedCount < input.maxReviewsPerProduct) {
    const apiUrl = buildApprovedUserContentsUrl(sku, from, pageSize, input.sortBy);

    await rateLimiter.wait(new URL(apiUrl).hostname);

    const payload = await fetchApprovedUserContents(apiUrl);
    const rawReviews = payload.data?.approvedUserContent?.approvedUserContentList ?? [];

    totalItemCount = payload.totalItemCount ?? totalItemCount;

    if (rawReviews.length === 0) {
      break;
    }

    for (const rawReview of rawReviews) {
      const mappedReview = mapReview({
        fallbackProductTitle: fallbackTitle,
        fallbackProductUrl: normalizeProductUrl(productUrl),
        sku,
        review: rawReview,
      });

      if (!mappedReview) {
        continue;
      }

      markPresentFields(tracker, mappedReview);

      if (input.minRating !== null && mappedReview.rating < input.minRating) {
        continue;
      }

      await emitReview(mappedReview);
      emittedCount += 1;

      if (emittedCount >= input.maxReviewsPerProduct) {
        break;
      }
    }

    from += rawReviews.length;

    if (from >= totalItemCount) {
      break;
    }
  }

  warnMissingReviewFields('hepsiburada', normalizeProductUrl(productUrl), collectMissingFields(tracker));
}
