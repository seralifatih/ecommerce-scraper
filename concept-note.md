# Concept Note: Turkish E-Commerce Intelligence Suite
## Apify Actor Cluster — Build Plan & Prompts

---

## 1. Executive Summary

This document outlines the strategy, rationale, and implementation prompts for building a cluster of three related Apify Actors targeting the Turkish e-commerce ecosystem. The cluster serves a single buyer persona (e-commerce sellers, brands, and agencies operating in Turkey) with three complementary data products:

1. **N11 Product Scraper** — Product data extraction from Turkey's third-largest marketplace (near-zero competition on Apify)
2. **Turkish Marketplace Seller Intelligence** — Seller/store profile data across Trendyol, Hepsiburada, and N11 (no dedicated actor exists)
3. **Turkish E-Commerce Review Aggregator** — Unified review extraction with sentiment tagging across all three platforms

The cluster strategy creates a flywheel: users who discover one actor are likely to need the others. Each actor links to its siblings in the README, and all three share the same tag surface area on the Apify Store.

---

## 2. Market Analysis

### Competitive Landscape (as of April 2026)

**Trendyol scrapers on Apify:** ~15+ actors exist. Most focus on product search and product details. Key players include `fatihtahta/trendyol-scraper` (all-in-one, $6/1K) and `ecomscrape/trendyol-product-search-scraper`. Several email/phone scrapers also exist. The product scraping space is **crowded**.

**Hepsiburada scrapers on Apify:** ~5-8 actors. `fatihtahta/hepsiburada-scraper` ($5/1K) is the most active. Some older actors are deprecated. **Moderate competition.**

**N11 scrapers on Apify:** Virtually none. A search for "N11" returns no dedicated, actively maintained product scraper. This is the clearest gap in the Turkish e-commerce category. **Near-zero competition.**

**Seller intelligence (any platform):** No dedicated actor exists that focuses on seller profiles rather than products. This is a different data product with a different use case. **No direct competition.**

**Cross-platform review aggregation:** Individual review scrapers exist for Trendyol (limited), but no actor aggregates reviews across multiple Turkish platforms into a unified schema. **No direct competition.**

### Why This Angle Wins

- **N11 is Turkey's 3rd largest marketplace** with 30M+ products. The absence of scrapers is a genuine market gap, not a sign of low demand.
- **Seller intelligence** is a premium use case. Brands pay for this data to evaluate marketplace partners, and agencies need it for client reporting.
- **Review aggregation** serves the growing demand for sentiment analysis and customer feedback monitoring in Turkish e-commerce.
- **Shared infrastructure** means you maintain one codebase, not three separate projects.

### Revenue Projections (Conservative)

| Actor | Price / 1K | Monthly Runs (est.) | Monthly Revenue |
|-------|-----------|---------------------|-----------------|
| N11 Product Scraper | $5 | 200 | $100-300 |
| Seller Intelligence | $8 | 100 | $80-250 |
| Review Aggregator | $3 | 300 | $90-270 |
| **Total** | | | **$270-820** |

These are early-stage estimates. Top Apify actors in similar niches (regional e-commerce) earn $500-2,000/month once established with good reviews and SEO.

---

## 3. Technical Architecture

### Shared Foundation

All three actors share a `packages/shared` module containing:

- **Price normalization** (Turkish Lira formatting with dots/commas)
- **Turkish text utilities** (İ/ı case handling, slug generation)
- **Proxy configuration** (residential proxies for Turkish IP addresses)
- **Rate limiting** (per-domain throttling with exponential backoff)
- **Error classification** (BLOCKED, RATE_LIMITED, PARSE_ERROR, CAPTCHA)
- **Base TypeScript types** (BaseRecord with scrapedAt, platform, sourceUrl)

### Platform-Specific Patterns

| Platform | Rendering | Best Approach | Anti-Bot Level |
|----------|-----------|---------------|----------------|
| N11 | Mostly SSR | Cheerio + Playwright fallback | Low-Medium |
| Trendyol | API-driven | Direct API calls where possible | Medium-High |
| Hepsiburada | Mixed SSR/CSR | Cheerio for listings, Playwright for details | Medium |

