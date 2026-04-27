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

function isProductImageUrl(url: string): boolean {
  if (url.startsWith('data:')) {
    return false;
  }

  if (!/^https?:/i.test(url)) {
    return false;
  }

  // N11 thumbnail/decoration sizes (badges, thumbnails, sponsored markers).
  if (/\/a1\/(?:60_86|220_315|110_158)\//.test(url)) {
    return false;
  }

  // N11 logo and watermark CDN paths.
  if (/n11scdn\.akamaized\.net\/.*1197431073752174383\.png/.test(url)) {
    return false;
  }

  return true;
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

interface InlineProductState {
  brand: string | null;
  sellerName: string | null;
  sellerSlug: string | null;
  imageUrls: string[];
  rating: number | null;
  reviewCount: number | null;
}

function parseInlineProductState(html: string): InlineProductState | null {
  const marker = '<script>window.model = ';
  const startIdx = html.indexOf(marker);

  if (startIdx < 0) {
    return null;
  }

  const jsonStart = startIdx + marker.length;
  const endIdx = html.indexOf('</script>', jsonStart);

  if (endIdx < 0) {
    return null;
  }

  const raw = html.slice(jsonStart, endIdx).replace(/;\s*$/, '');
  let state: any;

  try {
    state = JSON.parse(raw);
  } catch {
    return null;
  }

  const jsonLd = state?.jsonLDProduct ?? {};
  const productMeta = state?.productMeta ?? {};
  const seller = state?.product?.seller ?? {};
  const images = Array.isArray(state?.product?.images) ? state.product.images : [];
  const aggregateRating = jsonLd?.aggregateRating ?? {};

  const brand = typeof jsonLd?.brand === 'string'
    ? cleanText(jsonLd.brand)
    : typeof productMeta?.brand === 'string'
      ? cleanText(productMeta.brand)
      : null;

  const sellerName = typeof seller?.nickName === 'string' && seller.nickName.trim()
    ? cleanText(seller.nickName)
    : typeof seller?.businessName === 'string' && seller.businessName?.trim()
      ? cleanText(seller.businessName)
      : null;

  const sellerSlug = typeof state?.response?.sellerShopBookmarkableUrl === 'string'
    ? state.response.sellerShopBookmarkableUrl
    : null;

  const imageUrls: string[] = [];
  for (const image of images) {
    const path = typeof image?.path === 'string' ? image.path : null;
    if (!path) continue;
    // N11 image paths contain a {0} size placeholder — substitute with org for full size.
    imageUrls.push(path.replace('{0}', 'org'));
  }

  const ratingValue = typeof aggregateRating?.ratingValue === 'number'
    ? aggregateRating.ratingValue
    : Number.parseFloat(aggregateRating?.ratingValue);
  const reviewCountValue = Number.parseInt(aggregateRating?.reviewCount ?? aggregateRating?.ratingCount, 10);

  return {
    brand,
    sellerName,
    sellerSlug,
    imageUrls,
    rating: Number.isFinite(ratingValue) ? ratingValue : null,
    reviewCount: Number.isFinite(reviewCountValue) ? reviewCountValue : null,
  };
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
  const inlineState = parseInlineProductState(html);
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
  const sellerName = inlineState?.sellerName
    || cleanText(sellerAnchor.text())
    || listingCandidate?.sellerName
    || 'Unknown Seller';
  const sellerUrl = (inlineState?.sellerSlug ? `https://www.n11.com/magaza/${inlineState.sellerSlug}` : null)
    ?? getAbsoluteUrl(sellerAnchor.attr('href') ?? undefined, url);
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
  const brand = inlineState?.brand
    || specifications.Marka
    || jsonLdProduct.brand
    || null;
  const imageUrls = dedupeStrings([
    ...(inlineState?.imageUrls ?? []).map((imageUrl) => getAbsoluteUrl(imageUrl, url)),
    ...$('.swiper-slide img')
      .toArray()
      .map((image) => getAbsoluteUrl($(image).attr('src') ?? $(image).attr('data-src') ?? undefined, url)),
    ...jsonLdProduct.imageUrls.map((imageUrl) => getAbsoluteUrl(imageUrl, url)),
    listingCandidate?.imageUrl ? getAbsoluteUrl(listingCandidate.imageUrl, url) : null,
  ]).filter(isProductImageUrl);
  const bodyText = cleanText($('body').text());
  const inStock = !/stokta yok|satista yok|tukendi|t\u00fckendi/i.test(bodyText);
  const rating = listingCandidate?.rating ?? inlineState?.rating ?? jsonLdProduct.rating ?? null;
  const reviewCount = listingCandidate?.reviewCount ?? inlineState?.reviewCount ?? jsonLdProduct.reviewCount ?? null;

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
