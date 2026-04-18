# Turkish Marketplace Seller Intelligence - Trendyol, Hepsiburada, N11

Scrape normalized seller and store profiles across the three biggest Turkish marketplaces from one actor.

Pricing: $8 per 1,000 seller profiles.

## Why teams use it

- Evaluate suppliers and marketplace partners before outreach or onboarding.
- Compare top sellers in a category across multiple Turkish channels.
- Monitor trust badges, store ratings, product volume, and public business details.
- Build marketplace leaderboards for sourcing, brand monitoring, and competitor research.

## Works great with...

- [N11 Product Scraper](../n11-product-scraper/README.md) for product-to-seller mapping.
- [Turkish E-Commerce Review Aggregator](../review-aggregator/README.md) for linking seller quality to customer sentiment.

## Input example

```json
{
  "platforms": ["trendyol", "hepsiburada", "n11"],
  "sellerUrls": [
    "https://www.trendyol.com/magaza/makyaj-trendi-m-183874",
    "https://www.hepsiburada.com/magaza/hepsiburada",
    "https://www.n11.com/magaza/gti-bilisim"
  ],
  "searchBySeller": "Samsung",
  "searchByCategory": "Elektronik",
  "maxSellers": 50,
  "proxyConfig": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "apifyProxyCountry": "TR"
  }
}
```

At least one of `sellerUrls`, `searchBySeller`, or `searchByCategory` must be provided.

## Output Schema

Each seller profile is emitted as its own dataset item. At the end of the run, the actor also emits a `RUN_SUMMARY` record.

```json
{
  "scrapedAt": "2026-04-04T10:40:00.000Z",
  "platform": "n11",
  "sourceUrl": "https://www.n11.com/magaza/gti-bilisim",
  "dataVersion": "seller-profile/v1",
  "sellerId": "gti-bilisim",
  "sellerName": "GTI-Bilisim",
  "sellerUrl": "https://www.n11.com/magaza/gti-bilisim",
  "storeLogo": "https://n11scdn.akamaized.net/example-store-logo.jpg",
  "overallRating": 5,
  "totalReviews": null,
  "totalProducts": 20,
  "followerCount": null,
  "badges": [
    "Basarili Magaza"
  ],
  "memberSince": null,
  "responseTime": null,
  "returnRate": null,
  "onTimeDeliveryRate": null,
  "companyName": null,
  "companyAddress": null,
  "taxId": null,
  "contactEmail": null,
  "contactPhone": null,
  "topCategories": []
}
```

## Notes

- Direct seller URLs are validated against supported seller-page domains before the crawl starts.
- The actor logs platform discovery counts such as `Platform: trendyol - 45 sellers found`.
- Missing optional marketplace-specific fields are logged as warnings, never treated as fatal extraction errors.
- The dataset ends with a `RUN_SUMMARY` record containing totals, platform breakdown, duration, and error count.

## FAQ

**Can I scrape only one marketplace?**

Yes. Use the `platforms` field to limit the run to any combination of Trendyol, Hepsiburada, and N11.

**Does this actor scrape products too?**

No. This actor is focused on store and seller profiles, not product listings.

**What happens when a marketplace does not expose a public field?**

That field stays `null` and the actor logs a warning instead of failing the seller record.

**Can I start from a seller name instead of a direct URL?**

Yes. Use `searchBySeller` to discover sellers by name, or `searchByCategory` to find leading sellers in a category.

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

- Added stronger multi-platform input validation and clearer user-facing errors.
- Added progress reporting, partial completion handling, and final run summary records.
- Added publication-ready README, actor metadata, and smoke-test checklist script.