### Key Technical Decisions

1. **Crawlee framework** — Provides request queue, proxy rotation, and retry logic out of the box.
2. **Cheerio-first** — HTML parsing with Cheerio is 10x cheaper (in compute units) than Playwright. Only use Playwright when JavaScript rendering is required.
3. **API interception** — Where platforms load data via XHR/fetch (especially Trendyol), intercept and use those endpoints directly. This is faster, cheaper, and more reliable than HTML parsing.
4. **TypeScript** — Type safety prevents schema drift and makes maintenance easier.
5. **Zod validation** — Runtime validation of scraped data catches parse errors before they reach the user's dataset.

---

## 4. Build Prompts

The following prompts are designed to be used with Claude Code or similar AI coding assistants. Each prompt builds on the previous one. Use them in sequence.

---

### Prompt 1: Scaffold the Monorepo

```
You are building an Apify Actor monorepo for Turkish e-commerce scraping. 

Set up an npm workspaces monorepo with this structure:
- Root package.json with workspaces: ["packages/*"]
- tsconfig.base.json with strict mode, ES2022 target, NodeNext module resolution
- packages/shared/ — shared utilities library
- packages/n11-product-scraper/ — Apify Actor
- packages/seller-intelligence/ — Apify Actor  
- packages/review-aggregator/ — Apify Actor

For each actor package:
- Initialize with `npx apify create` template for TypeScript + Crawlee
- Add dependency on @workspace/shared
- Create .actor/actor.json with appropriate metadata
- Create .actor/input_schema.json (empty for now, we'll fill it later)

For the shared package:
- Create src/index.ts that exports all utilities
- Create placeholder files: types.ts, normalizer.ts, proxy-config.ts, rate-limiter.ts, turkish-utils.ts, error-handler.ts

Install these dependencies at root:
- crawlee, apify, cheerio, playwright, zod, typescript, jest, @types/node

Make sure `npm run build` works from root and compiles all packages.
Do NOT implement any scraping logic yet — just the project skeleton.
```

---

### Prompt 2: Build the Shared Module

```
Implement the shared utilities module at packages/shared/src/. 
Reference the CLAUDE.md file for the full specification.

Implement these files:

1. **types.ts** — Define BaseRecord interface (scrapedAt, platform, sourceUrl, dataVersion). 
   Define Platform type as 'trendyol' | 'hepsiburada' | 'n11'.
   Define PriceInfo type: { amount: number; currency: string }.
   Define ErrorType enum: BLOCKED, RATE_LIMITED, PARSE_ERROR, NETWORK_ERROR, CAPTCHA.

2. **normalizer.ts** — Implement:
   - parseTurkishPrice(text: string): PriceInfo — handles "1.299,99 TL", "₺1299.99", "1299,99", etc.
   - normalizeRating(value: number, maxScale: number): number — normalizes any rating to 0-5
   - cleanText(text: string): string — trims, removes extra whitespace, normalizes unicode
   - generateSlug(text: string): string — Turkish-aware URL slug generation

3. **turkish-utils.ts** — Implement:
   - turkishLowerCase(text: string): string — correctly handles İ→i, I→ı
   - turkishUpperCase(text: string): string — correctly handles i→İ, ı→I
   - turkishCompare(a: string, b: string): number — locale-aware string comparison

4. **rate-limiter.ts** — Implement a simple per-domain rate limiter:
   - Class RateLimiter with constructor(defaultDelayMs: number, maxRetries: number)
   - Method wait(domain: string): Promise<void> — enforces delay between requests to same domain
   - Method backoff(domain: string): void — doubles the delay for a domain (called on 429/503)
   - Method reset(domain: string): void — resets delay to default

5. **proxy-config.ts** — Implement:
   - getProxyConfig(userConfig?: any): ProxyConfiguration — returns Apify proxy config
   - Default to residential proxies with Turkish IP preference
   - Support user-provided proxy URLs as override

6. **error-handler.ts** — Implement:
   - classifyError(error: Error, statusCode?: number): ErrorType
   - shouldRetry(errorType: ErrorType): boolean
   - getRetryDelay(attempt: number): number — exponential backoff

Write Jest unit tests for normalizer.ts and turkish-utils.ts.
The tests should cover edge cases like empty strings, missing currency symbols, and Turkish character edge cases.
```

