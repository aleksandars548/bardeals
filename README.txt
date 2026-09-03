BarDeals parser hardening v5 - DIRECT REPLACEMENTS

Copy these files into the root of your current bardeals repo and replace existing files:
- scripts/lib/deal-parser.mjs
- scripts/crawl-deals.mjs
- scripts/test-deal-parser.mjs

Then run:
node scripts/test-deal-parser.mjs
node --check scripts/crawl-deals.mjs

Expected:
Deal parser tests passed.

No apply-parser-hardening-v5.mjs script is needed.
