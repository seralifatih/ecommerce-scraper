import { cleanText, normalizeRating } from '@workspace/shared';

import { tagSentiment } from '../sentiment.js';
import {
  collectMissingFields,
  createMissingFieldTracker,
  DATA_VERSION,
  markPresentFields,
  MAX_CLIENT_SORT_BUFFER,
  type PlatformScrapeParams,
  type ProductReview,
} from '../types.js';
import { titleFromDocumentTitle } from '../utils.js';
import {
  emitSortedReviews,
  getCanonicalOrCurrentUrl,
  getPageText,
  loadJsonViaBrowser,
  readFirstText,
  warnApproximateSort,
  warnMissingReviewFields,
} from './common.js';

interface TrendyolReview {
  id: number;
  contentId: number;
  userFullName?: string | null;
  seller?: {
    id?: number;
    name?: string | null;
  } | null;
  rate?: number | null;
  comment?: string | null;
  likesCount?: number | null;
  createdAt?: number | null;
  mediaFiles?: Array<{
    url?: string | null;
    fullUrl?: string | null;
    imageUrl?: string | null;
  }> | null;
  trusted?: boolean | null;
}

interface TrendyolReviewResponse {
  isSuccess?: boolean;
  statusCode?: number;
  result?: {
    summary?: {
      totalCommentCount?: number;
      totalPages?: number;
    };
    reviews?: TrendyolReview[];
  };
}

function buildReviewApiUrl(contentId: string, page: number, pageSize: number): string {
  const url = new URL(
    'https://apigw.trendyol.com/discovery-storefront-trproductgw-service/api/review-read/product-reviews/detailed',
  );

  url.searchParams.set('contentId', contentId);
  url.searchParams.set('page', String(page));
  url.searchParams.set('pageSize', String(pageSize));
  url.searchParams.set('channelId', '1');
  return url.toString();
}

function mapReviewImages(review: TrendyolReview): string[] {
  return (review.mediaFiles ?? [])
    .map((mediaFile) => mediaFile.url ?? mediaFile.fullUrl ?? mediaFile.imageUrl ?? null)
    .filter((imageUrl): imageUrl is string => Boolean(imageUrl));
}

function mapReview(options: {
  productId: string;
  productTitle: string;
  productUrl: string;
  review: TrendyolReview;
}): ProductReview | null {
  const { productId, productTitle, productUrl, review } = options;
  const body = cleanText(review.comment ?? '');
  const rating = normalizeRating(review.rate ?? 0, 5);

  if (!body || rating < 1) {
    return null;
  }

  return {
    scrapedAt: new Date().toISOString(),
    platform: 'trendyol',
    sourceUrl: productUrl,
    dataVersion: DATA_VERSION,
    productId,
    productTitle,
    productUrl,
    reviewId: String(review.id),
    reviewerName: cleanText(review.userFullName ?? '') || null,
    rating,
    title: null,
    body,
    reviewDate: new Date(review.createdAt ?? Date.now()).toISOString(),
    isVerifiedPurchase: Boolean(review.trusted),
    helpfulCount: typeof review.likesCount === 'number' ? review.likesCount : null,
    reviewImages: mapReviewImages(review),
    sentimentTag: tagSentiment(body, rating),
    sellerName: cleanText(review.seller?.name ?? '') || null,
    variantInfo: null,
  };
}

async function extractProductContext(page: PlatformScrapeParams['page']): Promise<{
  productId: string;
  productTitle: string;
  productUrl: string;
}> {
  const productUrl = await getCanonicalOrCurrentUrl(page);
  const productId = productUrl.match(/-p-(\d+)$/i)?.[1]
    ?? page.url().match(/-p-(\d+)/i)?.[1]
    ?? page.url();
  const productTitle = await readFirstText(page, ['h1'])
    ?? titleFromDocumentTitle(await page.title(), [
      /\s*-\s*Fiyat[\u0131i],?\s*Yorumlar[\u0131i]?$/i,
      /\s*-\s*Fiyat[\u0131i].*$/i,
    ])
    ?? productId;

  return {
    productId,
    productTitle,
    productUrl,
  };
}

export async function scrapeReviews(params: PlatformScrapeParams): Promise<void> {
  const { context, emitReview, input, page, productUrl, rateLimiter } = params;
  const tracker = createMissingFieldTracker();
  const pageText = await getPageText(page);
  const { productId, productTitle, productUrl: canonicalProductUrl } = await extractProductContext(page);
  const pageSize = Math.min(20, Math.max(5, input.maxReviewsPerProduct));
  const initialApiUrl = buildReviewApiUrl(productId, 0, pageSize);

  await rateLimiter.wait(new URL(initialApiUrl).hostname);
  const initialPayload = await loadJsonViaBrowser<TrendyolReviewResponse>(context, initialApiUrl);
  const totalPages = initialPayload.result?.summary?.totalPages ?? 0;
  const totalCommentCount = initialPayload.result?.summary?.totalCommentCount ?? 0;

  if (pageText.includes('Hen\u00fcz Yorum Yaz\u0131lmam\u0131\u015f') || totalCommentCount === 0 || totalPages === 0) {
    warnMissingReviewFields('trendyol', productUrl, ['title', 'variantInfo']);
    return;
  }

  if (input.sortBy === 'recent') {
    let emittedCount = 0;

    for (let pageIndex = 0; pageIndex < totalPages && emittedCount < input.maxReviewsPerProduct; pageIndex += 1) {
      const apiUrl = pageIndex === 0 ? initialApiUrl : buildReviewApiUrl(productId, pageIndex, pageSize);

      if (pageIndex > 0) {
        await rateLimiter.wait(new URL(apiUrl).hostname);
      }

      const payload = pageIndex === 0
        ? initialPayload
        : await loadJsonViaBrowser<TrendyolReviewResponse>(context, apiUrl);
      const pageReviews = payload.result?.reviews ?? [];

      for (const rawReview of pageReviews) {
        const mappedReview = mapReview({
          productId,
          productTitle,
          productUrl: canonicalProductUrl,
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
    }
  } else {
    const bufferedReviews: ProductReview[] = [];
    const maxBufferedReviews = Math.min(totalCommentCount || MAX_CLIENT_SORT_BUFFER, MAX_CLIENT_SORT_BUFFER);

    for (let pageIndex = 0; pageIndex < totalPages && bufferedReviews.length < maxBufferedReviews; pageIndex += 1) {
      const apiUrl = pageIndex === 0 ? initialApiUrl : buildReviewApiUrl(productId, pageIndex, pageSize);

      if (pageIndex > 0) {
        await rateLimiter.wait(new URL(apiUrl).hostname);
      }

      const payload = pageIndex === 0
        ? initialPayload
        : await loadJsonViaBrowser<TrendyolReviewResponse>(context, apiUrl);

      for (const rawReview of payload.result?.reviews ?? []) {
        const mappedReview = mapReview({
          productId,
          productTitle,
          productUrl: canonicalProductUrl,
          review: rawReview,
        });

        if (!mappedReview) {
          continue;
        }

        markPresentFields(tracker, mappedReview);
        bufferedReviews.push(mappedReview);

        if (bufferedReviews.length >= maxBufferedReviews) {
          break;
        }
      }
    }

    warnApproximateSort('trendyol', canonicalProductUrl, input.sortBy, totalCommentCount, MAX_CLIENT_SORT_BUFFER);
    await emitSortedReviews(bufferedReviews, input, emitReview);
  }

  warnMissingReviewFields('trendyol', canonicalProductUrl, collectMissingFields(tracker));
}
