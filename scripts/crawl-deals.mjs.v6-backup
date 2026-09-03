import fs from "node:fs/promises";
import path from "node:path";
import { extractDealCandidates } from "./lib/deal-parser.mjs";

const ROOT = process.cwd();
const INPUT = path.join(ROOT, "data", "discovered-bars.json");
const OUTPUT = path.join(ROOT, "data", "deals-auto.json");
const CANDIDATES_OUTPUT = path.join(ROOT, "data", "deal-candidates.json");
const REPORT = path.join(ROOT, "data", "crawl-report.json");
const MAX_BARS = Number(process.env.MAX_BARS || 450);
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.CRAWL_CONCURRENCY || 4)));
const MAX_PAGES = Math.max(1, Math.min(14, Number(process.env.MAX_PAGES_PER_BAR || 8)));
const MAX_PDFS = Math.max(0, Math.min(5, Number(process.env.MAX_PDFS_PER_BAR || 2)));
const MAX_SITEMAP_URLS = Math.max(0, Math.min(40, Number(process.env.MAX_SITEMAP_URLS || 18)));
const MIN_PUBLISH_CONFIDENCE = Number(process.env.MIN_PUBLISH_CONFIDENCE || 0.85);
const STALE_DAYS = Number(process.env.STALE_DAYS || 21);
const SHARD_TOTAL = Math.max(1, Number(process.env.CRAWL_SHARD_TOTAL || 1));
const SHARD_INDEX = Math.max(0, Number(process.env.CRAWL_SHARD_INDEX || 0));
const SHARD_MODE = SHARD_TOTAL > 1 || process.env.CRAWL_SHARD_MODE === "1";
const SHARD_DIR = path.join(ROOT, "data", "crawl-shards");
const USER_AGENT = "BarDealsBot/1.0 (+https://bardeals.at/for-bars.html)";
const PAGE_HINT = /happy|hour|deal|offer|special|drink|cocktail|beer|bier|spritz|afterwork|aperitivo|aktion|angebot|event|menu|karte|getr[aä]nk|beverage|promo|student|ladies|terrace|bar/i;
const PDF_HINT = /\.pdf(?:$|[?#])|menu|karte|getr[aä]nk|drink|cocktail|happy|offer|angebot|aktion|special/i;
const DIRECT_PATH_HINTS = [
  "/happy-hour", "/happyhour", "/happy_hour", "/angebote", "/angebot", "/aktionen", "/aktion",
  "/drinks", "/drink-menu", "/menu", "/menus", "/getraenkekarte", "/getränkekarte", "/bar", "/events"
];

function htmlDecode(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try { return String.fromCodePoint(Number.parseInt(hex, 16)); } catch { return ""; }
    })
    .replace(/&#(\d+);/g, (_, num) => {
      try { return String.fromCodePoint(Number(num)); } catch { return ""; }
    });
}

function htmlToText(html) {
  return htmlDecode(
    String(html || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--([\s\S]*?)-->/g, " ")
      .replace(/<br\s*\/?>/gi, ". ")
      .replace(/<\/(p|div|li|h[1-6]|section|article|tr)>/gi, ". ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function parseTagAttributes(tag) {
  const attrs = {};
  const re = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = re.exec(String(tag || "")))) {
    attrs[match[1].toLowerCase()] = htmlDecode(match[2] ?? match[3] ?? match[4] ?? "").trim();
  }
  return attrs;
}

function absoluteHttpUrl(raw, baseUrl) {
  try {
    const url = new URL(String(raw || "").trim(), baseUrl);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (/\.svg(?:$|[?#])/i.test(url.pathname + url.search)) return null;
    return url.toString();
  } catch {
    return null;
  }
}


const IMAGE_FILE_RE = /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i;

async function validateOfficialImage(rawUrl) {
  const url = absoluteHttpUrl(rawUrl, rawUrl);
  if (!url) return null;

  // Most real OG images are direct image files. Accept these without another request.
  if (IMAGE_FILE_RE.test(url)) return url;

  // Some CDNs use extensionless image URLs. Verify those by Content-Type so a
  // homepage or ordinary HTML page can never be stored as a venue image.
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT }
    });
    clearTimeout(timeout);
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (response.ok && contentType.startsWith("image/")) return response.url || url;
  } catch {}

  return null;
}

