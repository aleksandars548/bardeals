BarDeals placeholder + DE homepage patch

Copy this entire folder over the root of the bardeals repository and replace existing files.

Includes:
- index.html: automatic branded placeholder fallback for live deal cards
- de/index.html: new German finder homepage + same live deal feed + placeholders
- scripts/crawl-deals.mjs: validates extensionless image URLs by Content-Type and rejects HTML/homepage URLs
- assets/css/site.css: latest shared mobile overflow/header fix
- assets/img/placeholders/: Cocktail, Pub, Sports Bar, Club, and default Bar placeholders

No deal parser rules, data JSON, or GitHub Action schedule are changed.

Suggested commit:
Add branded venue placeholders and sync German deal finder