---

### Prompt 3: Build Actor 1 — N11 Product Scraper

```
Build the N11 Product Scraper actor at packages/n11-product-scraper/.
Reference the CLAUDE.md for the full output schema and technical notes.

IMPORTANT: Before writing any scraping code, first investigate n11.com:
- Visit https://www.n11.com and search for a product
- Check if search results are server-side rendered (view page source)
- Inspect the Network tab for any JSON API endpoints (XHR calls)
- Check the pagination pattern (URL parameters)
- Visit a product detail page and inspect the DOM structure for: title, price, seller, specs, images
- Check if product detail tabs (specs, reviews) load via AJAX

Based on your investigation, implement:

1. **.actor/input_schema.json** — Define input with these fields:
   - searchQueries (array of strings, optional)
   - categoryUrls (array of strings, optional) 
   - productUrls (array of strings, optional)
   - maxProducts (integer, default 100)
   - scrapeDetails (boolean, default true)
   - proxyConfig (Apify proxy config object)
   At least one of searchQueries, categoryUrls, or productUrls must be provided.

2. **src/main.ts** — Actor entry point:
   - Read input, validate with Zod
   - Set up CheerioCrawler (or PlaywrightCrawler if needed)
   - Configure proxy from shared module
   - Add start URLs based on input type
   - Handle graceful migration (Actor.on('migrating'))

3. **src/routes.ts** — Crawlee router with handlers for:
   - SEARCH: Parse search result pages, extract product cards, enqueue next page
   - CATEGORY: Parse category pages (similar to search)
   - DETAIL: Parse individual product pages for full data extraction

4. **src/parsers/search-parser.ts** — Extract from listing pages:
   - Product title, price, image, seller name, rating, review count
   - Product URL for detail page enqueuing
   - Next page URL for pagination

5. **src/parsers/detail-parser.ts** — Extract from detail pages:
   - Full title, brand, all prices (current + original)
   - Specifications table as key-value pairs
   - All image URLs
   - Seller info (name, URL)
   - Stock status
   - Category breadcrumb path
   - Description HTML (cleaned to text)

6. **README.md** — Write a compelling Apify Store listing:
   - Title: "N11 Product Scraper — Turkey's Marketplace Data Extractor"
   - One-liner, use cases, input/output examples
   - Mention it works with the Seller Intelligence and Review Aggregator actors
   - Include pricing: $5 per 1,000 products

Use the shared module for price parsing, text normalization, proxy config, and rate limiting.
Handle errors gracefully — log warnings for missing optional fields, never crash.
Use Zod schemas to validate each scraped record before pushing to dataset.
```

---

### Prompt 4: Build Actor 2 — Seller Intelligence

