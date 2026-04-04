# CLAUDE.md — Turkish E-Commerce Intelligence Suite

## Project Overview

This repository contains a cluster of 3 Apify Actors targeting Turkish e-commerce platforms. They share a common codebase foundation, serve the same buyer persona, and are designed to cross-promote each other on the Apify Store.

### The Three Actors

| # | Actor Name | Target | Competition Level |
|---|-----------|--------|-------------------|
| 1 | **N11 Product Scraper** | n11.com product listings & details | Near-zero on Apify |
| 2 | **Turkish Marketplace Seller Intelligence** | Seller/store profiles on Trendyol, Hepsiburada, N11 | No dedicated actor exists |
| 3 | **Turkish E-Commerce Review Aggregator** | Product reviews from Trendyol, Hepsiburada, N11 | Fragmented, no unified solution |

### Buyer Persona

- **E-commerce sellers** doing cross-platform pricing and competitor research
- **Brands & agencies** monitoring their marketplace presence
- **Dropshippers** evaluating products and sellers across Turkish platforms
- **Market researchers** analyzing the Turkish e-commerce landscape
- **Sentiment analysis teams** needing structured review data

---

## Tech Stack

- **Runtime:** Node.js 20+
- **Framework:** Apify SDK v3 + Crawlee
- **Scraping:** Cheerio (preferred for speed/cost) with Playwright fallback for JS-heavy pages
- **Language:** TypeScript
- **Testing:** Jest for unit tests, Apify test runs for integration
- **Linting:** ESLint + Prettier

---

## Project Structure

```
turkish-ecommerce-suite/
├── CLAUDE.md                          # This file
├── packages/
│   ├── shared/                        # Shared utilities across all 3 actors
│   │   ├── src/
│   │   │   ├── types.ts               # Shared TypeScript interfaces
│   │   │   ├── proxy-config.ts        # Proxy rotation helpers
│   │   │   ├── rate-limiter.ts        # Request throttling
│   │   │   ├── normalizer.ts          # Price/currency/text normalization
│   │   │   ├── turkish-utils.ts       # Turkish character handling, locale
│   │   │   └── error-handler.ts       # Retry logic, error classification
│   │   └── package.json
│   │
│   ├── n11-product-scraper/           # Actor 1
│   │   ├── src/
│   │   │   ├── main.ts                # Entry point
│   │   │   ├── routes.ts              # Crawlee router (search, category, detail)
│   │   │   ├── parsers/
│   │   │   │   ├── search-parser.ts   # Parse search/category listing pages
│   │   │   │   └── detail-parser.ts   # Parse individual product pages
│   │   │   └── types.ts               # Actor-specific types
│   │   ├── .actor/
│   │   │   ├── actor.json             # Apify actor config
│   │   │   └── input_schema.json      # Input schema for Apify UI
│   │   ├── README.md                  # Store listing description
│   │   └── package.json
│   │
│   ├── seller-intelligence/           # Actor 2
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── routes.ts
│   │   │   ├── platforms/
│   │   │   │   ├── trendyol.ts        # Trendyol seller profile scraping
│   │   │   │   ├── hepsiburada.ts     # Hepsiburada seller scraping
│   │   │   │   └── n11.ts             # N11 seller/store scraping
│   │   │   └── types.ts
│   │   ├── .actor/
│   │   │   ├── actor.json
│   │   │   └── input_schema.json
│   │   ├── README.md
│   │   └── package.json
│   │
│   └── review-aggregator/             # Actor 3
│       ├── src/
│       │   ├── main.ts
│       │   ├── routes.ts
│       │   ├── platforms/
│       │   │   ├── trendyol.ts        # Trendyol review extraction
│       │   │   ├── hepsiburada.ts     # Hepsiburada review extraction
│       │   │   └── n11.ts             # N11 review extraction
│       │   ├── sentiment.ts           # Basic sentiment tagging (positive/negative/neutral)
│       │   └── types.ts
│       ├── .actor/
│       │   ├── actor.json
│       │   └── input_schema.json
│       ├── README.md
│       └── package.json
│
├── tsconfig.base.json
└── package.json                       # Monorepo root (npm workspaces)
```

