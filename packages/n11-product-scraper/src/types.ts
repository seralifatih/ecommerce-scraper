import { z } from 'zod';

import type { Platform, ProxyInput } from '@workspace/shared';

export const DATA_VERSION = '1.0.0';

export enum RequestLabel {
  CATEGORY = 'CATEGORY',
  DETAIL = 'DETAIL',
  SEARCH = 'SEARCH',
}

const supportedPlatformSchema = z.enum(['trendyol', 'hepsiburada', 'n11']);

const proxyConfigSchema = z.custom<ProxyInput>().optional();

const nonEmptyStringSchema = z.string().trim().min(1, {
  message: 'Text fields must not be empty.',
});

function isN11Hostname(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./i, '').toLowerCase().endsWith('n11.com');
  } catch {
    return false;
  }
}

function isN11ProductUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return isN11Hostname(value) && url.pathname.startsWith('/urun/');
  } catch {
    return false;
  }
}

function isLikelyN11ListingUrl(value: string): boolean {
  try {
    const url = new URL(value);

    if (!isN11Hostname(value)) {
      return false;
    }

    return !url.pathname.startsWith('/urun/');
  } catch {
    return false;
  }
}

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

const n11ListingUrlSchema = z.string().url().refine(isLikelyN11ListingUrl, {
  message: 'Category URLs must belong to n11.com and point to a listing page.',
});

const n11ProductUrlSchema = z.string().url().refine(isN11ProductUrl, {
  message: 'Product URLs must belong to n11.com and point to an N11 product page.',
});

export const actorInputSchema = z.object({
  searchQueries: z.array(nonEmptyStringSchema, {
    message: 'searchQueries must be an array of non-empty strings.',
  }).optional(),
  categoryUrls: z.array(n11ListingUrlSchema, {
    message: 'categoryUrls must be an array of valid N11 listing URLs.',
  }).optional(),
  productUrls: z.array(n11ProductUrlSchema, {
    message: 'productUrls must be an array of valid N11 product URLs.',
  }).optional(),
  maxProducts: positiveIntegerField('maxProducts', 100, 1000),
  scrapeDetails: z.boolean().default(true),
  proxyConfig: proxyConfigSchema.optional(),
}).superRefine((value, context) => {
  const hasSearchQueries = (value.searchQueries?.length ?? 0) > 0;
  const hasCategoryUrls = (value.categoryUrls?.length ?? 0) > 0;
  const hasProductUrls = (value.productUrls?.length ?? 0) > 0;

  if (!hasSearchQueries && !hasCategoryUrls && !hasProductUrls) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one of searchQueries, categoryUrls, or productUrls must be provided.',
      path: ['searchQueries'],
    });
  }

  if (value.searchQueries && value.searchQueries.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'searchQueries must contain at least one search term when provided.',
      path: ['searchQueries'],
    });
  }

  if (value.categoryUrls && value.categoryUrls.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'categoryUrls must contain at least one URL when provided.',
      path: ['categoryUrls'],
    });
  }

  if (value.productUrls && value.productUrls.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'productUrls must contain at least one URL when provided.',
      path: ['productUrls'],
    });
  }
});

export type ActorInput = z.infer<typeof actorInputSchema>;

export const priceInfoSchema = z.object({
  amount: z.number().finite().nonnegative(),
  currency: z.string().trim().min(1),
});

export const n11ProductSchema = z.object({
  scrapedAt: z.string().datetime(),
  platform: z.literal('n11'),
  sourceUrl: z.string().url(),
  dataVersion: z.string().min(1),
  productId: z.string().min(1),
  title: z.string().min(1),
  brand: z.string().nullable(),
  price: priceInfoSchema,
  originalPrice: priceInfoSchema.nullable(),
  discountPercentage: z.number().min(0).max(100).nullable(),
  rating: z.number().min(0).max(5).nullable(),
  reviewCount: z.number().int().nonnegative().nullable(),
  sellerName: z.string().min(1),
  sellerUrl: z.string().url().nullable(),
  categoryPath: z.array(z.string().min(1)),
  imageUrls: z.array(z.string().url()),
  inStock: z.boolean(),
  productUrl: z.string().url(),
  specifications: z.record(z.string(), z.string()),
  description: z.string().nullable(),
});

export type N11Product = z.infer<typeof n11ProductSchema>;

export const runSummarySchema = z.object({
  type: z.literal('RUN_SUMMARY'),
  totalRecords: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  platformBreakdown: z.object({
    trendyol: z.number().int().nonnegative(),
    hepsiburada: z.number().int().nonnegative(),
    n11: z.number().int().nonnegative(),
  }),
  durationSeconds: z.number().nonnegative(),
  errors: z.number().int().nonnegative(),
});

export type RunSummaryRecord = z.infer<typeof runSummarySchema>;

export function createEmptyPlatformBreakdown(): Record<Platform, number> {
  return {
    trendyol: 0,
    hepsiburada: 0,
    n11: 0,
  };
}

export interface ListingProductCandidate {
  internalProductId: string | null;
  productId: string;
  title: string;
  priceText: string | null;
  imageUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
  sellerName: string | null;
  productUrl: string;
}

export interface ListingParseResult {
  items: ListingProductCandidate[];
  nextPageUrl: string | null;
  currentPage: number | null;
  pageCount: number | null;
}

export interface DetailEnrichment {
  description: string | null;
  descriptionHtml: string | null;
  specifications: Record<string, string>;
}

export interface N11CrawlerState {
  enqueuedProductUrls: Set<string>;
  pushedProductIds: Set<string>;
  processedProductCount: number;
  errorCount: number;
}
