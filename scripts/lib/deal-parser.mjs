const DAY_NAMES = {
  sun: 0, sunday: 0, sonntag: 0, so: 0,
  mon: 1, monday: 1, montag: 1, mo: 1,
  tue: 2, tues: 2, tuesday: 2, dienstag: 2, di: 2,
  wed: 3, wednesday: 3, mittwoch: 3, mi: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, donnerstag: 4, do: 4,
  fri: 5, friday: 5, freitag: 5, fr: 5,
  sat: 6, saturday: 6, samstag: 6, sa: 6,
};

const DAY_TOKEN = "(?:sun(?:day)?|sonntag|so|mon(?:day)?|montag|mo|tue(?:s|sday)?|dienstag|di|wed(?:nesday)?|mittwoch|mi|thu(?:r|rs|rsday)?|donnerstag|do|fri(?:day)?|freitag|fr|sat(?:urday)?|samstag|sa)";

const PROMO_PATTERNS = [
  { label: "Happy Hour", strength: "strong", re: /\bhappy[\s-]*hours?\b/i },
  { label: "2 for 1", strength: "strong", re: /\b(?:2\s*(?:for|für)\s*1|2\s*[-:]\s*1|two\s+for\s+one)\b/i },
  { label: "1+1", strength: "strong", re: /\b1\s*\+\s*1\b/i },
  { label: "Buy one get one", strength: "strong", re: /\bbuy\s+one\s+get\s+one\b/i },
  { label: "Cocktail special", strength: "strong", re: /\bcocktails?\s+(?:special|deal|aktion|angebot)s?\b/i },
  { label: "Drink special", strength: "strong", re: /\bdrinks?\s+(?:special|deal|aktion|angebot)s?\b/i },
  { label: "Beer special", strength: "strong", re: /\b(?:beer|bier)\s+(?:special|deal|aktion|angebot)s?\b/i },
  { label: "Spritz special", strength: "strong", re: /\bspritz(?:er)?\s+(?:special|deal|aktion|angebot)s?\b/i },
  { label: "Discount drinks", strength: "strong", re: /\b(?:all\s+)?(?:cocktails?|drinks?|spritz(?:er)?|beer|bier|wein|wine)\s+(?:only\s+|nur\s+)?(?:€\s*)?\d{1,2}(?:[.,]\d{1,2})?\s*(?:€|eur)?\b/i },
  // These words often describe a vibe/event rather than a discount. They are candidates only
  // until another concrete deal signal (price, discount, 1+1, etc.) is present nearby.
  { label: "Afterwork", strength: "soft", re: /\bafter[\s-]*work\b/i },
  { label: "Aperitivo", strength: "soft", re: /\baperitivo\b/i },
];

const HARD_DEAL_SIGNAL_RE = /(?:\b(?:2\s*(?:for|für)\s*1|2\s*[-:]\s*1|1\s*\+\s*1|buy\s+one\s+get\s+one|happy[\s-]*hours?|specials?|deals?|aktion(?:en)?|angebot(?:e)?|rabatt|discount|reduced|save|off|free|gratis|kostenlos|günstiger|guenstiger)\b|\b\d{1,3}\s*%\s*(?:off|discount|rabatt)?\b|(?:€\s*\d{1,3}(?:[.,]\d{1,2})?|\d{1,3}(?:[.,]\d{1,2})?\s*(?:€|eur)))/i;
const OPENING_HOURS_RE = /(?:opening\s+hours?|öffnungszeiten|oeffnungszeiten|geöffnet|geoeffnet|kitchen\s+hours?|bar\s+hours?)/i;

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

function normalizeDayToken(token) {
  return String(token || "").toLowerCase().replace(/\./g, "");
}

function daysBetween(start, end) {
  const out = [start];
  let d = start;
  while (d !== end && out.length < 7) {
    d = (d + 1) % 7;
    out.push(d);
  }
  return out;
}

