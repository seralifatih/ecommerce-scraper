import type { CheerioCrawler } from 'crawlee';

import { cleanText, normalizeRating } from '@workspace/shared';

import type { SellerProfile } from '../types.js';
import { titleFromSlug } from '../utils.js';
import { fetchDocument, warnMissingFields } from './common.js';

interface N11SellerShopDto {
  deliveryHours?: string | null;
  isQuickSeller?: boolean;
  isTopSellerBadge?: boolean;
  logoImage?: string | null;
  quickSeller?: boolean;
  topSellerBadge?: boolean;
  sellerDTO?: {
    averageShipmentSpeed?: string | null;
    businessName?: string | null;
    companyName?: string | null;
    followerCount?: string | number | null;
    headquarterCity?: string | null;
    id?: number;
    mersisNo?: string | null;
    nickName?: string | null;
    registeredEmail?: string | null;
    sellerAnswerTime?: string | null;
    sellerFeedbackStatistics?: {
      sellerGrade?: number;
      totalFeedbackCount?: number;
    };
    sellerShopPoint?: string | null;
    taxNumber?: string | null;
    timeInPlatform?: string | null;
    topSellerBadge?: boolean;
  };
  sellerGrade?: string | null;
  sellerGradeDecimal?: string | null;
  sellerId?: number;
  sellerName?: string | null;
}

interface N11SellerModel {
  sellerInfo?: {
    sellerShopDto?: N11SellerShopDto;
    sellerProductsCount?: number | null;
    isAuthorizedDealer?: boolean;
  };
}

function parseSellerModel(html: string): N11SellerModel | null {
  const marker = '<script>window.model = ';
  const start = html.indexOf(marker);

  if (start < 0) {
    return null;
  }

  const jsonStart = start + marker.length;
  const jsonEnd = html.indexOf('</script>', jsonStart);

  if (jsonEnd < 0) {
    return null;
  }

  try {
    return JSON.parse(html.slice(jsonStart, jsonEnd).replace(/;\s*$/, '')) as N11SellerModel;
  } catch {
    return null;
  }
}

function parseFollowerCount(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }

  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw).replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseGrade(gradeStr: string | null | undefined): number | null {
  if (!gradeStr) {
    return null;
  }

  const numeric = Number.parseFloat(gradeStr.replace('%', '').replace(',', '.').trim());
  return Number.isFinite(numeric) ? normalizeRating(numeric, 100) : null;
}

export async function scrapeSeller(url: string, _crawler: CheerioCrawler): Promise<SellerProfile> {
  void _crawler;

  const document = await fetchDocument(url, _crawler);
  const sellerSlug = new URL(document.finalUrl).pathname.split('/').filter(Boolean)[1] ?? '';
  const model = parseSellerModel(document.html);
  const dto = model?.sellerInfo?.sellerShopDto;
  const sDto = dto?.sellerDTO;

  const sellerName = cleanText(dto?.sellerName ?? sDto?.nickName ?? '')
    || cleanText(document.$('h1').first().text())
    || titleFromSlug(sellerSlug);

  const storeLogo = dto?.logoImage
    ? new URL(dto.logoImage, document.finalUrl).toString()
    : null;

  const overallRating = parseGrade(dto?.sellerGrade ?? dto?.sellerGradeDecimal);

  const totalReviews = typeof sDto?.sellerFeedbackStatistics?.totalFeedbackCount === 'number'
    ? sDto.sellerFeedbackStatistics.totalFeedbackCount
    : null;

  const totalProducts = typeof model?.sellerInfo?.sellerProductsCount === 'number'
    ? model.sellerInfo.sellerProductsCount
    : null;

  const followerCount = parseFollowerCount(sDto?.followerCount);

  const badges: string[] = [];
  if (dto?.isTopSellerBadge || dto?.topSellerBadge) {
    badges.push('Başarılı Mağaza');
  }
  if (dto?.isQuickSeller || dto?.quickSeller) {
    badges.push('Hızlı Gönderim');
  }
  if (model?.sellerInfo?.isAuthorizedDealer) {
    badges.push('Yetkili Satıcı');
  }

  const responseTime = sDto?.sellerAnswerTime
    ? cleanText(sDto.sellerAnswerTime)
    : null;

  const companyName = cleanText(sDto?.companyName ?? sDto?.businessName ?? '') || null;

  const companyAddress = sDto?.headquarterCity
    ? cleanText(sDto.headquarterCity)
    : null;

  const taxId = sDto?.taxNumber ? cleanText(sDto.taxNumber) : null;

  const contactEmail = sDto?.registeredEmail ? cleanText(sDto.registeredEmail) : null;

  const memberSince = sDto?.timeInPlatform ? cleanText(sDto.timeInPlatform) : null;

  const sellerId = String(dto?.sellerId ?? sDto?.id ?? (sellerSlug || sellerName));

  const profile: SellerProfile = {
    scrapedAt: new Date().toISOString(),
    platform: 'n11',
    sourceUrl: document.finalUrl,
    dataVersion: 'seller-profile/v1',
    sellerId,
    sellerName,
    sellerUrl: document.finalUrl,
    storeLogo,
    overallRating,
    totalReviews,
    totalProducts,
    followerCount,
    badges,
    memberSince,
    responseTime,
    returnRate: null,
    onTimeDeliveryRate: null,
    companyName,
    companyAddress,
    taxId,
    contactEmail,
    contactPhone: null,
    topCategories: [],
  };

  warnMissingFields(profile.platform, profile.sellerUrl, [
    profile.overallRating === null ? 'overallRating' : '',
    profile.totalReviews === null ? 'totalReviews' : '',
    profile.companyName === null ? 'companyName' : '',
    profile.taxId === null ? 'taxId' : '',
    profile.contactEmail === null ? 'contactEmail' : '',
  ]);

  return profile;
}
