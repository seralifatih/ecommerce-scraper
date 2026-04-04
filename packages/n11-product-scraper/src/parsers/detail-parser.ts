import { load, type CheerioAPI } from 'cheerio';

import { cleanText, parseTurkishPrice } from '@workspace/shared';

import {
  DATA_VERSION,
  type DetailEnrichment,
  type ListingProductCandidate,
  type N11Product,
} from '../types.js';

function getAbsoluteUrl(url: string | undefined, baseUrl: string): string | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return null;
  }
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function parseNullablePrice(text: string | null): N11Product['originalPrice'] {
  if (!text) {
    return null;
  }

  try {
    return parseTurkishPrice(text);
  } catch {
    return null;
  }
}

function computeDiscountPercentage(currentAmount: number, originalAmount: number | null): number | null {
  if (!originalAmount || originalAmount <= currentAmount) {
    return null;
  }

  const discount = ((originalAmount - currentAmount) / originalAmount) * 100;
  return Number.parseFloat(discount.toFixed(2));
}

function parseJsonLdProduct($: CheerioAPI): {
  brand: string | null;
  imageUrls: string[];
  rating: number | null;
  reviewCount: number | null;
} {
  const scripts = $('script[type="application/ld+json"]').toArray();

  for (const script of scripts) {
    const rawJson = $(script).contents().text().trim();

    if (!rawJson) {
      continue;
    }

    try {
      const parsedJson = JSON.parse(rawJson);
      const candidates = Array.isArray(parsedJson) ? parsedJson : [parsedJson];

      for (const candidate of candidates) {
        if (candidate?.['@type'] !== 'Product') {
          continue;
        }

        const aggregateRating = candidate.aggregateRating ?? {};

        return {
          brand: typeof candidate.brand === 'string' ? cleanText(candidate.brand) : null,
          imageUrls: Array.isArray(candidate.image)
            ? candidate.image.map((value: string) => cleanText(value)).filter(Boolean)
            : typeof candidate.image === 'string'
              ? [cleanText(candidate.image)]
              : [],
          rating: typeof aggregateRating.ratingValue === 'number'
            ? aggregateRating.ratingValue
            : Number.isFinite(Number.parseFloat(aggregateRating.ratingValue))
              ? Number.parseFloat(aggregateRating.ratingValue)
              : null,
          reviewCount: Number.isFinite(Number.parseInt(aggregateRating.reviewCount, 10))
            ? Number.parseInt(aggregateRating.reviewCount, 10)
            : Number.isFinite(Number.parseInt(aggregateRating.ratingCount, 10))
              ? Number.parseInt(aggregateRating.ratingCount, 10)
              : null,
        };
      }
    } catch {
      continue;
    }
  }

  return {
    brand: null,
    imageUrls: [],
    rating: null,
    reviewCount: null,
  };
}

