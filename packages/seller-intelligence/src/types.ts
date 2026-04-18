import { z } from 'zod';

import type { Platform, ProxyInput } from '@workspace/shared';

export const supportedPlatforms = ['trendyol', 'hepsiburada', 'n11'] as const;

export const platformSchema = z.enum(supportedPlatforms);

const nonEmptyStringSchema = z.string().trim().min(1);

function dedupePlatforms(platforms: Platform[]): Platform[] {
  return Array.from(new Set(platforms));
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

function detectPlatformFromSellerUrl(rawUrl: string): Platform | null {
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

function isSupportedSellerUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const platform = detectPlatformFromSellerUrl(rawUrl);
    const segments = url.pathname.split('/').filter(Boolean);

    if (!platform || segments[0] !== 'magaza' || segments.length < 2) {
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

export const actorInputSchema = z.object({
  platforms: z.array(platformSchema)
    .default([...supportedPlatforms])
    .transform((platforms) => dedupePlatforms(platforms)),
  sellerUrls: z.array(z.string().url().refine(isSupportedSellerUrl, {
    message: 'Seller URLs must belong to Trendyol, Hepsiburada, or N11 seller profile pages.',
  })).default([]),
  searchBySeller: nonEmptyStringSchema.default('Samsung'),
  searchByCategory: nonEmptyStringSchema.optional(),
  maxSellers: positiveIntegerField('maxSellers', 50, 500),
  proxyConfig: z.custom<ProxyInput>().optional().default({
    useApifyProxy: true,
    apifyProxyGroups: ['RESIDENTIAL'],
    apifyProxyCountry: 'TR',
  }),
}).superRefine((input, ctx) => {
  if (input.sellerUrls.length === 0 && !input.searchBySeller && !input.searchByCategory) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide at least one of sellerUrls, searchBySeller, or searchByCategory.',
      path: ['sellerUrls'],
    });
  }

  if (new Set(input.platforms).size !== input.platforms.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'platforms must not contain duplicate values.',
      path: ['platforms'],
    });
  }

  for (const sellerUrl of input.sellerUrls) {
    const platform = detectPlatformFromSellerUrl(sellerUrl);

    if (!platform) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Seller URLs must belong to Trendyol, Hepsiburada, or N11.',
        path: ['sellerUrls'],
      });
      continue;
    }

    if (!input.platforms.includes(platform)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Seller URL ${sellerUrl} belongs to ${platform}, but that platform is not enabled in platforms.`,
        path: ['sellerUrls'],
      });
    }
  }
});

export type ActorInput = z.infer<typeof actorInputSchema>;

export const sellerProfileSchema = z.object({
  scrapedAt: nonEmptyStringSchema,
  platform: platformSchema,
  sourceUrl: z.string().url(),
  dataVersion: z.literal('seller-profile/v1'),
  sellerId: nonEmptyStringSchema,
  sellerName: nonEmptyStringSchema,
  sellerUrl: z.string().url(),
  storeLogo: z.string().url().nullable(),
  overallRating: z.number().min(0).max(5).nullable(),
  totalReviews: z.number().int().nonnegative().nullable(),
  totalProducts: z.number().int().nonnegative().nullable(),
  followerCount: z.number().int().nonnegative().nullable(),
  badges: z.array(nonEmptyStringSchema),
  memberSince: z.string().nullable(),
  responseTime: z.string().nullable(),
  returnRate: z.string().nullable(),
  onTimeDeliveryRate: z.string().nullable(),
  companyName: z.string().nullable(),
  companyAddress: z.string().nullable(),
  taxId: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  topCategories: z.array(nonEmptyStringSchema),
});

export type SellerProfile = z.infer<typeof sellerProfileSchema>;

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

export const REQUEST_LABEL = {
  TRENDYOL_SEARCH: 'TRENDYOL_SEARCH',
  HEPSIBURADA_DIRECTORY: 'HEPSIBURADA_DIRECTORY',
  HEPSIBURADA_SEARCH: 'HEPSIBURADA_SEARCH',
  HEPSIBURADA_PRODUCT: 'HEPSIBURADA_PRODUCT',
  N11_SEARCH: 'N11_SEARCH',
  N11_PRODUCT: 'N11_PRODUCT',
} as const;

export type RequestLabel = typeof REQUEST_LABEL[keyof typeof REQUEST_LABEL];

export interface DiscoveryRequestUserData {
  label: RequestLabel;
  platform: Platform;
  mode: 'seller' | 'category';
  query: string;
}

export interface SellerCrawlerState {
  discoveredSellerUrls: Set<string>;
  discoveredProductUrls: Set<string>;
  pushedSellerUrls: Set<string>;
  errorCount: number;
}