function extractOfficialImage(html, baseUrl) {
  const preferred = new Map();
  const metaRe = /<meta\b[^>]*>/gi;
  let tag;
  while ((tag = metaRe.exec(String(html || "")))) {
    const attrs = parseTagAttributes(tag[0]);
    const key = String(attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (!attrs.content) continue;
    if (["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src", "image"].includes(key) && !preferred.has(key)) {
      preferred.set(key, attrs.content);
    }
  }

  for (const key of ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src", "image"]) {
    const url = absoluteHttpUrl(preferred.get(key), baseUrl);
    if (url) return url;
  }

  const linkRe = /<link\b[^>]*>/gi;
  while ((tag = linkRe.exec(String(html || "")))) {
    const attrs = parseTagAttributes(tag[0]);
    if (!/^(?:image_src|preload)$/i.test(attrs.rel || "")) continue;
    if ((attrs.rel || "").toLowerCase() === "preload" && (attrs.as || "").toLowerCase() !== "image") continue;
    const url = absoluteHttpUrl(attrs.href, baseUrl);
    if (url) return url;
  }
  return null;
}

function extractLinks(html, baseUrl) {
  const out = [];
  const base = new URL(baseUrl);
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    try {
      const url = new URL(match[1], base);
      if (!/^https?:$/.test(url.protocol) || url.origin !== base.origin) continue;
      url.hash = "";
      const label = htmlToText(match[2]);
      const haystack = `${url.pathname} ${url.search} ${label}`;
      if (!PAGE_HINT.test(haystack) && !PDF_HINT.test(haystack)) continue;
      out.push(url.toString());
    } catch {}
  }
  return [...new Set(out)];
}


function extractXmlLocs(xml) {
  const out = [];
  const re = /<loc\b[^>]*>([\s\S]*?)<\/loc>/gi;
  let match;
  while ((match = re.exec(String(xml || "")))) {
    const value = htmlDecode(match[1]).trim();
    if (value) out.push(value);
  }
  return [...new Set(out)];
}