export function parseDays(text) {
  const value = String(text || "").toLowerCase();

  if (/\b(?:daily|every\s+day|everyday|täglich|taeglich|jeden\s+tag|7\s*days?|7\s*tage)\b/i.test(value)) {
    return [0, 1, 2, 3, 4, 5, 6];
  }

  const found = [];
  const rangeRe = new RegExp(`\\b(${DAY_TOKEN})\\.?\\s*(?:-|–|—|to|until|through|thru|bis)\\s*(${DAY_TOKEN})\\.?\\b`, "gi");
  let range;
  while ((range = rangeRe.exec(value))) {
    const a = DAY_NAMES[normalizeDayToken(range[1])];
    const b = DAY_NAMES[normalizeDayToken(range[2])];
    if (a != null && b != null) found.push(...daysBetween(a, b));
  }

  const tokenRe = new RegExp(`\\b(${DAY_TOKEN})\\.?\\b`, "gi");
  let match;
  while ((match = tokenRe.exec(value))) {
    const day = DAY_NAMES[normalizeDayToken(match[1])];
    if (day != null) found.push(day);
  }

  return uniqueSorted(found);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function to24Hour(hour, minute = 0, suffix = "") {
  let h = Number(hour);
  const m = Number(minute || 0);
  const s = String(suffix || "").toLowerCase();
  if (s === "pm" && h < 12) h += 12;
  if (s === "am" && h === 12) h = 0;
  if (!Number.isFinite(h) || h < 0 || h > 23 || !Number.isFinite(m) || m < 0 || m > 59) return null;
  return `${pad2(h)}:${pad2(m)}`;
}

function findTimeRanges(text) {
  const value = String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[‐‑‒–—]/g, "-");
  const ranges = [];

  const amPmRe = /\b(?:from\s*)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\s*(?:-|to|until|till|through)\s*(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/gi;
  let match;
  while ((match = amPmRe.exec(value))) {
    const from = to24Hour(match[1], match[2], match[3]);
    const to = to24Hour(match[4], match[5], match[6]);
    if (from && to) ranges.push({ from, to, index: match.index, length: match[0].length });
  }

  const h24Re = /\b(?:von|from)?\s*([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s*(?:uhr|h)?\s*(?:-|bis|to|until|till)\s*([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s*(?:uhr|h)?\b/gi;
  while ((match = h24Re.exec(value))) {
    const from = to24Hour(match[1], match[2]);
    const to = to24Hour(match[3], match[4]);
    if (from && to) ranges.push({ from, to, index: match.index, length: match[0].length });
  }

  const seen = new Set();
  return ranges
    .sort((a, b) => a.index - b.index)
    .filter((range) => {
      const key = `${range.index}|${range.from}|${range.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function parseTimeRange(text) {
  const range = findTimeRanges(text)[0];
  return range ? { from: range.from, to: range.to } : null;
}

function isOpeningHoursRange(text, range) {
  const input = String(text || "");
  const prefix = input.slice(0, range.index);
  const lastBoundary = Math.max(prefix.lastIndexOf("."), prefix.lastIndexOf("!"), prefix.lastIndexOf("?"), prefix.lastIndexOf(";"));
  const beforeClause = prefix.slice(Math.max(0, lastBoundary + 1));
  const suffix = input.slice(range.index + range.length);
  const nextBoundaryCandidates = [suffix.indexOf("."), suffix.indexOf("!"), suffix.indexOf("?"), suffix.indexOf(";")].filter((v) => v >= 0);
  const nextBoundary = nextBoundaryCandidates.length ? Math.min(...nextBoundaryCandidates) : Math.min(70, suffix.length);
  const afterClause = suffix.slice(0, nextBoundary);
  // Only treat the schedule as venue opening hours when the label belongs to the same
  // sentence/clause. A distant opening-hours section must not poison a real deal time.
  if (OPENING_HOURS_RE.test(beforeClause)) return true;
  return OPENING_HOURS_RE.test(afterClause) && !/happy[\s-]*hours?|2\s*(?:for|für)\s*1|1\s*\+\s*1|special|deal|aktion|angebot|rabatt|discount/i.test(beforeClause);
}

function nearestTimeRange(text, anchorIndex) {
  const ranges = findTimeRanges(text).filter((range) => !isOpeningHoursRange(text, range));
  if (!ranges.length) return null;
  return ranges
    .map((range) => ({ ...range, distance: Math.abs((range.index + range.length / 2) - anchorIndex) }))
    .sort((a, b) => a.distance - b.distance)[0];
}

function firstMoney(text) {
  const match = /(?:€\s*\d{1,3}(?:[.,]\d{1,2})?|\d{1,3}(?:[.,]\d{1,2})?\s*(?:€|eur))\b/i.exec(String(text || ""));
  return match ? match[0].replace(/\s+/g, " ").trim() : null;
}

function localPromoContext(input, index, length) {
  const start = Math.max(0, index - 120);
  const end = Math.min(input.length, index + Math.max(length, 1) + 360);
  return { text: input.slice(start, end), start };
}

function clipRelevantText(text, index, max = 190) {
  const input = String(text || "").replace(/\s+/g, " ").trim();
  const start = Math.max(0, index - 80);
  const end = Math.min(input.length, index + 280);
  let snippet = input.slice(start, end).trim();

  const pieces = snippet.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (pieces.length > 1) {
    const promoIndex = pieces.findIndex((p) => PROMO_PATTERNS.some((x) => x.re.test(p)));
    if (promoIndex >= 0) {
      const useful = [pieces[promoIndex], pieces[promoIndex + 1], pieces[promoIndex + 2]]
        .filter(Boolean)
        .filter((piece, i) => i === 0 || /\d|€|eur|%|daily|täglich|taeglich|mon|montag|tue|dienstag|wed|mittwoch|thu|donnerstag|fri|freitag|sat|samstag|sun|sonntag|gratis|free|discount|rabatt/i.test(piece));
      if (useful.length) snippet = useful.join(" ");
    }
  }

  snippet = snippet
    .replace(/\s*\.\s*\.\s*/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
  if (snippet.length > max) snippet = `${snippet.slice(0, max - 1).trimEnd()}…`;
  return snippet;
}

function semanticCandidateKey(candidate) {
  return `${candidate.label}|${candidate.from}|${candidate.to}|${candidate.days.join(",")}`;
}

function candidateQuality(candidate) {
  let score = candidate.confidence || 0;
  if (candidate.priceHint) score += 0.08;
  if (/happy[\s-]*hour|2\s*(?:for|für)\s*1|1\s*\+\s*1|%|€|eur|gratis|free|discount|rabatt/i.test(candidate.text || "")) score += 0.05;
  // Cleaner, shorter snippets are preferable when the underlying deal is identical.
  score -= Math.min(0.04, Math.max(0, String(candidate.text || "").length - 90) / 3000);
  return score;
}

export function extractDealCandidates(text, sourceUrl = "") {
  const input = String(text || "").replace(/\s+/g, " ").trim();
  if (!input) return [];

  const candidates = [];
  for (const promo of PROMO_PATTERNS) {
    const globalFlags = promo.re.flags.includes("g") ? promo.re.flags : `${promo.re.flags}g`;
    const re = new RegExp(promo.re.source, globalFlags);
    let match;
    while ((match = re.exec(input))) {
      const local = localPromoContext(input, match.index, match[0].length);
      const anchor = match.index - local.start + match[0].length / 2;
      const timeRange = nearestTimeRange(local.text, anchor);
      const times = timeRange ? { from: timeRange.from, to: timeRange.to } : null;
      const days = parseDays(local.text);
      const money = firstMoney(local.text);
      const hardSignal = HARD_DEAL_SIGNAL_RE.test(local.text);
      const openingHoursOnly = OPENING_HOURS_RE.test(local.text) && !hardSignal && promo.strength === "soft";

      let confidence = 0.45;
      if (promo.strength === "strong") confidence += 0.2;
      if (times) confidence += 0.2;
      if (days.length) confidence += 0.1;
      if (hardSignal) confidence += 0.15;
      if (/^https?:\/\//i.test(sourceUrl)) confidence += 0.05;
      if (promo.strength === "soft" && !hardSignal) confidence -= 0.25;
      if (openingHoursOnly) confidence -= 0.2;
      confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(2))));

      candidates.push({
        label: promo.label,
        text: clipRelevantText(input, match.index),
        days,
        from: times?.from || null,
        to: times?.to || null,
        priceHint: money,
        sourceUrl,
        confidence,
        promoStrength: promo.strength,
        hasHardDealSignal: hardSignal,
      });

      if (match[0].length === 0) re.lastIndex += 1;
    }
  }

  // Fuzzy de-duplication: identical schedule + deal type is one deal even if the page repeats
  // the same copy in navigation, hero and footer.
  const bestByKey = new Map();
  for (const candidate of candidates) {
    const key = semanticCandidateKey(candidate);
    const old = bestByKey.get(key);
    if (!old || candidateQuality(candidate) > candidateQuality(old)) bestByKey.set(key, candidate);
  }
  return [...bestByKey.values()];
}
