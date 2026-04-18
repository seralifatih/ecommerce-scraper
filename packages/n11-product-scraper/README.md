# N11 Product Scraper - Turkey's Marketplace Data Extractor

Scrape N11 search results, category listings, and direct product pages into clean Turkish e-commerce product data.

Pricing: $5 per 1,000 products.

## Why teams use it

- Monitor live N11 pricing, seller coverage, and assortment changes.
- Build category catalogs for competitor tracking and pricing intelligence.
- Feed product URLs into seller and review workflows in the same workspace.
- Collect structured product pages without writing custom parsers for every field.

## Works great with...

- [Turkish Marketplace Seller Intelligence](../seller-intelligence/README.md) for seller profile enrichment.
- [Turkish E-Commerce Review Aggregator](../review-aggregator/README.md) for review and sentiment context.

## Input example

```json
{
  "searchQueries": ["laptop", "kahve makinesi"],
  "categoryUrls": [
    "https://www.n11.com/elektronik"
  ],
  "productUrls": [
    "https://www.n11.com/urun/logitech-mk270-kablosuz-usb-turkce-q-klavye-mouse-seti-61465"
  ],
  "maxProducts": 100,
  "scrapeDetails": true,
  "proxyConfig": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "apifyProxyCountry": "TR"
  }
}
```

At least one of `searchQueries`, `categoryUrls`, or `productUrls` must be provided.

## Output Schema

Each product is emitted as its own dataset item. At the end of the run, the actor also emits a `RUN_SUMMARY` record.

```json
{
  "scrapedAt": "2026-04-04T10:15:22.000Z",
  "platform": "n11",
  "sourceUrl": "https://www.n11.com/urun/logitech-mk270-kablosuz-usb-turkce-q-klavye-mouse-seti-61465",
  "dataVersion": "1.0.0",
  "productId": "61465",
  "title": "Logitech MK270 Kablosuz USB Turkce Q Klavye Mouse Seti",
  "brand": "Logitech",
  "price": {
    "amount": 1199.9,
    "currency": "TRY"
  },
  "originalPrice": null,
  "discountPercentage": null,
  "rating": 4.7,
  "reviewCount": 124,
  "sellerName": "GTI-Bilisim",
  "sellerUrl": "https://www.n11.com/magaza/gti-bilisim",
  "categoryPath": [
    "Elektronik",
    "Bilgisayar",
    "Klavye ve Mouse"
  ],
  "imageUrls": [
    "https://n11scdn.akamaized.net/a1/375_535/example-image.jpg"
  ],
  "inStock": true,
  "productUrl": "https://www.n11.com/urun/logitech-mk270-kablosuz-usb-turkce-q-klavye-mouse-seti-61465",
  "specifications": {
    "Marka": "Logitech",
    "Baglanti": "Kablosuz"
  },
  "description": "Wireless keyboard and mouse set for everyday office use."
}
```

## Notes

- Input validation returns clear English messages for bad URLs, empty source inputs, and invalid limits.
- Invalid or incomplete product pages are skipped with warnings instead of crashing the run.
- The actor reports progress during crawling and emits a final `RUN_SUMMARY` record with totals, duration, and success rate.
- Residential Turkish proxies are recommended for the most stable production runs.

## FAQ

**Do I have to use search queries?**

No. You can run the actor with direct `productUrls`, `categoryUrls`, or any combination of supported inputs.

**Does the actor scrape product details or only listings?**

It does both. Listing pages discover products, and detail pages extract the full product record.

**What happens if one product page fails?**

The actor logs a warning, retries when appropriate, and continues with the rest of the queue.

**Is there a final summary record in the dataset?**

Yes. The last dataset item is a `RUN_SUMMARY` record with record totals, platform counts, errors, duration, and success rate.

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

- Added production-ready input validation with clear English error messages.
- Added resilient run summaries, progress logging, and partial completion reporting.
- Added publication-ready README, actor metadata, and local checklist smoke tests.
