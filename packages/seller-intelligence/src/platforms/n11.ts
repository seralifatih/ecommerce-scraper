import type { CheerioCrawler } from 'crawlee';

import { cleanText, normalizeRating } from '@workspace/shared';

import type { SellerProfile } from '../types.js';
import {
  escapeRegExp,
  extractFirstMatch,
  normalizeForMatching,
  titleFromSlug,
} from '../utils.js';
import {
  extractBadges,
  fetchDocument,
  pickFirstAttribute,
  pickFirstText,
  warnMissingFields,
} from './common.js';

export async function scrapeSeller(url: string, _crawler: CheerioCrawler): Promise<SellerProfile> {
  void _crawler;

  const document = await fetchDocument(url, _crawler);
  const searchableText = normalizeForMatching(document.text);
  const sellerSlug = new URL(document.finalUrl).pathname.split('/').filter(Boolean)[1] ?? '';
  const title = cleanText(document.$('title').text());
  const sellerName = pickFirstText(document.$, ['h1'])
    ?? title.split(' - n11')[0]?.trim()
    ?? titleFromSlug(sellerSlug);
  const searchableName = normalizeForMatching(sellerName);
  const scoreText = extractFirstMatch(searchableText, [
    new RegExp(`${escapeRegExp(searchableName)}\\s+(\\d+(?:[.,]\\d+)?)\\s+(?:basarili magaza|takip et|tum urunler)`, 'i'),
    /(\d+(?:[.,]\d+)?)\s+basarili magaza/i,
  ]);
  const scoreValue = scoreText ? Number.parseFloat(scoreText.replace(',', '.')) : Number.NaN;
  const totalProducts = new Set(
    document.$('a[href*="/urun/"]')
      .map((_: unknown, element: unknown) => document.$(element).attr('href'))
      .get()
      .filter((href: string | undefined): href is string => Boolean(href))
      .map((href: string) => new URL(href, document.finalUrl).toString()),
  ).size || null;
  const storeLogo = pickFirstAttribute(document.$, [
    `img[alt*="${sellerName}" i]`,
    'img[src*="seller"]',
  ], 'src');
  const badges = extractBadges(document.text, [
    'Ba\u015far\u0131l\u0131 Ma\u011faza',
    'H\u0131zl\u0131 G\u00f6nderim',
    '\u00dccretsiz Kargo',
  ]);

  const profile: SellerProfile = {
    scrapedAt: new Date().toISOString(),
    platform: 'n11',
    sourceUrl: document.finalUrl,
    dataVersion: 'seller-profile/v1',
    sellerId: sellerSlug || sellerName,
    sellerName,
    sellerUrl: document.finalUrl,
    storeLogo: storeLogo ? new URL(storeLogo, document.finalUrl).toString() : null,
    overallRating: Number.isFinite(scoreValue) ? normalizeRating(scoreValue, 10) : null,
    totalReviews: null,
    totalProducts,
    followerCount: null,
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
    topCategories: [],
  };

  warnMissingFields(profile.platform, profile.sellerUrl, [
    profile.totalReviews === null ? 'totalReviews' : '',
    profile.followerCount === null ? 'followerCount' : '',
    profile.memberSince === null ? 'memberSince' : '',
    profile.responseTime === null ? 'responseTime' : '',
    profile.companyName === null ? 'companyName' : '',
    profile.companyAddress === null ? 'companyAddress' : '',
    profile.taxId === null ? 'taxId' : '',
    profile.contactEmail === null ? 'contactEmail' : '',
    profile.contactPhone === null ? 'contactPhone' : '',
  ]);

  return profile;
}
