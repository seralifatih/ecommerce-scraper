import type { BrowserContext, Page } from 'playwright';
import { z } from 'zod';

import type { Platform, RateLimiter } from '@workspace/shared';

export const DATA_VERSION = 'product-review/v1';
export const DEFAULT_PLATFORMS = ['n11'] as const;
export const SEARCH_RESULTS_PER_PLATFORM = 5;
export const MAX_CLIENT_SORT_BUFFER = 500;

export const platformSchema = z.enum(DEFAULT_PLATFORMS);
export const sortBySchema = z.enum(['recent', 'helpful', 'highest', 'lowest']);
export const sentimentTagSchema = z.enum(['positive', 'negative', 'neutral', 'mixed']);

const proxyConfigSchema = z.object({
  useApifyProxy: z.boolean().optional(),
  apifyProxyGroups: z.array(z.string().trim().min(1)).optional(),
  apifyProxyCountry: z.string().trim().min(2).max(2).optional(),
  proxyUrls: z.array(z.string().trim().min(1)).optional(),
}).passthrough();

function positiveIntegerField(fieldName: string, defaultValue: number, maximum?: number) {
  return z.coerce.number().default(defaultValue).superRefine((value, context) => {
    if (!Number.isInteger(value) || value <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${fieldName} must be a positive integer.`,
      });
    }

    if (maximum !== undefined && value > maximum) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${fieldName} must be less than or equal to ${maximum}.`,
      });
    }
  });
}

export const actorInputSchema = z.object({
  productUrls: z.array(z.string().url()).default([
    'https://www.n11.com/urun/logitech-mk270-kablosuz-usb-turkce-q-klavye-mouse-seti-61465',
  ]),
  searchQuery: z.string().trim().min(1).optional(),
  platforms: z.array(platformSchema).default([...DEFAULT_PLATFORMS]),
  maxReviewsPerProduct: positiveIntegerField('maxReviewsPerProduct', 100, 1000),
  minRating: z.number().int().min(1).max(5).nullable().default(null),
  sortBy: sortBySchema.default('recent'),
  proxyConfig: proxyConfigSchema.optional(),
}).superRefine((value, context) => {
  if (value.productUrls.length === 0 && !value.searchQuery) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one of productUrls or searchQuery must be provided.',
      path: ['productUrls'],
    });
  }

  if (new Set(value.platforms).size !== value.platforms.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Platforms must not contain duplicate values.',
      path: ['platforms'],
    });
  }
});

export type ActorInput = z.infer<typeof actorInputSchema>;
export type SortBy = z.infer<typeof sortBySchema>;
export type SentimentTag = z.infer<typeof sentimentTagSchema>;

export const productReviewSchema = z.object({
  scrapedAt: z.string().datetime(),
  platform: platformSchema,
  sourceUrl: z.string().url(),
  dataVersion: z.string().min(1),
  productId: z.string().min(1),
  productTitle: z.string().min(1),
  productUrl: z.string().url(),
  reviewId: z.string().min(1),
  reviewerName: z.string().min(1).nullable(),
  rating: z.number().min(1).max(5),
  title: z.string().min(1).nullable(),
  body: z.string().min(1),
  reviewDate: z.string().datetime(),
  isVerifiedPurchase: z.boolean(),
  helpfulCount: z.number().int().nonnegative().nullable(),
  reviewImages: z.array(z.string().url()),
  sentimentTag: sentimentTagSchema,
  sellerName: z.string().min(1).nullable(),
  variantInfo: z.string().min(1).nullable(),
});

export type ProductReview = z.infer<typeof productReviewSchema>;

export const runSummarySchema = z.object({
  type: z.literal('RUN_SUMMARY'),
  totalRecords: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  platformBreakdown: z.object({
    n11: z.number().int().nonnegative(),
  }),
  durationSeconds: z.number().nonnegative(),
  errors: z.number().int().nonnegative(),
});

export function createEmptyPlatformBreakdown(): Record<'n11', number> {
  return {
    n11: 0,
  };
}

export interface PlatformScrapeParams {
  productUrl: string;
  input: ActorInput;
  page: Page;
  context: BrowserContext;
  rateLimiter: RateLimiter;
  emitReview: (review: ProductReview) => Promise<void>;
}

export type PlatformScraper = (params: PlatformScrapeParams) => Promise<void>;

export interface MissingFieldTracker {
  reviewerName: boolean;
  title: boolean;
  helpfulCount: boolean;
  sellerName: boolean;
  variantInfo: boolean;
}

export function createMissingFieldTracker(): MissingFieldTracker {
  return {
    reviewerName: false,
    title: false,
    helpfulCount: false,
    sellerName: false,
    variantInfo: false,
  };
}

export function collectMissingFields(tracker: MissingFieldTracker): string[] {
  return Object.entries(tracker)
    .filter(([, present]) => !present)
    .map(([field]) => field);
}

export function markPresentFields(tracker: MissingFieldTracker, review: ProductReview): void {
  tracker.reviewerName ||= Boolean(review.reviewerName);
  tracker.title ||= Boolean(review.title);
  tracker.helpfulCount ||= review.helpfulCount !== null;
  tracker.sellerName ||= Boolean(review.sellerName);
  tracker.variantInfo ||= Boolean(review.variantInfo);
}

export type SupportedPlatform = Platform;
