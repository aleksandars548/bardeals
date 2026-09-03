BarDeals crawler cleanup v6

Copy the scripts folder into the root of your bardeals project and replace/merge files.
This adds:
- scripts/lib/deal-cleanup.mjs
- scripts/test-deal-cleanup.mjs
- replaces scripts/merge-crawl-shards.mjs

Run locally:
  node scripts/test-deal-cleanup.mjs
  node --check scripts/merge-crawl-shards.mjs

Then commit/push and run the Update Vienna happy-hour deals workflow again.
Suggested commit:
  Clean duplicate and mismatched crawler deals
