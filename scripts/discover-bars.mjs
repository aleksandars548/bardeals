import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "data", "discovered-bars.json");
const REPORT = path.join(ROOT, "data", "discovery-report.json");
const OVERPASS_URL = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const LAT = Number(process.env.VIENNA_LAT || 48.2082);
const LNG = Number(process.env.VIENNA_LNG || 16.3738);
const RADIUS = Number(process.env.VIENNA_RADIUS_METERS || 18000);
const USER_AGENT = "BarDealsBot/1.0 (+https://bardeals.at/for-bars.html)";

function slugify(value) {
  return String(value || "venue")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "venue";
}

function normalizeWebsite(value) {
  if (!value) return null;
  let raw = String(value).trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function addressFromTags(tags = {}) {
  const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ").trim();
  const city = tags["addr:city"] || "Wien";
  const postcode = tags["addr:postcode"] || "";
  const parts = [street, [postcode, city].filter(Boolean).join(" ")].filter(Boolean);
  return parts.join(", ") || "Vienna";
}

function category(tags = {}) {
  const amenity = tags.amenity;
  if (amenity === "pub") return "Pub";
  if (amenity === "nightclub") return "Club";
  if (amenity === "biergarten") return "Beer Garden";
  if (amenity === "restaurant") return "Restaurant Bar";
  return "Bar";
}

function centerOf(element) {
  if (Number.isFinite(element.lat) && Number.isFinite(element.lon)) return [element.lat, element.lon];
  if (element.center && Number.isFinite(element.center.lat) && Number.isFinite(element.center.lon)) {
    return [element.center.lat, element.center.lon];
  }
  return [null, null];
}

const query = `
[out:json][timeout:90];
(
  nwr(around:${RADIUS},${LAT},${LNG})["amenity"~"^(bar|pub|nightclub|biergarten)$"];
  nwr(around:${RADIUS},${LAT},${LNG})["amenity"="restaurant"]["bar"="yes"];
);
out center tags;
`;

console.log(`Discovering Vienna nightlife venues within ${Math.round(RADIUS / 1000)} km...`);
const response = await fetch(OVERPASS_URL, {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    "user-agent": USER_AGENT,
    accept: "application/json",
  },
  body: new URLSearchParams({ data: query }),
  signal: AbortSignal.timeout(100_000),
});

if (!response.ok) throw new Error(`Overpass returned ${response.status} ${response.statusText}`);
const payload = await response.json();
const venues = [];
const usedIds = new Set();

for (const element of payload.elements || []) {
  const tags = element.tags || {};
  if (!tags.name) continue;
  const [lat, lng] = centerOf(element);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

  const website = normalizeWebsite(tags.website || tags["contact:website"]);
  const osmKey = `${element.type}/${element.id}`;
  let id = `${slugify(tags.name)}-${element.id}`;
  if (usedIds.has(id)) id = `${id}-${element.type}`;
  usedIds.add(id);

  venues.push({
    id,
    osmId: osmKey,
    name: tags.name,
    address: addressFromTags(tags),
    zip: tags["addr:postcode"] || "",
    lat,
    lng,
    category: category(tags),
    website,
    phone: tags.phone || tags["contact:phone"] || null,
    openingHours: tags.opening_hours || null,
    source: "OpenStreetMap",
    sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
  });
}

venues.sort((a, b) => a.name.localeCompare(b.name, "de"));
await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
await fs.writeFile(OUTPUT, `${JSON.stringify(venues, null, 2)}\n`);
const report = {
  generatedAt: new Date().toISOString(),
  totalVenues: venues.length,
  venuesWithWebsite: venues.filter((v) => v.website).length,
  radiusMeters: RADIUS,
  center: { lat: LAT, lng: LNG },
  overpassUrl: OVERPASS_URL,
};
await fs.writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Saved ${report.totalVenues} venues (${report.venuesWithWebsite} with websites).`);
