# BarDeals automatic happy-hour bot

This project can now discover Vienna nightlife venues from OpenStreetMap and check their **official public websites** for explicit happy-hour and drink-deal offers.

## What it does

1. `scripts/discover-bars.mjs` discovers bars, pubs, nightclubs and beer gardens around Vienna using Overpass / OpenStreetMap.
2. `scripts/crawl-deals.mjs` visits official websites listed in OpenStreetMap.
3. It checks the homepage plus a few relevant internal pages (happy hour, drinks, offers, events, menu, etc.).
4. The rule-based parser looks for explicit deal language, days and a time range.
5. Only high-confidence deals with a schedule are published automatically to `data/deals-auto.json`.
6. Ambiguous matches go to `data/deal-candidates.json` for review instead of being shown publicly.
7. `.github/workflows/update-deals.yml` runs this every day and commits updated JSON back to the repository.

The bot does **not** scrape Google Maps. Google Maps is only used for the Directions buttons on the website.

## Run locally

Requires Node 22+ (Node 20+ should also work).

```bash
npm test
npm run bot:update
```

Useful environment variables:

```bash
MAX_BARS=180
CRAWL_CONCURRENCY=4
MAX_PAGES_PER_BAR=5
MIN_PUBLISH_CONFIDENCE=0.85
STALE_DAYS=21
```

## GitHub setup

After uploading/pushing these files:

1. Open the repository on GitHub.
2. Go to **Settings -> Actions -> General**.
3. Under **Workflow permissions**, choose **Read and write permissions** if your repository currently restricts `GITHUB_TOKEN` to read-only.
4. Go to **Actions -> Update Vienna happy-hour deals -> Run workflow** to run it immediately.
5. Scheduled runs then happen automatically once per day.

## Safety / data quality

- Official venue websites are the publication source.
- `robots.txt` is checked before crawling pages.
- Low-confidence matches are not published automatically.
- Published deals include `sourceUrl`, `verifiedAt` and `confidence`.
- Deals not reverified within the stale window are removed from automatic output.
- Always keep the website disclaimer because venues can change offers without notice.
