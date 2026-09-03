function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&[a-z#0-9]+;/g, " ")
    .replace(/[^a-z0-9äöüß€%+]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function timeToken(time) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(time || ""));
  if (!match) return [];
  const h = Number(match[1]);
  const m = Number(match[2]);
  const variants = new Set([
    `${match[1]}:${match[2]}`,
    `${h}:${match[2]}`,
    `${h}.${match[2]}`,
  ]);
  if (m === 0) {
    variants.add(`${h}h`);
    variants.add(`${h} uhr`);
    variants.add(`${h}:00`);
    variants.add(`${h}.00`);
    if (h === 0) {
      variants.add("24:00");
      variants.add("24.00");
      variants.add("24h");
    }
  }
  return [...variants];
}

function mentionsTime(text, time) {
  const haystack = ` ${normalizeText(text)} `;
  return timeToken(time).some((token) => haystack.includes(` ${normalizeText(token)} `) || haystack.includes(normalizeText(token)));
}

function explicitScheduleScore(deal) {
  const text = String(deal?.text || "");
  let score = 0;
  if (mentionsTime(text, deal?.from)) score += 2;
  if (mentionsTime(text, deal?.to)) score += 2;
  if (/\b(?:daily|every day|everyday|täglich|taeglich|jeden tag|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text)) score += 1;
  return score;
}

function promoFamily(deal) {
  const label = String(deal?.label || "deal").toLowerCase();
  if (/happy/.test(label)) return "happy-hour";
  if (/2\s*for\s*1|2\s*für\s*1/.test(label)) return "2-for-1";
  if (/1\s*\+\s*1|buy one get one/.test(label)) return "1-plus-1";
  if (/beer|bier/.test(label)) return "beer-special";
  if (/cocktail/.test(label)) return "cocktail-special";
  if (/spritz/.test(label)) return "spritz-special";
  return label.replace(/\s+/g, "-");
}

function sourceLanguagePath(url) {
  try {
    const path = new URL(String(url || "")).pathname.toLowerCase();
    if (/(?:^|\/)de(?:\/|$)/.test(path)) return "de";
    if (/(?:^|\/)en(?:\/|$)/.test(path)) return "en";
  } catch {}
  return "";
}

function sameLanguageVariant(a, b) {
  const aLang = sourceLanguagePath(a?.sourceUrl);
  const bLang = sourceLanguagePath(b?.sourceUrl);
  return aLang && bLang && aLang !== bLang;
}

function normalizedCoreText(deal) {
  return normalizeText(deal?.text)
    .replace(/\b(?:happy hour|happy hours|cocktail happy hour|daily|täglich|taeglich)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textSimilarity(a, b) {
  const aa = new Set(normalizedCoreText(a).split(" ").filter((x) => x.length > 2));
  const bb = new Set(normalizedCoreText(b).split(" ").filter((x) => x.length > 2));
  if (!aa.size || !bb.size) return 0;
  let overlap = 0;
  for (const token of aa) if (bb.has(token)) overlap += 1;
  return overlap / Math.min(aa.size, bb.size);
}

function dealQuality(deal) {
  let score = Number(deal?.confidence || 0);
  score += explicitScheduleScore(deal) * 0.12;
  if (deal?.priceHint) score += 0.04;
  if (/\b(?:2\s*(?:for|für)\s*1|1\s*\+\s*1|gratis|free|%|€|eur)\b/i.test(String(deal?.text || ""))) score += 0.04;
  score += Math.min(0.03, (Array.isArray(deal?.days) ? deal.days.length : 0) * 0.004);
  return score;
}

function scheduleKey(deal) {
  return `${promoFamily(deal)}|${deal?.from || ""}|${deal?.to || ""}`;
}

function exactDealKey(deal) {
  return `${scheduleKey(deal)}|${(deal?.days || []).join(",")}|${normalizeText(deal?.text)}`;
}

export function cleanupVenueDeals(inputDeals) {
  const deals = Array.isArray(inputDeals) ? inputDeals.filter(Boolean) : [];
  const exact = new Map();
  for (const deal of deals) {
    const key = exactDealKey(deal);
    const old = exact.get(key);
    if (!old || dealQuality(deal) > dealQuality(old)) exact.set(key, deal);
  }

  let stage = [...exact.values()];

  // Within one source page + promo family, prefer candidates whose OWN snippet
  // explicitly contains both parsed times. If such a candidate exists, discard
  // sibling schedules that are not supported by their own text.
  const sourceGroups = new Map();
  for (const deal of stage) {
    const key = `${promoFamily(deal)}|${String(deal.sourceUrl || "")}`;
    if (!sourceGroups.has(key)) sourceGroups.set(key, []);
    sourceGroups.get(key).push(deal);
  }
  const sourceKeep = new Set();
  for (const group of sourceGroups.values()) {
    const explicit = group.filter((deal) => mentionsTime(deal.text, deal.from) && mentionsTime(deal.text, deal.to));
    if (explicit.length) {
      for (const deal of explicit) sourceKeep.add(deal);
      continue;
    }

    // Identical promo copy with different attached schedules is one deal, not two.
    const byText = new Map();
    for (const deal of group) {
      const textKey = normalizeText(deal.text);
      const old = byText.get(textKey);
      if (!old || dealQuality(deal) > dealQuality(old)) byText.set(textKey, deal);
    }
    for (const deal of byText.values()) sourceKeep.add(deal);
  }
  stage = stage.filter((deal) => sourceKeep.has(deal));

  // EN/DE page variants: identical promo family + schedule should render once.
  const bySchedule = new Map();
  for (const deal of stage) {
    const key = scheduleKey(deal);
    const old = bySchedule.get(key);
    if (!old) {
      bySchedule.set(key, deal);
      continue;
    }

    const duplicate = sameLanguageVariant(old, deal) || textSimilarity(old, deal) >= 0.45;
    if (duplicate) {
      if (dealQuality(deal) > dealQuality(old)) bySchedule.set(key, deal);
      continue;
    }

    bySchedule.set(`${key}|${normalizeText(deal.text).slice(0, 80)}`, deal);
  }

  return [...bySchedule.values()];
}
