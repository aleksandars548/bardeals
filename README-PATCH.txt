BarDeals bot v2 patch

Copy EVERYTHING inside this folder into your existing local bardeals GitHub clone.
Choose Replace files in destination when Windows asks.
Do NOT delete or replace the data folder; this patch intentionally does not contain it.

Then in GitHub Desktop:
1. Commit message: Improve deal bot quality and official images
2. Commit to main
3. Push origin
4. GitHub > Actions > Update Vienna happy-hour deals > Run workflow

Changes:
- stricter false-positive filtering
- opening-hours trap protection
- stronger duplicate removal
- official og:image/twitter:image support
- images on live deal cards
- crawls up to 450 website-backed Vienna venues per run
