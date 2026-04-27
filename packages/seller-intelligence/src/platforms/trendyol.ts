import type { CheerioCrawler } from 'crawlee';

import { cleanText, normalizeRating } from '@workspace/shared';

import type { SellerProfile } from '../types.js';
import {
  escapeRegExp,
  extractFirstMatch,
  normalizeForMatching,
  parseCompactCount,
  titleFromSlug,
} from '../utils.js';
import {
  extractBadges,
  fetchDocument,
  fetchJson,
  pickFirstAttribute,
  pickFirstText,
  warnMissingFields,
} from './common.js';

interface TrendyolFollowerResponse {
  count?: number;
}

interface TrendyolAggregationResponse {
  categories?: Array<{
    text?: string;
  }>;
}

export async function scrapeSeller(url: string, _crawler: CheerioCrawler): Promise<SellerProfile> {
  void _crawler;

  const sellerId = url.match(/-m-(\d+)/i)?.[1] ?? '';
  const document = await fetchDocument(url, _crawler);
  const searchableText = normalizeForMatching(document.text);
  const title = cleanText(document.$('title').text());
  const titleName = title.split(` \u00dcr\u00fcnleri`)[0]?.trim();
  const sellerName = pickFirstText(document.$, ['h1'])
    ?? titleName
    ?? titleFromSlug(new URL(document.finalUrl).pathname.split('/').pop()?.replace(/-m-\d+$/i, '') ?? sellerId);
  const searchableName = normalizeForMatching(sellerName);
  const scoreText = extractFirstMatch(searchableText, [
    new RegExp(`${escapeRegExp(searchableName)}\\s+(\\d+(?:[.,]\\d+)?)\\s+satici profili`, 'i'),
    /(\d+(?:[.,]\d+)?)\s+satici profili/i,
  ]);
  const scoreValue = scoreText ? Number.parseFloat(scoreText.replace(',', '.')) : Number.NaN;
  const followApi = sellerId
    ? await fetchJson<TrendyolFollowerResponse>(
      `https://apigw.trendyol.com/discovery-sellerstore-gateway-service/api/follow/?sellerId=${sellerId}&culture=tr-TR&checkCoupon=true`,
      _crawler,
    )
    : null;
  const aggregationApi = sellerId
    ? await fetchJson<TrendyolAggregationResponse>(
      `https://apigw.trendyol.com/discovery-sellerstore-gateway-service/api/search/aggregations?sellerId=${sellerId}&culture=tr-TR&countryCode=TR&language=tr&storefrontId=1`,
      _crawler,
    )
    : null;
  const followerCount = typeof followApi?.count === 'number'
    ? followApi.count
    : parseCompactCount(extractFirstMatch(searchableText, [/([0-9.,]+[BMK]?)\s+takipci/i]));
  const topCategories = (aggregationApi?.categories ?? [])
    .map((category) => cleanText(category.text ?? ''))
    .filter(Boolean)
    .slice(0, 5);
  const badges = extractBadges(document.text, [
    'S\u00fcper Sat\u0131c\u0131',
    'Resmi Sat\u0131c\u0131',
    'Yetkili Sat\u0131c\u0131',
    'H\u0131zl\u0131 Teslimat',
    'H\u0131zl\u0131 G\u00f6nderim',
  ]);
  const storeLogo = pickFirstAttribute(document.$, [
    'img[alt*="logo" i]',
    'img[src*="seller-store"]',
  ], 'src');

  const profile: SellerProfile = {
    scrapedAt: new Date().toISOString(),
    platform: 'trendyol',
    sourceUrl: document.finalUrl,
    dataVersion: 'seller-profile/v1',
    sellerId: sellerId || sellerName,
    sellerName,
    sellerUrl: document.finalUrl,
    storeLogo: storeLogo ? new URL(storeLogo, document.finalUrl).toString() : null,
    overallRating: Number.isFinite(scoreValue) ? normalizeRating(scoreValue, 10) : null,
    totalReviews: null,
    totalProducts: null,
    followerCount,
    badges,
    memberSince: null,
    responseTime: extractFirstMatch(searchableText, [/(\d+\s+saat\s+icinde)/i]),
    returnRate: extractFirstMatch(searchableText, [/(%\s*\d+(?:[.,]\d+)?)\s+iade/i]),
    onTimeDeliveryRate: extractFirstMatch(searchableText, [/(%\s*\d+(?:[.,]\d+)?)\s+zamaninda teslim/i]),
    companyName: null,
    companyAddress: null,
    taxId: null,
    contactEmail: null,
    contactPhone: null,
    topCategories,
  };

  warnMissingFields(profile.platform, profile.sellerUrl, [
    profile.totalProducts === null ? 'totalProducts' : '',
    profile.memberSince === null ? 'memberSince' : '',
    profile.companyName === null ? 'companyName' : '',
    profile.companyAddress === null ? 'companyAddress' : '',
    profile.taxId === null ? 'taxId' : '',
    profile.contactEmail === null ? 'contactEmail' : '',
    profile.contactPhone === null ? 'contactPhone' : '',
  ]);

  return profile;
}