async function fetchSitemapUrls(website) {
  const base = new URL(website);
  const seeds = [new URL("/sitemap.xml", base).toString()];
  const seenMaps = new Set();
  const urls = [];

  while (seeds.length && seenMaps.size < 4 && urls.length < MAX_SITEMAP_URLS * 3) {
    const sitemapUrl = seeds.shift();
    if (seenMaps.has(sitemapUrl)) continue;
    seenMaps.add(sitemapUrl);
    try {
      const response = await fetch(sitemapUrl, {
        redirect: "follow",
        headers: { "user-agent": USER_AGENT, accept: "application/xml,text/xml,*/*;q=0.1" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) continue;
      const xml = (await response.text()).slice(0, 2_000_000);
      for (const raw of extractXmlLocs(xml)) {
        try {
          const url = new URL(raw, base);
          if (!/^https?:$/.test(url.protocol) || url.origin !== base.origin) continue;
          url.hash = "";
          if (/sitemap/i.test(url.pathname) && /\.xml(?:$|[?#])/i.test(url.pathname + url.search)) {
            if (!seenMaps.has(url.toString())) seeds.push(url.toString());
            continue;
          }
          if (PAGE_HINT.test(url.pathname + url.search) || PDF_HINT.test(url.pathname + url.search)) urls.push(url.toString());
        } catch {}
      }
    } catch {}
  }

  return [...new Set(urls)].slice(0, MAX_SITEMAP_URLS);
}

function decodePdfLiteral(value) {
  return String(value || "")
    .replace(/\\([nrtbf()\\])/g, (_, c) => ({n:"\n", r:"\r", t:"\t", b:"\b", f:"\f", "(":"(", ")":")", "\\":"\\"}[c] || c))
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\\r?\n/g, "");
}

function extractPdfTextFromBuffer(buffer) {
  const raw = Buffer.from(buffer).toString("latin1");
  const chunks = [];
  const literalRe = /\((?:\\.|[^\\()])*\)\s*Tj|\[(.*?)\]\s*TJ/gs;
  let match;
  while ((match = literalRe.exec(raw))) {
    const block = match[0];
    const innerRe = /\(((?:\\.|[^\\()])*)\)/g;
    let inner;
    while ((inner = innerRe.exec(block))) chunks.push(decodePdfLiteral(inner[1]));
    const hexRe = /<([0-9A-Fa-f]{4,})>/g;
    let hex;
    while ((hex = hexRe.exec(block))) {
      try {
        const bytes = Buffer.from(hex[1].length % 2 ? `0${hex[1]}` : hex[1], "hex");
        const text = bytes.toString("utf16le").replace(/\u0000/g, "");
        if (/\w/.test(text)) chunks.push(text);
      } catch {}
    }
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

async function fetchPdfText(url, timeout = 15_000) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/pdf,*/*;q=0.1",
      "accept-language": "de-AT,de;q=0.9,en;q=0.8",
    },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const type = String(response.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("pdf") && !/\.pdf(?:$|[?#])/i.test(response.url)) throw new Error(`Unsupported PDF content-type: ${type}`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 8_000_000) throw new Error("PDF too large");
  const buffer = Buffer.from(await response.arrayBuffer());
  return { text: extractPdfTextFromBuffer(buffer).slice(0, 500_000), finalUrl: response.url };
}

function isPdfUrl(url) {
  return /\.pdf(?:$|[?#])/i.test(String(url || ""));
}

function concreteDealSignal(text) {
  return /happy[\s-]*hours?|2\s*(?:for|für)\s*1|1\s*\+\s*1|buy\s+one\s+get\s+one|\b\d{1,3}\s*%\s*(?:off|discount|rabatt)?\b|\b(?:specials?|deals?|aktion(?:en)?|angebot(?:e)?|rabatt|discount|reduced|gratis|free|kostenlos)\b/i.test(String(text || ""));
}

function explicitPastDate(text, sourceUrl = "") {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const haystack = `${String(text || "")} ${String(sourceUrl || "")}`;
  const years = [...haystack.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
  if (years.some((year) => year < currentYear)) return true;

  // ISO-like event URLs such as ...-2026-07-22-18-00/...
  for (const m of haystack.matchAll(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.]([0-2]?\d|3[01])\b/g)) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59));
    if (Number.isFinite(d.getTime()) && d.getTime() < now.getTime() - 86_400_000) return true;
  }
  return false;
}

function looksLikeReviewText(text) {
  return /\b(?:recommend(?:ed)?|tripadvisor|google review|approximately|we went|we visited|I went|I visited|stars?|rating)\b/i.test(String(text || ""));
}

function publishableCandidate(deal) {
  if (deal.confidence < MIN_PUBLISH_CONFIDENCE) return false;
  if (!Array.isArray(deal.days) || deal.days.length === 0) return false;
  if (!/^\d{2}:\d{2}$/.test(deal.from || "") || !/^\d{2}:\d{2}$/.test(deal.to || "")) return false;
  if (explicitPastDate(deal.text, deal.sourceUrl)) return false;
  if (looksLikeReviewText(deal.text)) return false;
  if (/^(?:Afterwork|Aperitivo)$/i.test(deal.label || "") && !concreteDealSignal(deal.text)) return false;
  return true;
}

async function fetchText(url, timeout = 12_000) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
      "accept-language": "de-AT,de;q=0.9,en;q=0.8",
    },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const type = response.headers.get("content-type") || "";
  if (!/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error(`Unsupported content-type: ${type}`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 2_000_000) throw new Error("Page too large");
  const text = await response.text();
  return { text: text.slice(0, 2_000_000), finalUrl: response.url };
}

function robotsRules(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.replace(/#.*/, "").trim()).filter(Boolean);
  const groups = [];
  let current = null;
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.toLowerCase().trim();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      if (!current || current.hasRules) {
        current = { agents: [], disallow: [], allow: [], hasRules: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && (key === "disallow" || key === "allow")) {
      current[key].push(value);
      current.hasRules = true;
    }
  }
  return groups;
}

async function robotsAllows(url) {
  try {
    const target = new URL(url);
    const robotsUrl = new URL("/robots.txt", target.origin).toString();
    const response = await fetch(robotsUrl, {
      headers: { "user-agent": USER_AGENT, accept: "text/plain,*/*;q=0.1" },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return true;
    const groups = robotsRules(await response.text());
    const group = groups.find((g) => g.agents.includes("bardealsbot")) || groups.find((g) => g.agents.includes("*"));
    if (!group) return true;
    const pathname = target.pathname || "/";
    const matchingAllow = group.allow.filter(Boolean).filter((rule) => pathname.startsWith(rule)).sort((a, b) => b.length - a.length)[0];
    const matchingDisallow = group.disallow.filter(Boolean).filter((rule) => pathname.startsWith(rule)).sort((a, b) => b.length - a.length)[0];
    if (!matchingDisallow) return true;
    if (matchingAllow && matchingAllow.length >= matchingDisallow.length) return true;
    return false;
  } catch {
    return true;
  }
}

function validWebsite(raw) {
  try {
    const url = new URL(raw);
    return /^https?:$/.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function dealKey(deal) {
  return `${String(deal.label || "deal").toLowerCase()}|${(deal.days || []).join(",")}|${deal.from}|${deal.to}`;
}

function dealQuality(deal) {
  let score = Number(deal.confidence || 0);
  if (deal.priceHint) score += 0.08;
  if (/2\s*(?:for|für)\s*1|1\s*\+\s*1|%|€|eur|gratis|free|discount|rabatt/i.test(deal.text || "")) score += 0.05;
  if (/happy[\s-]*hour/i.test(deal.text || "")) score += 0.03;
  return score;
}

function dedupeDeals(deals) {
  const map = new Map();
  for (const deal of deals) {
    const key = dealKey(deal);
    const old = map.get(key);
    if (!old || dealQuality(deal) > dealQuality(old)) map.set(key, deal);
  }
  return [...map.values()];
}

async function crawlVenue(venue) {
  const website = validWebsite(venue.website);
  if (!website) return { venue, status: "no-website", published: [], candidates: [], pages: 0, pdfs: 0, sitemapDiscovered: 0 };
  if (!(await robotsAllows(website))) return { venue, status: "robots-blocked", published: [], candidates: [], pages: 0, pdfs: 0, sitemapDiscovered: 0 };

  const sitemapUrls = await fetchSitemapUrls(website);
  const directProbes = DIRECT_PATH_HINTS.map((pathname) => {
    try { return new URL(pathname, website).toString(); } catch { return null; }
  }).filter(Boolean);
  const queue = [website, ...sitemapUrls, ...directProbes];
  const seen = new Set();
  const queued = new Set(queue);
  const candidates = [];
  let pages = 0;
  let pdfs = 0;
  let sitemapDiscovered = sitemapUrls.length;
  let lastError = null;
  let image = null;
  let imageSourceUrl = null;

  while (queue.length && (pages < MAX_PAGES || pdfs < MAX_PDFS)) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    if (!(await robotsAllows(url))) continue;

    try {
      if (isPdfUrl(url)) {
        if (pdfs >= MAX_PDFS) continue;
        const { text, finalUrl } = await fetchPdfText(url);
        pdfs += 1;
        if (text) candidates.push(...extractDealCandidates(text, finalUrl));
        continue;
      }

      if (pages >= MAX_PAGES) continue;
      const { text: html, finalUrl } = await fetchText(url);
      pages += 1;
      if (!image) {
        const candidateImage = extractOfficialImage(html, finalUrl);
        const validatedImage = await validateOfficialImage(candidateImage);
        if (validatedImage) {
          image = validatedImage;
          imageSourceUrl = finalUrl;
        }
      }
      const text = htmlToText(html);
      candidates.push(...extractDealCandidates(text, finalUrl));

      // Discover relevant pages from every crawled page, not just the homepage.
      const links = extractLinks(html, finalUrl).slice(0, MAX_PAGES * 4);
      for (const link of links) {
        if (!seen.has(link) && !queued.has(link)) {
          queued.add(link);
          queue.push(link);
        }
      }
    } catch (error) {
      // Direct-path probes are expected to 404 on many sites, so only retain the
      // latest error for diagnostics rather than treating a probe as fatal.
      lastError = String(error?.message || error);
    }
  }

  const now = new Date().toISOString();
  const normalized = dedupeDeals(candidates).map((c) => ({
    days: c.days,
    from: c.from,
    to: c.to,
    text: c.text,
    label: c.label,
    priceHint: c.priceHint || null,
    sourceUrl: c.sourceUrl,
    source: "official_website",
    verifiedAt: now,
    confidence: c.confidence,
    auto: true,
  }));

  const published = normalized.filter(publishableCandidate);

  return {
    venue,
    status: pages ? "ok" : "failed",
    error: pages ? null : lastError,
    pages,
    pdfs,
    sitemapDiscovered,
    published,
    candidates: normalized,
    image,
    imageSourceUrl,
  };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function dayOfYear(date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const diff = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start;
  return Math.floor(diff / 86_400_000);
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}

const discovered = await readJson(INPUT, []);
if (!Array.isArray(discovered) || !discovered.length) {
  throw new Error("data/discovered-bars.json is missing or empty. Run node scripts/discover-bars.mjs first.");
}

const withWebsites = discovered.filter((v) => validWebsite(v.website));
const start = withWebsites.length > MAX_BARS ? (dayOfYear() * MAX_BARS) % withWebsites.length : 0;
const baseSelected = [];
for (let i = 0; i < Math.min(MAX_BARS, withWebsites.length); i++) baseSelected.push(withWebsites[(start + i) % withWebsites.length]);

if (SHARD_INDEX >= SHARD_TOTAL) {
  throw new Error(`CRAWL_SHARD_INDEX ${SHARD_INDEX} must be smaller than CRAWL_SHARD_TOTAL ${SHARD_TOTAL}.`);
}

const selected = SHARD_MODE
  ? baseSelected.filter((_, index) => index % SHARD_TOTAL === SHARD_INDEX)
  : baseSelected;

const shardLabel = SHARD_MODE ? ` shard ${SHARD_INDEX + 1}/${SHARD_TOTAL}` : "";
console.log(`Crawling${shardLabel}: ${selected.length}/${withWebsites.length} venue websites (concurrency ${CONCURRENCY})...`);
const results = await mapLimit(selected, CONCURRENCY, async (venue, index) => {
  const result = await crawlVenue(venue);
  console.log(`[${index + 1}/${selected.length}] ${venue.name}: ${result.status}, ${result.published.length} publishable deal(s)`);
  return result;
});

if (SHARD_MODE) {
  await fs.mkdir(SHARD_DIR, { recursive: true });
  const shardFile = path.join(SHARD_DIR, `shard-${SHARD_INDEX}.json`);
  const shardPayload = {
    generatedAt: new Date().toISOString(),
    shardIndex: SHARD_INDEX,
    shardTotal: SHARD_TOTAL,
    discoveredVenues: discovered.length,
    venuesWithWebsite: withWebsites.length,
    venuesCrawledThisRun: selected.length,
    minimumPublishConfidence: MIN_PUBLISH_CONFIDENCE,
    staleAfterDays: STALE_DAYS,
    results,
  };
  await fs.writeFile(shardFile, `${JSON.stringify(shardPayload, null, 2)}\n`);
  const publishable = results.reduce((n, r) => n + r.published.length, 0);
  console.log(`Shard ${SHARD_INDEX + 1}/${SHARD_TOTAL} finished: ${selected.length} venues, ${publishable} publishable deal(s).`);
  console.log(`Wrote ${path.relative(ROOT, shardFile)}.`);
} else {
  const previous = await readJson(OUTPUT, []);
  const byId = new Map(Array.isArray(previous) ? previous.map((v) => [v.id, v]) : []);
  const cutoff = Date.now() - STALE_DAYS * 86_400_000;

  for (const result of results) {
    if (result.status === "ok") {
      if (result.published.length) {
        const previousVenue = byId.get(result.venue.id);
        byId.set(result.venue.id, {
          id: result.venue.id,
          name: result.venue.name,
          address: result.venue.address,
          zip: result.venue.zip,
          lat: result.venue.lat,
          lng: result.venue.lng,
          category: result.venue.category,
          featured: false,
          website: result.venue.website,
          image: result.image || (IMAGE_FILE_RE.test(String(previousVenue?.image || "")) ? previousVenue.image : null),
          imageSourceUrl: result.imageSourceUrl || (IMAGE_FILE_RE.test(String(previousVenue?.image || "")) ? previousVenue?.imageSourceUrl || null : null),
          deals: result.published,
          discoveredFrom: result.venue.sourceUrl,
          auto: true,
        });
      } else {
        byId.delete(result.venue.id);
      }
    }
  }

  for (const [id, venue] of byId) {
    const latest = Math.max(...(venue.deals || []).map((d) => Date.parse(d.verifiedAt || 0)).filter(Number.isFinite), 0);
    if (!latest || latest < cutoff) byId.delete(id);
  }

  const autoDeals = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
  const allCandidates = results
    .filter((r) => r.candidates.length)
    .map((r) => ({
      id: r.venue.id,
      name: r.venue.name,
      website: r.venue.website,
      candidates: r.candidates.filter((d) => !r.published.some((p) => dealKey(p) === dealKey(d))),
    }))
    .filter((r) => r.candidates.length);

  await fs.writeFile(OUTPUT, `${JSON.stringify(autoDeals, null, 2)}\n`);
  await fs.writeFile(CANDIDATES_OUTPUT, `${JSON.stringify(allCandidates, null, 2)}\n`);
  const report = {
    generatedAt: new Date().toISOString(),
    discoveredVenues: discovered.length,
    venuesWithWebsite: withWebsites.length,
    venuesCrawledThisRun: selected.length,
    pagesFetched: results.reduce((n, r) => n + (r.pages || 0), 0),
    pdfMenusFetched: results.reduce((n, r) => n + (r.pdfs || 0), 0),
    sitemapUrlsDiscovered: results.reduce((n, r) => n + (r.sitemapDiscovered || 0), 0),
    successfulVenues: results.filter((r) => r.status === "ok").length,
    robotsBlocked: results.filter((r) => r.status === "robots-blocked").length,
    failedVenues: results.filter((r) => r.status === "failed").length,
    publishableDealsThisRun: results.reduce((n, r) => n + r.published.length, 0),
    publishedVenuesTotal: autoDeals.length,
    publishedDealsTotal: autoDeals.reduce((n, v) => n + (v.deals?.length || 0), 0),
    reviewCandidates: allCandidates.reduce((n, v) => n + v.candidates.length, 0),
    publishedVenuesWithImage: autoDeals.filter((v) => v.image).length,
    minimumPublishConfidence: MIN_PUBLISH_CONFIDENCE,
    staleAfterDays: STALE_DAYS,
  };
  await fs.writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Published ${report.publishedDealsTotal} auto-verified deal(s) across ${report.publishedVenuesTotal} venue(s).`);
}