```
Build the Turkish Marketplace Seller Intelligence actor at packages/seller-intelligence/.
Reference the CLAUDE.md for the full output schema.

This actor scrapes seller/store PROFILES (not products) across three platforms.

IMPORTANT: Before coding, investigate each platform's seller pages:
- Trendyol: Visit https://www.trendyol.com/magaza/[store-name]-m-[id] 
  Check for API endpoint at api.trendyol.com for seller data
- Hepsiburada: Visit https://www.hepsiburada.com/magaza/[store-name]
  Check for merchant API endpoints
- N11: Visit https://www.n11.com/magaza/[store-name]
  Check DOM structure for seller stats

Implement:

1. **.actor/input_schema.json** — Fields:
   - platforms (array of enum: trendyol/hepsiburada/n11, default all three)
   - sellerUrls (array of strings — direct store page URLs)
   - searchBySeller (string — search for sellers by name)
   - searchByCategory (string — find top sellers in a category)
   - maxSellers (integer, default 50)
   - proxyConfig

2. **src/main.ts** — Entry point with multi-platform routing:
   - Detect platform from URL domain
   - Route to appropriate platform handler
   - Merge results into unified output schema

3. **src/platforms/trendyol.ts** — Trendyol seller scraping:
   - Parse seller profile page OR use seller API if available
   - Extract: name, rating, follower count, product count, badges
   - Extract business info if publicly displayed
   - Handle "Süper Satıcı" and other trust badges

4. **src/platforms/hepsiburada.ts** — Hepsiburada seller scraping:
   - Parse seller store page
   - Extract: name, rating, product count, member since
   - Extract business info (company name, address if public)

5. **src/platforms/n11.ts** — N11 seller scraping:
   - Parse seller store page
   - Extract: name, rating, product count, response rate
   - N11 shows seller stats on store pages

6. **README.md** — Store listing:
   - Title: "Turkish Marketplace Seller Intelligence — Trendyol, Hepsiburada, N11"
   - Emphasize multi-platform coverage
   - Use cases: supplier evaluation, competitive analysis, brand monitoring
   - Pricing: $8 per 1,000 seller profiles
   - Cross-reference N11 Product Scraper and Review Aggregator

Each platform module should export a single function:
  async function scrapeSeller(url: string, crawler: CheerioCrawler): Promise<SellerProfile>

Normalize all outputs to the shared SellerProfile schema regardless of platform.
Log platform-specific fields that couldn't be found as warnings (not errors).
```

---

### Prompt 5: Build Actor 3 — Review Aggregator

```
Build the Turkish E-Commerce Review Aggregator at packages/review-aggregator/.
Reference the CLAUDE.md for the full output schema.

This actor extracts product reviews from Trendyol, Hepsiburada, and N11 into a UNIFIED schema with basic sentiment tagging.

IMPORTANT: Before coding, investigate each platform's review system:
- Trendyol: Check for review API at public-mdc.trendyol.com/discovery-web-socialgw-service/api/review/
- Hepsiburada: Check for review API endpoint with SKU parameter
- N11: Check how reviews load on product detail pages (AJAX vs SSR)

Implement:

1. **.actor/input_schema.json** — Fields:
   - productUrls (array — direct product page URLs from any platform)
   - searchQuery (string — search for products, then scrape their reviews)
   - platforms (array of enum, default all three)
   - maxReviewsPerProduct (integer, default 100)
   - minRating (integer 1-5, null for all)
   - sortBy (enum: "recent", "helpful", "highest", "lowest")
   - proxyConfig

2. **src/main.ts** — Entry point:
   - Detect platform from each URL
   - Route to appropriate platform handler
   - Push reviews to dataset as they're collected (streaming, not batch)

3. **src/platforms/trendyol.ts** — Trendyol review extraction:
   - Use the review API endpoint if available (preferred — structured JSON)
   - Extract: reviewer name, rating, title, body, date, images, helpful count
   - Handle pagination of reviews
   - Extract verified purchase flag

4. **src/platforms/hepsiburada.ts** — Hepsiburada review extraction:
   - Parse review section of product pages
   - Extract same fields as Trendyol
   - Handle lazy-loaded review content

5. **src/platforms/n11.ts** — N11 review extraction:
   - Parse review tab/section
   - Extract available fields (N11 may have fewer fields than Trendyol)

6. **src/sentiment.ts** — Basic Turkish sentiment tagger:
   - Define positive keywords list (Turkish): mükemmel, harika, süper, memnunum, tavsiye ederim, kaliteli, hızlı, güzel, başarılı, sağlam
   - Define negative keywords list (Turkish): kötü, berbat, memnun değilim, iade, bozuk, sahte, geç, eksik, kırık, pişmanım
   - Function tagSentiment(text: string, rating: number): 'positive' | 'negative' | 'neutral' | 'mixed'
   - Logic: Count positive vs negative keyword hits. If clear majority → that tag. If both present → 'mixed'. If neither → use rating (4-5=positive, 1-2=negative, 3=neutral).

7. **README.md** — Store listing:
   - Title: "Turkish E-Commerce Review Aggregator — Trendyol, Hepsiburada, N11 Reviews"
   - Emphasize unified schema + sentiment tagging
   - Use cases: sentiment analysis, product feedback monitoring, competitive intel
   - Pricing: $3 per 1,000 reviews
   - Cross-reference the other two actors

Output each review as a separate dataset record (not grouped by product).
Include productUrl and productTitle in each review record for context.
Normalize all ratings to 1-5 scale regardless of platform.
```

