import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SHARD_DIR = path.join(ROOT, "data", "crawl-shards");
const DISCOVERED_FILE = path.join(ROOT, "data", "discovered-bars.json");
const OUTPUT = path.join(ROOT, "data", "deals-auto.json");
const CANDIDATES_OUTPUT = path.join(ROOT, "data", "deal-candidates.json");
const REPORT = path.join(ROOT, "data", "crawl-report.json");
const EXPECTED_SHARDS = Math.max(1, Number(process.env.CRAWL_SHARD_TOTAL || 4));
const STALE_DAYS = Number(process.env.STALE_DAYS || 21);
const IMAGE_FILE_RE = /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i;

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}

function dealKey(deal) {
  return `${String(deal.label || "deal").toLowerCase()}|${(deal.days || []).join(",")}|${deal.from}|${deal.to}`;
}

const entries = await fs.readdir(SHARD_DIR, { withFileTypes: true }).catch(() => []);
const shardFiles = entries
  .filter((entry) => entry.isFile() && /^shard-\d+\.json$/.test(entry.name))
  .map((entry) => path.join(SHARD_DIR, entry.name));

if (shardFiles.length !== EXPECTED_SHARDS) {
  throw new Error(`Expected ${EXPECTED_SHARDS} crawl shard files, found ${shardFiles.length}. Refusing to publish a partial crawl.`);
}

const shards = await Promise.all(shardFiles.map((file) => readJson(file, null)));
if (shards.some((shard) => !shard || !Array.isArray(shard.results))) {
  throw new Error("One or more crawl shard files are invalid.");
}

const indexes = [...new Set(shards.map((shard) => Number(shard.shardIndex)))].sort((a, b) => a - b);
const expectedIndexes = Array.from({ length: EXPECTED_SHARDS }, (_, index) => index);
if (JSON.stringify(indexes) !== JSON.stringify(expectedIndexes)) {
  throw new Error(`Shard indexes are incomplete: found [${indexes.join(", ")}], expected [${expectedIndexes.join(", ")}].`);
}
if (shards.some((shard) => Number(shard.shardTotal) !== EXPECTED_SHARDS)) {
  throw new Error("Shard total mismatch. Refusing to merge incompatible crawl runs.");
}

const results = shards.flatMap((shard) => shard.results);
const seenVenueIds = new Set();
for (const result of results) {
  const id = result?.venue?.id;
  if (!id) throw new Error("A shard result is missing venue.id.");
  if (seenVenueIds.has(id)) throw new Error(`Venue ${id} appears in more than one shard.`);
  seenVenueIds.add(id);
}

const previous = await readJson(OUTPUT, []);
const byId = new Map(Array.isArray(previous) ? previous.map((venue) => [venue.id, venue]) : []);
const cutoff = Date.now() - STALE_DAYS * 86_400_000;

for (const result of results) {
  if (result.status !== "ok") continue;

  if (Array.isArray(result.published) && result.published.length) {
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
    // A successful crawl with no publishable deals means any older auto deal
    // for that venue should be removed immediately.
    byId.delete(result.venue.id);
  }
}

for (const [id, venue] of byId) {
  const latest = Math.max(
    ...(venue.deals || []).map((deal) => Date.parse(deal.verifiedAt || 0)).filter(Number.isFinite),
    0,
  );
  if (!latest || latest < cutoff) byId.delete(id);
}

const autoDeals = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
const allCandidates = results
  .filter((result) => Array.isArray(result.candidates) && result.candidates.length)
  .map((result) => ({
    id: result.venue.id,
    name: result.venue.name,
    website: result.venue.website,
    candidates: result.candidates.filter(
      (deal) => !(result.published || []).some((published) => dealKey(published) === dealKey(deal)),
    ),
  }))
  .filter((venue) => venue.candidates.length)
  .sort((a, b) => a.name.localeCompare(b.name, "de"));

const discovered = await readJson(DISCOVERED_FILE, []);
const minimumPublishConfidence = Math.max(...shards.map((shard) => Number(shard.minimumPublishConfidence || 0)));

const report = {
  generatedAt: new Date().toISOString(),
  parallelCrawl: true,
  shardsCompleted: EXPECTED_SHARDS,
  discoveredVenues: Array.isArray(discovered) ? discovered.length : Number(shards[0]?.discoveredVenues || 0),
  venuesWithWebsite: Math.max(...shards.map((shard) => Number(shard.venuesWithWebsite || 0))),
  venuesCrawledThisRun: results.length,
  pagesFetched: results.reduce((n, result) => n + (result.pages || 0), 0),
  pdfMenusFetched: results.reduce((n, result) => n + (result.pdfs || 0), 0),
  sitemapUrlsDiscovered: results.reduce((n, result) => n + (result.sitemapDiscovered || 0), 0),
  successfulVenues: results.filter((result) => result.status === "ok").length,
  robotsBlocked: results.filter((result) => result.status === "robots-blocked").length,
  failedVenues: results.filter((result) => result.status === "failed").length,
  publishableDealsThisRun: results.reduce((n, result) => n + (result.published?.length || 0), 0),
  publishedVenuesTotal: autoDeals.length,
  publishedDealsTotal: autoDeals.reduce((n, venue) => n + (venue.deals?.length || 0), 0),
  reviewCandidates: allCandidates.reduce((n, venue) => n + venue.candidates.length, 0),
  publishedVenuesWithImage: autoDeals.filter((venue) => venue.image).length,
  minimumPublishConfidence,
  staleAfterDays: STALE_DAYS,
};

await fs.writeFile(OUTPUT, `${JSON.stringify(autoDeals, null, 2)}\n`);
await fs.writeFile(CANDIDATES_OUTPUT, `${JSON.stringify(allCandidates, null, 2)}\n`);
await fs.writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Merged ${EXPECTED_SHARDS} shards covering ${results.length} venues.`);
console.log(`Published ${report.publishedDealsTotal} auto-verified deal(s) across ${report.publishedVenuesTotal} venue(s).`);
