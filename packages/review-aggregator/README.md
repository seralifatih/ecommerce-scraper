# Turkish E-Commerce Review Aggregator - Trendyol, Hepsiburada, N11 Reviews

Extract product reviews from the biggest Turkish marketplaces into one normalized dataset with built-in sentiment tags.

Pricing: $3 per 1,000 reviews.

## Why teams use it

- Monitor customer feedback across Trendyol, Hepsiburada, and N11 in one pipeline.
- Run basic Turkish sentiment analysis without building a custom tagging layer first.
- Track competitor complaints, product quality issues, and praise trends over time.
- Stream review-level records directly into dashboards, BI tools, or AI workflows.

## Works great with...

- [N11 Product Scraper](../n11-product-scraper/README.md) for product discovery and catalog context.
- [Turkish Marketplace Seller Intelligence](../seller-intelligence/README.md) for correlating review quality with seller trust signals.

## Input example

```json
{
  "productUrls": [
    "https://www.trendyol.com/spigen/ciel-by-cyrill-iphone-15-pro-kilif-cecile-flower-garden-acs06760-p-758714142",
    "https://www.hepsiburada.com/spigen-20w-usb-c-mini-hizli-sarj-aleti-sarj-isisini-dusurur-gan-destekli-akim-korumali-guc-adaptoru-iphone-android-ipad-type-c-white-ach02071-p-HBCV000008SWTT",
    "https://www.n11.com/urun/logitech-mk270-kablosuz-usb-turkce-q-klavye-mouse-seti-61465"
  ],
  "searchQuery": "kablosuz klavye",
  "platforms": ["trendyol", "hepsiburada", "n11"],
  "maxReviewsPerProduct": 100,
  "minRating": null,
  "sortBy": "recent",
  "proxyConfig": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "apifyProxyCountry": "TR"
  }
}
```

At least one of `productUrls` or `searchQuery` must be provided.

## Output Schema

Each review is emitted as its own dataset item. At the end of the run, the actor also emits a `RUN_SUMMARY` record.

```json
{
  "scrapedAt": "2026-04-04T11:02:15.512Z",
  "platform": "n11",
  "sourceUrl": "https://www.n11.com/urun/logitech-mk270-kablosuz-usb-turkce-q-klavye-mouse-seti-61465",
  "dataVersion": "product-review/v1",
  "productId": "61465",
  "productTitle": "Logitech MK270 Kablosuz USB Turkce Q Klavye Mouse Seti",
  "productUrl": "https://www.n11.com/urun/logitech-mk270-kablosuz-usb-turkce-q-klavye-mouse-seti-61465",
  "reviewId": "n11-61465-1",
  "reviewerName": "A*** K***",
  "rating": 5,
  "title": "Bekledigimden iyi",
  "body": "Kaliteli paketleme ve hizli teslimat. Tavsiye ederim.",
  "reviewDate": "2026-03-29T12:00:00.000Z",
  "isVerifiedPurchase": true,
  "helpfulCount": 3,
  "reviewImages": [],
  "sentimentTag": "positive",
  "sellerName": "GTI-Bilisim",
  "variantInfo": null
}
```

## Notes

- Ratings are normalized to a 1-5 scale across all supported marketplaces.
- Review records are pushed as they are collected, so you get streaming output instead of one large batch at the end.
- Progress logs include sentiment totals such as `Reviews collected: 230 (78 positive, 45 negative, 107 neutral)`.
- The dataset ends with a `RUN_SUMMARY` record that captures totals, duration, success rate, and platform breakdown.

## FAQ

**Is each dataset item a product or a review?**

Each dataset item is a single review. `productUrl` and `productTitle` are included on every row for context.

**Can I search for products instead of passing URLs?**

Yes. Use `searchQuery` and the actor will discover top products on the selected platforms before scraping reviews.

**How is sentiment assigned?**

The actor uses Turkish positive and negative keyword matching first, then falls back to rating-based tagging when the text is ambiguous.

**What happens if one product page or review endpoint fails?**

The actor retries when appropriate, logs the failure, and continues processing the rest of the run.

## 🇹🇷 Turkish Data Intelligence Portfolio

This actor is part of a suite of 9 specialized Turkish market data tools:

**E-Commerce Intelligence:**
- N11 Product Scraper — Turkey's third-largest marketplace
- Turkish Marketplace Seller Intelligence — Trendyol, Hepsiburada, N11 seller profiles
- Turkish E-Commerce Review Aggregator — Cross-platform reviews with sentiment analysis

