BarDeals v7 - find more real deals

1. Copy apply-v7-more-deals.mjs into the ROOT of your bardeals repo.
2. Run:
   node apply-v7-more-deals.mjs
3. Then run:
   node scripts/test-deal-parser.mjs
   node scripts/test-deal-cleanup.mjs
   node --check scripts/crawl-deals.mjs
4. Commit and push.
5. GitHub > Actions > Update Vienna happy-hour deals > Run workflow.

What changes:
- Default pages per venue: 8 -> 12
- PDFs per venue: 2 -> 4
- Sitemap candidates: 18 -> 32
- Better priority for deal/special/drink links
- More direct paths such as /specials, /deals, /promotions, /student-night
- More promo types: longdrink, shot, bottle, bucket, student, ladies specials
- Parses compact times such as "from 5 to 7pm"
- Larger nearby context for connecting deal + day + time

It does NOT lower the 0.85 publish confidence threshold.