function extractInternalProductId(html: string, fallbackValue: string | null): string | null {
  if (fallbackValue) {
    return fallbackValue;
  }

  const descriptionMatch = html.match(/getProductDescriptions\/(\d+)/);
  if (descriptionMatch) {
    return descriptionMatch[1];
  }

  const reviewMatch = html.match(/getProductReviews\/(\d+)/);
  if (reviewMatch) {
    return reviewMatch[1];
  }

  const itemMatch = html.match(/"itemId":"?(\d+)/);
  return itemMatch?.[1] ?? null;
}

function extractDomSpecifications($: CheerioAPI): Record<string, string> {
  const specifications: Record<string, string> = {};

  $('#productAttributes .attribute-item').each((_, element) => {
    const key = cleanText($(element).find('.attribute-key').first().text());
    const value = cleanText($(element).find('.attribute-val').first().text());

    if (key && value) {
      specifications[key] = value;
    }
  });

  return specifications;
}

export function parseDescriptionEnrichment(apiResponseText: string): DetailEnrichment {
  try {
    const parsedPayload = JSON.parse(apiResponseText) as {
      productDetails?: Array<{ title?: string; content?: string }>;
    };

    const specifications: Record<string, string> = {};
    const descriptionSections: string[] = [];
    let descriptionHtml: string | null = null;

    for (const detail of parsedPayload.productDetails ?? []) {
      if (!detail.content) {
        continue;
      }

      const detailDocument = load(detail.content);
      if (!descriptionHtml) {
        descriptionHtml = detail.content;
      }

      detailDocument('table.product-features tr').each((_, row) => {
        const key = cleanText(detailDocument(row).find('td').first().text());
        const value = cleanText(detailDocument(row).find('td').last().text()).replace(/^:\s*/, '');

        if (key && value) {
          specifications[key] = value;
        }
      });

      detailDocument('#pdp-descriptions .pdp-box').each((_, box) => {
        const boxClone = detailDocument(box).clone();
        boxClone.find('table').remove();
        const boxText = cleanText(boxClone.text());

        if (boxText) {
          descriptionSections.push(boxText);
        }
      });
    }

    return {
      description: descriptionSections.length > 0 ? cleanText(descriptionSections.join(' ')) : null,
      descriptionHtml,
      specifications,
    };
  } catch {
    return {
      description: null,
      descriptionHtml: null,
      specifications: {},
    };
  }
}

export function buildProductFromDetailPage(options: {
  $: CheerioAPI;
  html: string;
  url: string;
  listingCandidate?: ListingProductCandidate;
  enrichment?: DetailEnrichment;
}): N11Product {
  const { $, html, url, listingCandidate, enrichment } = options;
  const jsonLdProduct = parseJsonLdProduct($);
  const canonicalUrl = $('link[rel="canonical"]').attr('href');
  const productUrl = getAbsoluteUrl(canonicalUrl ?? undefined, url) ?? url;
  const productId = productUrl.match(/-(\d+)(?:\?.*)?$/)?.[1]
    ?? listingCandidate?.productId
    ?? extractInternalProductId(html, listingCandidate?.internalProductId ?? null)
    ?? productUrl;
  const title = cleanText($('h1.title').first().text()) || listingCandidate?.title || '';
  const currentPriceText = cleanText($('.newPrice').first().text()) || listingCandidate?.priceText || '';
  const currentPrice = parseTurkishPrice(currentPriceText);
  const originalPrice = parseNullablePrice(cleanText($('.oldPrice, .old-price').first().text()) || null);
  const sellerAnchor = $('a.sidebarSellerArea-top-name').first();
  const sellerName = cleanText(sellerAnchor.text()) || listingCandidate?.sellerName || 'Unknown Seller';
  const sellerUrl = getAbsoluteUrl(sellerAnchor.attr('href') ?? undefined, url);
  const breadcrumbPath = dedupeStrings(
    $('.breadcrumb a')
      .toArray()
      .map((element) => cleanText($(element).text()))
      .filter((value) => value && value.toLowerCase() !== 'homepage'),
  );
  const domSpecifications = extractDomSpecifications($);
  const specifications = {
    ...enrichment?.specifications,
    ...domSpecifications,
  };
  const brand = specifications.Marka ?? jsonLdProduct.brand ?? null;
  const imageUrls = dedupeStrings([
    ...$('.swiper-slide img')
      .toArray()
      .map((image) => getAbsoluteUrl($(image).attr('src') ?? $(image).attr('data-src') ?? undefined, url)),
    ...jsonLdProduct.imageUrls.map((imageUrl) => getAbsoluteUrl(imageUrl, url)),
    listingCandidate?.imageUrl ? getAbsoluteUrl(listingCandidate.imageUrl, url) : null,
  ]);
  const bodyText = cleanText($('body').text());
  const inStock = !/stokta yok|satista yok|tukendi|t\u00fckendi/i.test(bodyText);
  const rating = listingCandidate?.rating ?? jsonLdProduct.rating ?? null;
  const reviewCount = listingCandidate?.reviewCount ?? jsonLdProduct.reviewCount ?? null;

  return {
    scrapedAt: new Date().toISOString(),
    platform: 'n11',
    sourceUrl: url,
    dataVersion: DATA_VERSION,
    productId,
    title,
    brand,
    price: currentPrice,
    originalPrice,
    discountPercentage: computeDiscountPercentage(currentPrice.amount, originalPrice?.amount ?? null),
    rating,
    reviewCount,
    sellerName,
    sellerUrl,
    categoryPath: breadcrumbPath,
    imageUrls,
    inStock,
    productUrl,
    specifications,
    description: enrichment?.description ?? null,
  };
}

export function extractInternalProductIdFromDetailPage(html: string, listingCandidate?: ListingProductCandidate): string | null {
  return extractInternalProductId(html, listingCandidate?.internalProductId ?? null);
}