**Automotive Intelligence:**
- Arabam.com Vehicle Scraper — Used car listings with paint condition data
- Turkish Auto Price Tracker — Cross-platform vehicle valuation
- Turkish Auto Dealer Intelligence — Galeri profiles and inventory analytics

**Real Estate Intelligence:**
- Emlakjet Property Scraper — Zero-competition property data
- Turkish Property Valuation Engine — Cross-platform pricing with rental yield analysis
- Turkish Real Estate Agency Scraper — Emlak ofisi profiles and portfolios

All actors share consistent output schemas, Turkish language support, and transparent 
pay-per-event pricing. Built and maintained by [your username].


This actor is part of a suite of 9 specialized Turkish market data tools:

**E-Commerce Intelligence:**
- N11 Product Scraper ? Turkey's third-largest marketplace
- Turkish Marketplace Seller Intelligence ? Trendyol, Hepsiburada, N11 seller profiles
- Turkish E-Commerce Review Aggregator ? Cross-platform reviews with sentiment analysis

**Automotive Intelligence:**
- Arabam.com Vehicle Scraper ? Used car listings with paint condition data
- Turkish Auto Price Tracker ? Cross-platform vehicle valuation
- Turkish Auto Dealer Intelligence ? Galeri profiles and inventory analytics

**Real Estate Intelligence:**
- Emlakjet Property Scraper ? Zero-competition property data
- Turkish Property Valuation Engine ? Cross-platform pricing with rental yield analysis
- Turkish Real Estate Agency Scraper ? Emlak ofisi profiles and portfolios

All actors share consistent output schemas, Turkish language support, and transparent 
pay-per-event pricing. Built and maintained by [your username].

This actor is part of a suite of 9 specialized Turkish market data tools:

**E-Commerce Intelligence:**
- N11 Product Scraper ? Turkey's third-largest marketplace
- Turkish Marketplace Seller Intelligence ? Trendyol, Hepsiburada, N11 seller profiles
- Turkish E-Commerce Review Aggregator ? Cross-platform reviews with sentiment analysis

**Automotive Intelligence:**
- Arabam.com Vehicle Scraper ? Used car listings with paint condition data
- Turkish Auto Price Tracker ? Cross-platform vehicle valuation
- Turkish Auto Dealer Intelligence ? Galeri profiles and inventory analytics

**Real Estate Intelligence:**
- Emlakjet Property Scraper ? Zero-competition property data
- Turkish Property Valuation Engine ? Cross-platform pricing with rental yield analysis
- Turkish Real Estate Agency Scraper ? Emlak ofisi profiles and portfolios

All actors share consistent output schemas, Turkish language support, and transparent 
pay-per-event pricing. Built and maintained by [your username].
Zero-competition property data
- Turkish Property Valuation Engine ? Cross-platform pricing with rental yield analysis
- Turkish Real Estate Agency Scraper ? Emlak ofisi profiles and portfolios

All actors share consistent output schemas, Turkish language support, and transparent 
pay-per-event pricing. Built and maintained by [your username].

This actor is part of a suite of 9 specialized Turkish market data tools:

**E-Commerce Intelligence:**
- N11 Product Scraper ? Turkey's third-largest marketplace
- Turkish Marketplace Seller Intelligence ? Trendyol, Hepsiburada, N11 seller profiles
- Turkish E-Commerce Review Aggregator ? Cross-platform reviews with sentiment analysis

**Automotive Intelligence:**
- Arabam.com Vehicle Scraper ? Used car listings with paint condition data
- Turkish Auto Price Tracker ? Cross-platform vehicle valuation
- Turkish Auto Dealer Intelligence ? Galeri profiles and inventory analytics

**Real Estate Intelligence:**
- Emlakjet Property Scraper ? Zero-competition property data
- Turkish Property Valuation Engine ? Cross-platform pricing with rental yield analysis
- Turkish Real Estate Agency Scraper ? Emlak ofisi profiles and portfolios

All actors share consistent output schemas, Turkish language support, and transparent 
pay-per-event pricing. Built and maintained by [your username].

## Changelog

### v1.0.0

- Added stronger input validation for product URLs, platform selection, and review limits.
- Added streaming progress reporting, partial completion handling, and final `RUN_SUMMARY` records.
- Added publication-ready README, actor metadata, and smoke-test checklist script.
