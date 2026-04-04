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
import { parseN11Date, titleFromDocumentTitle } from '../utils.js';
import {
  emitSortedReviews,
  getCanonicalOrCurrentUrl,
  getPageText,
  loadJsonViaBrowser,
  readFirstText,
  warnApproximateSort,
  warnMissingReviewFields,
} from './common.js';

interface N11ReviewPayload {
  pagination?: {
    currentPage?: number;
    itemsPerPage?: number;
    pageCount?: number;
    totalCount?: number;
  };
  productFeedBackReviewList?: N11Review[];
}

interface N11Review {
  id: number;
  contents?: string | null;
  createDate?: number | null;
  createdDate?: string | null;
  helpfulVoteCount?: number | null;
  maskedBuyerName?: string | null;
  productId?: number | null;
  productSubTitle?: string | null;
  productTitle?: string | null;
  reviewImageDtos?: Array<{
    imageUrl?: string | null;
  }> | null;
  score?: string | number | null;
  scoreAsStar?: number | null;
  sellerNickname?: string | null;
  title?: string | null;
}

function extractProductIdFromHtml(html: string): string | null {
  return html.match(/"productId"\s*:\s*"?(?<productId>\d+)/i)?.groups?.productId
    ?? html.match(/"itemId"\s*:\s*"?(?<itemId>\d+)/i)?.groups?.itemId
    ?? html.match(/getProductReviews\/(?<reviewId>\d+)/i)?.groups?.reviewId
    ?? null;
}

function buildReviewApiUrl(productId: string, pageNumber: number): string {
  const url = new URL(`https://www.n11.com/getProductReviews/${productId}`);
  url.searchParams.set('currentPage', String(pageNumber));
  return url.toString();
}

function mapReview(options: {
  fallbackProductId: string;
  fallbackProductTitle: string;
  productUrl: string;
  review: N11Review;
}): ProductReview | null {
  const { fallbackProductId, fallbackProductTitle, productUrl, review } = options;
  const body = cleanText(review.contents ?? '');
  const rating = typeof review.scoreAsStar === 'number'
    ? normalizeRating(review.scoreAsStar, 5)
    : normalizeRating(Number(review.score ?? 0), 100);

  if (!body || rating < 1) {
    return null;
  }

  const productTitle = cleanText(review.productTitle ?? '') || fallbackProductTitle;
  const subtitle = cleanText(review.productSubTitle ?? '');
  const variantInfo = subtitle && subtitle !== productTitle ? subtitle : null;

  return {
    scrapedAt: new Date().toISOString(),
    platform: 'n11',
    sourceUrl: productUrl,
    dataVersion: DATA_VERSION,
    productId: review.productId ? String(review.productId) : fallbackProductId,
    productTitle,
    productUrl,
    reviewId: String(review.id),
    reviewerName: cleanText(review.maskedBuyerName ?? '') || null,
    rating,
    title: cleanText(review.title ?? '') || null,
    body,
    reviewDate: parseN11Date(review.createdDate, review.createDate ?? null) ?? new Date().toISOString(),
    isVerifiedPurchase: false,
    helpfulCount: typeof review.helpfulVoteCount === 'number' ? review.helpfulVoteCount : null,
    reviewImages: (review.reviewImageDtos ?? [])
      .map((image) => image.imageUrl ?? null)
      .filter((imageUrl): imageUrl is string => Boolean(imageUrl)),
    sentimentTag: tagSentiment(body, rating),
    sellerName: cleanText(review.sellerNickname ?? '') || null,
    variantInfo,
  };
}

async function extractProductContext(page: PlatformScrapeParams['page']): Promise<{
  productId: string;
  productTitle: string;
  productUrl: string;
}> {
  const html = await page.content();
  const productUrl = await getCanonicalOrCurrentUrl(page);
  const productId = extractProductIdFromHtml(html)
    ?? productUrl.match(/-(\d+)$/)?.[1]
    ?? productUrl;
  const productTitle = await readFirstText(page, ['h1.title', 'h1'])
    ?? titleFromDocumentTitle(await page.title(), [
      /\s+Fiyatlar[\u0131i]\s+ve\s+\u00d6zellikleri$/i,
      /\s+-\s+n11$/i,
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
  const initialApiUrl = buildReviewApiUrl(productId, 1);

  if (pageText.toLowerCase().includes('g\u00fcvenlik') || pageText.toLowerCase().includes('sorry, you have been blocked')) {
    throw new Error(`Blocked or challenge page detected for ${productUrl}.`);
  }

  await rateLimiter.wait(new URL(initialApiUrl).hostname);
  const initialPayload = await loadJsonViaBrowser<N11ReviewPayload>(context, initialApiUrl);
  const totalCount = initialPayload.pagination?.totalCount ?? 0;
  const pageCount = initialPayload.pagination?.pageCount ?? 0;
  const itemsPerPage = initialPayload.pagination?.itemsPerPage ?? 8;

  if (totalCount === 0 || pageCount === 0) {
    warnMissingReviewFields('n11', canonicalProductUrl, ['title', 'variantInfo', 'isVerifiedPurchase']);
    return;
  }

  if (input.sortBy === 'recent') {
    let emittedCount = 0;

    for (let pageNumber = 1; pageNumber <= pageCount && emittedCount < input.maxReviewsPerProduct; pageNumber += 1) {
      const apiUrl = pageNumber === 1 ? initialApiUrl : buildReviewApiUrl(productId, pageNumber);

      if (pageNumber > 1) {
        await rateLimiter.wait(new URL(apiUrl).hostname);
      }

      const payload = pageNumber === 1
        ? initialPayload
        : await loadJsonViaBrowser<N11ReviewPayload>(context, apiUrl);

      for (const rawReview of payload.productFeedBackReviewList ?? []) {
        const mappedReview = mapReview({
          fallbackProductId: productId,
          fallbackProductTitle: productTitle,
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
    const maxBufferedReviews = Math.min(totalCount || MAX_CLIENT_SORT_BUFFER, MAX_CLIENT_SORT_BUFFER);
    const maxBufferedPages = Math.min(pageCount, Math.ceil(maxBufferedReviews / itemsPerPage));

    for (let pageNumber = 1; pageNumber <= maxBufferedPages && bufferedReviews.length < maxBufferedReviews; pageNumber += 1) {
      const apiUrl = pageNumber === 1 ? initialApiUrl : buildReviewApiUrl(productId, pageNumber);

      if (pageNumber > 1) {
        await rateLimiter.wait(new URL(apiUrl).hostname);
      }

      const payload = pageNumber === 1
        ? initialPayload
        : await loadJsonViaBrowser<N11ReviewPayload>(context, apiUrl);

      for (const rawReview of payload.productFeedBackReviewList ?? []) {
        const mappedReview = mapReview({
          fallbackProductId: productId,
          fallbackProductTitle: productTitle,
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

    warnApproximateSort('n11', canonicalProductUrl, input.sortBy, totalCount, MAX_CLIENT_SORT_BUFFER);
    await emitSortedReviews(bufferedReviews, input, emitReview);
  }

  warnMissingReviewFields('n11', canonicalProductUrl, [
    ...collectMissingFields(tracker),
    'isVerifiedPurchase',
  ]);
}