---

## Shared Module: `packages/shared`

All three actors import from this module. Key utilities:

### `types.ts` — Shared Interfaces

```typescript
// Every output record must include these fields
interface BaseRecord {
  scrapedAt: string;        // ISO 8601 timestamp
  platform: 'trendyol' | 'hepsiburada' | 'n11';
  sourceUrl: string;        // The URL that was scraped
  dataVersion: string;      // Schema version, e.g. "1.0.0"
}
```

### `normalizer.ts` — Data Normalization

- **Price normalization:** Handle TRY formatting (dot as thousands separator, comma as decimal). Convert `"1.299,99 TL"` → `{ amount: 1299.99, currency: "TRY" }`.
- **Turkish text:** Handle İ/ı, Ğ/ğ, Ş/ş, Ö/ö, Ü/ü, Ç/ç correctly in comparisons and slugs.
- **Rating normalization:** Standardize to 0–5 scale regardless of platform (N11 uses 5-star, Trendyol uses 5-star, Hepsiburada uses 5-star).

### `rate-limiter.ts` — Request Throttling

- Default: 2–4 second delay between requests per domain.
- Exponential backoff on 429/503 responses.
- Configurable per-platform limits via actor input.

### `proxy-config.ts` — Proxy Setup

- Default to Apify's residential proxy group for Turkish IPs.
- Fall back to datacenter proxies for non-sensitive requests (images, static assets).
- Support user-provided proxy URLs.

### `error-handler.ts` — Error Classification

- Classify errors as `BLOCKED`, `RATE_LIMITED`, `PARSE_ERROR`, `NETWORK_ERROR`, `CAPTCHA`.
- Auto-retry on `RATE_LIMITED` and `NETWORK_ERROR` (max 3 retries).
- Log `PARSE_ERROR` with page snapshot for debugging.

---

## Actor 1: N11 Product Scraper

### Purpose
Extract product data from n11.com — search results, category pages, and individual product detail pages. N11 has virtually zero coverage on Apify Store.

### Input Schema

```json
{
  "searchQueries": ["laptop", "telefon kılıfı"],
  "categoryUrls": ["https://www.n11.com/bilgisayar"],
  "productUrls": ["https://www.n11.com/urun/..."],
  "maxProducts": 100,
  "scrapeDetails": true,
  "proxyConfig": { "useApifyProxy": true, "apifyProxyGroups": ["RESIDENTIAL"] }
}
```

### Output Schema (per product)

```typescript
interface N11Product extends BaseRecord {
  productId: string;
  title: string;
  brand: string | null;
  price: { amount: number; currency: string };
  originalPrice: { amount: number; currency: string } | null; // before discount
  discountPercentage: number | null;
  rating: number | null;         // 0-5
  reviewCount: number | null;
  sellerName: string;
  sellerUrl: string | null;
  categoryPath: string[];        // ["Elektronik", "Bilgisayar", "Laptop"]
  imageUrls: string[];
  inStock: boolean;
  productUrl: string;
  specifications: Record<string, string>;  // key-value pairs from specs table
  description: string | null;              // only if scrapeDetails=true
}
```

### Technical Notes — N11

- N11 uses server-side rendering for most product listing pages — **Cheerio is sufficient** for search/category pages.
- Product detail pages may have lazy-loaded tabs (specs, reviews) — use **Playwright** for detail pages if `scrapeDetails: true`.
- Pagination: N11 uses `?pg=2` style URL parameters for pagination. Max ~50 pages per search.
- Anti-bot: N11 has moderate protection. Residential proxies recommended. Rotate User-Agent strings.
- API endpoints: Check if N11 has internal API calls (XHR) that return JSON — these are faster and more reliable than HTML parsing. Inspect network tab on search pages.

### Pricing Strategy
- Pay-per-event: $5 per 1,000 products scraped.
- Free tier: First 100 products per run.

---

## Actor 2: Turkish Marketplace Seller Intelligence

