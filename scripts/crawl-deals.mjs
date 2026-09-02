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
const MAX_PAGES = Math.max(1, Math.min(8, Number(process.env.MAX_PAGES_PER_BAR || 5)));
const MIN_PUBLISH_CONFIDENCE = Number(process.env.MIN_PUBLISH_CONFIDENCE || 0.85);
const STALE_DAYS = Number(process.env.STALE_DAYS || 21);
const USER_AGENT = "BarDealsBot/1.0 (+https://bardeals.at/for-bars.html)";
const PAGE_HINT = /happy|hour|deal|offer|special|drink|cocktail|beer|bier|spritz|afterwork|aperitivo|aktion|angebot|event|menu|karte|bar/i;

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
      if (!PAGE_HINT.test(`${url.pathname} ${url.search} ${label}`)) continue;
      out.push(url.toString());
    } catch {}
  }
  return [...new Set(out)];
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
  if (!website) return { venue, status: "no-website", published: [], candidates: [], pages: 0 };
  if (!(await robotsAllows(website))) return { venue, status: "robots-blocked", published: [], candidates: [], pages: 0 };

  const queue = [website];
  const seen = new Set();
  const candidates = [];
  let pages = 0;
  let lastError = null;
  let image = null;
  let imageSourceUrl = null;

  while (queue.length && pages < MAX_PAGES) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    if (!(await robotsAllows(url))) continue;

    try {
      const { text: html, finalUrl } = await fetchText(url);
      pages += 1;
      if (!image) {
        image = extractOfficialImage(html, finalUrl);
        if (image) imageSourceUrl = finalUrl;
      }
      const text = htmlToText(html);
      candidates.push(...extractDealCandidates(text, finalUrl));

      if (pages === 1) {
        const links = extractLinks(html, finalUrl).slice(0, MAX_PAGES * 3);
        for (const link of links) if (!seen.has(link)) queue.push(link);
      }
    } catch (error) {
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

  const published = normalized.filter((d) =>
    d.confidence >= MIN_PUBLISH_CONFIDENCE &&
    Array.isArray(d.days) && d.days.length > 0 &&
    /^\d{2}:\d{2}$/.test(d.from || "") && /^\d{2}:\d{2}$/.test(d.to || "")
  );

  return {
    venue,
    status: pages ? "ok" : "failed",
    error: pages ? null : lastError,
    pages,
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
const selected = [];
for (let i = 0; i < Math.min(MAX_BARS, withWebsites.length); i++) selected.push(withWebsites[(start + i) % withWebsites.length]);

console.log(`Crawling ${selected.length}/${withWebsites.length} venue websites (concurrency ${CONCURRENCY})...`);
const results = await mapLimit(selected, CONCURRENCY, async (venue, index) => {
  const result = await crawlVenue(venue);
  console.log(`[${index + 1}/${selected.length}] ${venue.name}: ${result.status}, ${result.published.length} publishable deal(s)`);
  return result;
});

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
        image: result.image || previousVenue?.image || null,
        imageSourceUrl: result.imageSourceUrl || previousVenue?.imageSourceUrl || null,
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
  pagesFetched: results.reduce((n, r) => n + r.pages, 0),
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