---

### Prompt 6: Polish & Publish Preparation

```
Now polish all three actors for Apify Store publication.

For each actor:

1. **Input validation** — Add comprehensive Zod validation for all inputs:
   - At least one data source must be provided (URLs or search query)
   - URLs must match the expected platform domain
   - maxProducts/maxSellers/maxReviews must be positive integers
   - Provide clear error messages in English for validation failures

2. **Error handling** — Add a top-level try/catch in main.ts:
   - On unhandled error, log it and set Actor exit status
   - On partial completion, log how many items were successfully scraped
   - Never let a single bad product/seller/review crash the entire run

3. **Progress reporting** — Use Actor.log to report progress:
   - "Scraped 150/500 products..."
   - "Platform: trendyol — 45 sellers found"
   - "Reviews collected: 230 (78 positive, 45 negative, 107 neutral)"

4. **Dataset metadata** — Push a summary record at the end of each run:
   {
     type: "RUN_SUMMARY",
     totalRecords: number,
     successRate: number,
     platformBreakdown: { trendyol: number, hepsiburada: number, n11: number },
     durationSeconds: number,
     errors: number
   }

5. **README improvements** for each actor:
   - Add a "Changelog" section (start with v1.0.0)
   - Add a "Works great with..." section linking to the other 2 actors
   - Add an "Output Schema" section with a complete JSON example
   - Add 3-5 FAQ entries
   - Make sure pricing is clearly stated

6. **Store metadata** for each .actor/actor.json:
   - Set appropriate categories (e-commerce, web scraping)
   - Add tags: turkey, turkish, trendyol, hepsiburada, n11, e-commerce, marketplace, products, sellers, reviews, sentiment
   - Set SEO-friendly title and description
   - Use English as primary language, mention Turkish in description

7. **Testing checklist** — For each actor, create a test script that:
   - Runs the actor with minimal input (1 URL, maxProducts=5)
   - Validates output schema against Zod types
   - Checks that required fields are not null
   - Logs pass/fail for each check
```

---

## 5. Launch Strategy

### Week 1-2: Build & Test
- Scaffold monorepo (Prompt 1)
- Build shared module (Prompt 2)
- Build N11 Product Scraper (Prompt 3) — publish first, it has zero competition

### Week 3-4: Expand
- Build Seller Intelligence (Prompt 4)
- Build Review Aggregator (Prompt 5)
- Cross-link all three actors

### Week 5: Polish & Publish
- Run Prompt 6 for all actors
- Publish all three on Apify Store
- Create initial test runs and screenshots for store listings

### Ongoing
- Monitor for site changes weekly
- Respond to user issues within 24 hours
- Add features based on user requests (tracked via GitHub issues)
- Write a blog post or tutorial showing how to use all three actors together
- Consider building an n8n/Make template that chains the actors

---

## 6. Differentiation Checklist

What makes this cluster stand out vs. existing actors:

- [ ] **N11 coverage** — No other actor provides this
- [ ] **Seller-focused data** — Different from all existing product scrapers
- [ ] **Unified review schema** — Cross-platform comparison in one dataset
- [ ] **Sentiment tagging** — Built-in Turkish-language sentiment analysis
- [ ] **Multi-platform consistency** — Same output schema across platforms
- [ ] **Cross-promotion** — Three actors that reference each other
- [ ] **Turkish language expertise** — Proper İ/ı handling, Turkish keyword sentiment
- [ ] **Transparent pricing** — Pay-per-event, no rental/subscription confusion
- [ ] **Documentation quality** — Real examples, FAQ, changelog
- [ ] **Active maintenance** — Weekly test runs, responsive to issues