### Purpose
Scrape seller/store profiles across Trendyol, Hepsiburada, and N11. Existing actors focus on products — this one focuses on the **sellers themselves**: store ratings, product counts, follower counts, response times, badges, and store metadata.

### Input Schema

```json
{
  "platforms": ["trendyol", "hepsiburada", "n11"],
  "sellerUrls": ["https://www.trendyol.com/magaza/..."],
  "searchBySeller": "Samsung",
  "searchByCategory": "Elektronik",
  "maxSellers": 50,
  "proxyConfig": { "useApifyProxy": true }
}
```

### Output Schema (per seller)

```typescript
interface SellerProfile extends BaseRecord {
  sellerId: string;
  sellerName: string;
  sellerUrl: string;
  storeLogo: string | null;
  
  // Metrics
  overallRating: number | null;       // 0-5
  totalReviews: number | null;
  totalProducts: number | null;
  followerCount: number | null;       // Trendyol has this
  
  // Trust signals
  badges: string[];                    // e.g. ["Süper Satıcı", "Hızlı Teslimat"]
  memberSince: string | null;         // ISO date
  responseTime: string | null;        // e.g. "2 saat içinde"
  returnRate: string | null;          // if available
  onTimeDeliveryRate: string | null;  // if available
  
  // Business info
  companyName: string | null;
  companyAddress: string | null;
  taxId: string | null;               // Vergi numarası if public
  contactEmail: string | null;
  contactPhone: string | null;
  
  // Top categories
  topCategories: string[];
}
```

### Technical Notes — Per Platform

**Trendyol Seller Pages:**
- URL pattern: `https://www.trendyol.com/magaza/SELLER-NAME-m-SELLER_ID`
- Seller profiles load via internal API: `https://api.trendyol.com/websearchgw/v2/sellers/{sellerId}`
- Check network tab for JSON endpoints — often faster than parsing HTML.
- Seller rating, follower count, and badges are available on the store page.

**Hepsiburada Seller Pages:**
- URL pattern: `https://www.hepsiburada.com/magaza/SELLER-NAME`
- Seller info is partially rendered server-side.
- Key data: store rating, product count, member since date.
- Merchant ID can be extracted from page source for API calls.

**N11 Seller Pages:**
- URL pattern: `https://www.n11.com/magaza/SELLER-NAME`
- Seller stats are on the store page: rating, product count, response rate.
- Less anti-bot protection than Trendyol.

### Pricing Strategy
- Pay-per-event: $8 per 1,000 seller profiles.
- Higher price justified by multi-platform coverage and enriched data.

---

## Actor 3: Turkish E-Commerce Review Aggregator

### Purpose
Extract product reviews from all three platforms into a **unified schema**. Buyers use this for sentiment analysis, product feedback monitoring, and competitive intelligence. No existing actor aggregates reviews across Turkish platforms.

### Input Schema

```json
{
  "productUrls": [
    "https://www.trendyol.com/urun/...",
    "https://www.hepsiburada.com/...",
    "https://www.n11.com/urun/..."
  ],
  "searchQuery": "iphone 15 kılıf",
  "platforms": ["trendyol", "hepsiburada", "n11"],
  "maxReviewsPerProduct": 100,
  "minRating": null,
  "sortBy": "recent",
  "proxyConfig": { "useApifyProxy": true }
}
```

### Output Schema (per review)

```typescript
interface ProductReview extends BaseRecord {
  productId: string;
  productTitle: string;
  productUrl: string;
  
  // Review data
  reviewId: string;
  reviewerName: string | null;       // anonymized if needed
  rating: number;                     // 1-5 normalized
  title: string | null;
  body: string;
  reviewDate: string;                 // ISO 8601
  isVerifiedPurchase: boolean;
  
  // Engagement
  helpfulCount: number | null;        // "Bu yorumu faydalı buldunuz mu?"
  
  // Media
  reviewImages: string[];
  
  // Enrichment
  sentimentTag: 'positive' | 'negative' | 'neutral' | 'mixed';
  sellerName: string | null;          // Which seller this review is for
  variantInfo: string | null;         // e.g. "Renk: Siyah, Beden: M"
}
```

