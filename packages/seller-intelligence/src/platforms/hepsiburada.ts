import type { CheerioCrawler } from 'crawlee';

import { cleanText, normalizeRating, turkishLowerCase } from '@workspace/shared';

import type { SellerProfile } from '../types.js';
import {
  extractFirstMatch,
  matchesSellerQuery,
  normalizeForMatching,
  parseCompactCount,
  parseTurkishDate,
  titleFromSlug,
} from '../utils.js';
import {
  extractBadges,
  fetchDocument,
  pickFirstAttribute,
  pickFirstText,
  warnMissingFields,
} from './common.js';

async function extractDirectoryRating(sellerName: string, crawler: CheerioCrawler): Promise<number | null> {
  const firstLetter = turkishLowerCase(sellerName).charAt(0) || 'a';
  const directory = await fetchDocument(
    `https://www.hepsiburada.com/magaza?filter=${encodeURIComponent(firstLetter)}`,
    crawler,
  );
  let rawRating: string | null = null;

  directory.$('a[href*="/magaza/"]').each((_: unknown, element: unknown) => {
    if (rawRating) {
      return false;
    }

    const anchorText = cleanText(directory.$(element).text());
    const nameCandidate = cleanText(anchorText.replace(/\s+Puan\s+[\d.,]+.*$/i, ''));

    if (!nameCandidate || !matchesSellerQuery(nameCandidate, sellerName)) {
      return;
    }

    rawRating = anchorText.match(/Puan\s+([\d.,]+)/i)?.[1] ?? null;
  });

  if (!rawRating) {
    return null;
  }

  const ratingText: string = rawRating;
  const scoreValue = Number.parseFloat(ratingText.replace(',', '.'));
  return Number.isFinite(scoreValue) ? normalizeRating(scoreValue, 10) : null;
}

export async function scrapeSeller(url: string, _crawler: CheerioCrawler): Promise<SellerProfile> {
  void _crawler;

  const document = await fetchDocument(url, _crawler);
  const searchableText = normalizeForMatching(document.text);
  const pathname = new URL(document.finalUrl).pathname.split('/').filter(Boolean);
  const sellerSlug = pathname[1] ?? '';
  const title = cleanText(document.$('title').text());
  const titleName = title.split(` Ma\u011fazas\u0131`)[0]?.trim();
  const sellerName = pickFirstText(document.$, ['h1'])
    ?? titleName
    ?? titleFromSlug(sellerSlug);
  const followerCount = parseCompactCount(extractFirstMatch(searchableText, [/([0-9.,]+[BMK]?)\s+takipci/i]));
  const totalProducts = parseCompactCount(extractFirstMatch(searchableText, [/([0-9.,]+[BMK]?)\s+urun/i]));
  const overallRating = await extractDirectoryRating(sellerName, _crawler);
  const memberSince = parseTurkishDate(extractFirstMatch(searchableText, [
    /uyelik tarihi\s*:?(.+?)(?:\s{2,}|$)/i,
    /magazaya katilma tarihi\s*:?(.+?)(?:\s{2,}|$)/i,
    /uye oldugu tarih\s*:?(.+?)(?:\s{2,}|$)/i,
  ]));
  const companyName = extractFirstMatch(searchableText, [
    /sirket unvani\s*:?(.+?)(?:vergi|adres|telefon|e-posta|$)/i,
  ]);
  const companyAddress = extractFirstMatch(searchableText, [
    /adres\s*:?(.+?)(?:vergi|telefon|e-posta|$)/i,
  ]);
  const taxId = extractFirstMatch(searchableText, [
    /vergi(?:\s+no|\s+numarasi)?\s*:?([\w-]+)/i,
  ]);
  const contactEmail = extractFirstMatch(document.text, [
    /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i,
  ]);
  const contactPhone = extractFirstMatch(document.text, [
    /(\+?90[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2})/i,
    /(\d{4}\s*\d{3}\s*\d{2}\s*\d{2})/i,
  ]);
  const badges = extractBadges(document.text, [
    'Resmi Sat\u0131c\u0131',
    'Yetkili Sat\u0131c\u0131',
    'Giri\u015fimci Kad\u0131n',
    'Premium',
  ]);
  const storeLogo = pickFirstAttribute(document.$, [
    'img[alt*="group-circle" i]',
    'img[alt*="logo" i]',
  ], 'src');

  const profile: SellerProfile = {
    scrapedAt: new Date().toISOString(),
    platform: 'hepsiburada',
    sourceUrl: document.finalUrl,
    dataVersion: 'seller-profile/v1',
    sellerId: sellerSlug || sellerName,
    sellerName,
    sellerUrl: document.finalUrl,
    storeLogo: storeLogo ? new URL(storeLogo, document.finalUrl).toString() : null,
    overallRating,
    totalReviews: null,
    totalProducts,
    followerCount,
    badges,
    memberSince,
    responseTime: extractFirstMatch(searchableText, [/(\d+\s+saat\s+icinde)/i]),
    returnRate: extractFirstMatch(searchableText, [/(%\s*\d+(?:[.,]\d+)?)\s+iade/i]),
    onTimeDeliveryRate: extractFirstMatch(searchableText, [/(%\s*\d+(?:[.,]\d+)?)\s+zamaninda teslim/i]),
    companyName,
    companyAddress,
    taxId,
    contactEmail,
    contactPhone,
    topCategories: [],
  };

  warnMissingFields(profile.platform, profile.sellerUrl, [
    profile.overallRating === null ? 'overallRating' : '',
    profile.memberSince === null ? 'memberSince' : '',
    profile.companyName === null ? 'companyName' : '',
    profile.companyAddress === null ? 'companyAddress' : '',
    profile.taxId === null ? 'taxId' : '',
    profile.contactEmail === null ? 'contactEmail' : '',
    profile.contactPhone === null ? 'contactPhone' : '',
  ]);

  return profile;
}
