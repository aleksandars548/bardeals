BarDeals Discovery v3

Copy this patch over the root of your bardeals repository and replace existing files.

Changes:
- sitemap.xml discovery
- deeper internal-link crawling
- common deal/menu path probes
- PDF menu crawling (dependency-free text extraction)
- 8 HTML pages + up to 2 PDFs per venue
- Afterwork/Aperitivo cannot publish without a concrete deal signal
- crawl report adds pdfMenusFetched and sitemapUrlsDiscovered

After pushing, run Actions -> Update Vienna happy-hour deals -> Run workflow.
