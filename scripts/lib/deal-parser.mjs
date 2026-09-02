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
  { label: "Happy Hour", re: /\bhappy[\s-]*hours?\b/i },
  { label: "2 for 1", re: /\b(?:2\s*(?:for|für)\s*1|2\s*[-:]\s*1|two\s+for\s+one)\b/i },
  { label: "1+1", re: /\b1\s*\+\s*1\b/i },
  { label: "Buy one get one", re: /\bbuy\s+one\s+get\s+one\b/i },
  { label: "Afterwork", re: /\bafter[\s-]*work\b/i },
  { label: "Aperitivo", re: /\baperitivo\b/i },
  { label: "Cocktail special", re: /\bcocktails?\s+(?:special|deal|aktion|angebot)s?\b/i },
  { label: "Drink special", re: /\bdrinks?\s+(?:special|deal|aktion|angebot)s?\b/i },
  { label: "Beer special", re: /\b(?:beer|bier)\s+(?:special|deal|aktion|angebot)s?\b/i },
  { label: "Spritz special", re: /\bspritz(?:er)?\s+(?:special|deal|aktion|angebot)s?\b/i },
  { label: "Discount drinks", re: /\b(?:all\s+)?(?:cocktails?|drinks?|spritz(?:er)?|beer|bier)\s+(?:only\s+)?(?:€|eur\s*)?\d{1,2}(?:[.,]\d{1,2})?\s*(?:€|eur)?\b/i },
];

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

export function parseTimeRange(text) {
  const value = String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[‐‑‒–—]/g, "-");

  const amPm = /\b(?:from\s*)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\s*(?:-|to|until|till|through)\s*(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/i.exec(value);
  if (amPm) {
    const from = to24Hour(amPm[1], amPm[2], amPm[3]);
    const to = to24Hour(amPm[4], amPm[5], amPm[6]);
    if (from && to) return { from, to };
  }

  const h24 = /\b(?:von|from)?\s*([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s*(?:uhr|h)?\s*(?:-|bis|to|until|till)\s*([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s*(?:uhr|h)?\b/i.exec(value);
  if (h24) {
    const from = to24Hour(h24[1], h24[2]);
    const to = to24Hour(h24[3], h24[4]);
    if (from && to) return { from, to };
  }

  return null;
}

function firstMoney(text) {
  const match = /(?:€\s*\d{1,3}(?:[.,]\d{1,2})?|\d{1,3}(?:[.,]\d{1,2})?\s*(?:€|eur))\b/i.exec(String(text || ""));
  return match ? match[0].replace(/\s+/g, " ").trim() : null;
}

function clipRelevantText(text, index, max = 190) {
  const input = String(text || "").replace(/\s+/g, " ").trim();
  const start = Math.max(0, index - 110);
  const end = Math.min(input.length, index + 260);
  let snippet = input.slice(start, end).trim();

  const pieces = snippet.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (pieces.length > 1) {
    const promoIndex = pieces.findIndex((p) => PROMO_PATTERNS.some((x) => x.re.test(p)));
    if (promoIndex >= 0) {
      snippet = [pieces[promoIndex], pieces[promoIndex + 1]].filter(Boolean).join(" ");
    }
  }

  if (snippet.length > max) snippet = `${snippet.slice(0, max - 1).trimEnd()}…`;
  return snippet;
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
      const windowStart = Math.max(0, match.index - 240);
      const windowEnd = Math.min(input.length, match.index + 420);
      const context = input.slice(windowStart, windowEnd);
      const times = parseTimeRange(context);
      const days = parseDays(context);
      const money = firstMoney(context);

      let confidence = 0.5;
      if (times) confidence += 0.25;
      if (days.length) confidence += 0.15;
      if (money || /%|discount|off|free|gratis|save|günstiger|guenstiger/i.test(context)) confidence += 0.05;
      if (/^https?:\/\//i.test(sourceUrl)) confidence += 0.05;
      confidence = Math.min(1, Number(confidence.toFixed(2)));

      candidates.push({
        label: promo.label,
        text: clipRelevantText(input, match.index),
        days,
        from: times?.from || null,
        to: times?.to || null,
        priceHint: money,
        sourceUrl,
        confidence,
      });

      if (match[0].length === 0) re.lastIndex += 1;
    }
  }

  const seen = new Set();
  return candidates.filter((c) => {
    const key = `${c.label}|${c.from}|${c.to}|${c.days.join(",")}|${c.text.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
