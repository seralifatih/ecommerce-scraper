# Apify Deployment

This monorepo is configured for separate Git-based deployments on Apify.

## Recommended setup

Create three separate Actors in Apify Console and link all three to the same Git repository.

- `n11-product-scraper` -> `packages/n11-product-scraper`
- `seller-intelligence` -> `packages/seller-intelligence`
- `review-aggregator` -> `packages/review-aggregator`

Use Git repository sources in this format:

- `https://github.com/<owner>/<repo>#main:packages/n11-product-scraper`
- `https://github.com/<owner>/<repo>#main:packages/seller-intelligence`
- `https://github.com/<owner>/<repo>#main:packages/review-aggregator`

## Why this works

Each actor package keeps its own `.actor/actor.json`, but the build uses:

- `dockerContextDir: "../../.."` to expose the whole monorepo to Docker
- `dockerfile: "../../../Dockerfile.apify-monorepo"` to reuse one shared Apify build

Apify passes `ACTOR_PATH_IN_DOCKER_CONTEXT` automatically for monorepo builds. The shared Dockerfile uses that path to:

1. Install root workspace dependencies.
2. Build only the selected workspace package.
3. Start only the selected actor at runtime.

## Store configuration

Set these in Apify Console after the first successful build:

- Store categories
- Store tags
- Pricing
- Public visibility

Those values are not stored in `actor.json` because the current `actor.json` schema does not support custom Store taxonomy fields.