### Technical Notes — Reviews

**Trendyol Reviews:**
- Reviews load via XHR: `https://public-mdc.trendyol.com/discovery-web-socialgw-service/api/review/{contentId}`
- Paginated JSON response — no need for HTML parsing.
- Includes star breakdown, reviewer info, images, helpfulness votes.

**Hepsiburada Reviews:**
- Reviews are loaded dynamically.
- Check for API endpoint: `/product-reviews/` with SKU parameter.
- May need Playwright for initial page load to capture API URLs.

**N11 Reviews:**
- Reviews tab on product pages.
- May use pagination via AJAX calls — inspect network tab.
- Less structured than Trendyol's API.

### Sentiment Tagging
- Use a simple keyword-based approach (no external API dependency):
  - **Positive keywords (TR):** mükemmel, harika, süper, memnunum, tavsiye ederim, kaliteli, hızlı kargo
  - **Negative keywords (TR):** kötü, berbat, memnun değilim, iade ettim, bozuk, sahte, geç geldi
  - **Neutral:** Reviews with mixed signals or no strong keywords
- Rating-based fallback: 4-5 stars → positive, 1-2 → negative, 3 → neutral
- This keeps the actor lightweight. Users who want deeper NLP can pipe the output into their own models.

### Pricing Strategy
- Pay-per-event: $3 per 1,000 reviews.
- Lower price because reviews are higher volume and users may need large datasets.

---

## Development Guidelines

### Build Order
1. **Start with N11 Product Scraper** — it's the simplest, has zero competition, and validates the shared module.
2. **Then Seller Intelligence** — builds on shared module, adds multi-platform logic.
3. **Then Review Aggregator** — most complex, benefits from patterns established in actors 1 and 2.

### Code Quality Standards
- Every parser function must have at least one unit test with a saved HTML snapshot.
- Use Zod or similar for runtime validation of scraped data.
- Log warnings (not errors) for missing optional fields — never crash on a null.
- Every actor must handle graceful shutdown (Apify's `migrating` event).

### Anti-Detection Best Practices
- Rotate User-Agent strings (maintain a list of 20+ recent Chrome UAs).
- Add random delays between 2-5 seconds (not fixed intervals).
- Respect robots.txt for each platform.
- Never scrape while logged in — only public data.
- Set `maxConcurrency` conservatively: 3 for Trendyol, 5 for N11, 3 for Hepsiburada.

### README Template (for Apify Store Listing)
Each actor's README should follow this structure:
1. **One-liner:** What it does in one sentence.
2. **Use cases:** 3-4 bullet points with concrete scenarios.
3. **Input example:** Minimal JSON showing the simplest use case.
4. **Output example:** One complete output record.
5. **Features:** What makes this actor better than alternatives.
6. **Pricing:** Clear table with cost per 1,000 results.
7. **FAQ:** 3-5 common questions.
8. **Limitations:** Honest about what it can't do.

### Store Optimization
- Use Turkish AND English in actor title and description for discoverability.
- Add relevant tags: `turkey`, `trendyol`, `hepsiburada`, `n11`, `e-commerce`, `marketplace`, `turkish`
- Cross-reference the other two actors in each README.
- Include a "Works great with..." section linking to the sibling actors.

### Monitoring & Maintenance
- Schedule weekly test runs on each actor to catch site changes.
- Set up Apify webhooks to alert on failure rate > 10%.
- Track monthly active users and revenue per actor via the Apify dashboard.
- Prioritize fixing the highest-revenue actor first when sites change.

---

## Deployment Checklist (per actor)

- [ ] All unit tests pass
- [ ] Integration test with 10 real URLs succeeds
- [ ] Input schema validates in Apify console
- [ ] README is complete with examples
- [ ] Pricing is configured (pay-per-event)
- [ ] Tags and categories are set
- [ ] Actor is published as "public" on Apify Store
- [ ] Test run from a clean account (no cookies/state)
- [ ] Cross-references to sibling actors in README
