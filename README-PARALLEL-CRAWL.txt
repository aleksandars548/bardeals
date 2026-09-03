BarDeals parallel crawler (4 shards)
===================================

What changes
------------
- Discovery runs once.
- The 427-ish venue websites are split across 4 parallel GitHub Actions jobs.
- Each shard crawls roughly one quarter of the selected venues.
- Each shard writes an artifact only; crawl jobs never push to main.
- A final merge job downloads all 4 shards, combines them with the previous
  deals-auto.json baseline, applies deletions/staleness safely, then commits once.
- Merge refuses to publish if any shard file is missing or incompatible.

Expected workflow shape
-----------------------
1. Discover Vienna venues
2. Crawl shard 1/4   \
   Crawl shard 2/4    > run in parallel
   Crawl shard 3/4   /
   Crawl shard 4/4  /
3. Merge and publish deal data

Files in this patch
-------------------
.github/workflows/update-deals.yml
scripts/crawl-deals.mjs
scripts/merge-crawl-shards.mjs
package.json
README-PARALLEL-CRAWL.txt

The included crawl-deals.mjs is the v3 discovery crawler with sitemap/PDF support
plus shard mode, so it is safe to replace the earlier v3 copy.

After copying the patch
-----------------------
Commit suggestion:
  Parallelize deal crawler into four shards

Then run:
GitHub -> Actions -> Update Vienna happy-hour deals -> Run workflow

The merge report will include:
- parallelCrawl: true
- shardsCompleted: 4
- venuesCrawledThisRun
- pagesFetched
- pdfMenusFetched
- sitemapUrlsDiscovered
