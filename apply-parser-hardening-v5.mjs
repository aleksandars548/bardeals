import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const parserPath = path.join(root, 'scripts', 'lib', 'deal-parser.mjs');
const crawlerPath = path.join(root, 'scripts', 'crawl-deals.mjs');
const testPath = path.join(root, 'scripts', 'test-deal-parser.mjs');

function read(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${path.relative(root, file)}`);
  return fs.readFileSync(file, 'utf8');
}

function replaceOnce(src, oldText, newText, label) {
  if (!src.includes(oldText)) throw new Error(`Patch target not found: ${label}`);
  return src.replace(oldText, newText);
}

let parser = read(parserPath);

// 1) A normal menu price is NOT a deal. Remove the broad price-only promo matcher.
parser = parser.replace(
  '  { label: "Discount drinks", strength: "strong", re: /\\b(?:all\\s+)?(?:cocktails?|drinks?|spritz(?:er)?|beer|bier|wein|wine)\\s+(?:only\\s+|nur\\s+)?(?:€\\s*)?\\d{1,2}(?:[.,]\\d{1,2})?\\s*(?:€|eur)?\\b/i },\n',
  ''
);

// 2) Money by itself must not turn Afterwork/Aperitivo into a hard promotion.
const oldHard = 'const HARD_DEAL_SIGNAL_RE = /(?:\\b(?:2\\s*(?:for|für)\\s*1|2\\s*[-:]\\s*1|1\\s*\\+\\s*1|buy\\s+one\\s+get\\s+one|happy[\\s-]*hours?|specials?|deals?|aktion(?:en)?|angebot(?:e)?|rabatt|discount|reduced|save|off|free|gratis|kostenlos|günstiger|guenstiger)\\b|\\b\\d{1,3}\\s*%\\s*(?:off|discount|rabatt)?\\b|(?:€\\s*\\d{1,3}(?:[.,]\\d{1,2})?|\\d{1,3}(?:[.,]\\d{1,2})?\\s*(?:€|eur)))/i;';
const newHard = 'const HARD_DEAL_SIGNAL_RE = /(?:\\b(?:2\\s*(?:for|für)\\s*1|2\\s*[-:]\\s*1|1\\s*\\+\\s*1|buy\\s+one\\s+get\\s+one|happy[\\s-]*hours?|specials?|deals?|aktion(?:en)?|angebot(?:e)?|rabatt|discount|reduced|save|off|free|gratis|kostenlos|günstiger|guenstiger)\\b|\\b\\d{1,3}\\s*%\\s*(?:off|discount|rabatt)?\\b)/i;';
parser = replaceOnce(parser, oldHard, newHard, 'HARD_DEAL_SIGNAL_RE');

// 3) Do not steal an opening/event time hundreds of characters away.
const oldNearest = `function nearestTimeRange(text, anchorIndex) {
  const ranges = findTimeRanges(text).filter((range) => !isOpeningHoursRange(text, range));
  if (!ranges.length) return null;
  return ranges
    .map((range) => ({ ...range, distance: Math.abs((range.index + range.length / 2) - anchorIndex) }))
    .sort((a, b) => a.distance - b.distance)[0];
}`;
const newNearest = `function nearestTimeRange(text, anchorIndex) {
  const ranges = findTimeRanges(text).filter((range) => !isOpeningHoursRange(text, range));
  if (!ranges.length) return null;
  const nearest = ranges
    .map((range) => ({ ...range, distance: Math.abs((range.index + range.length / 2) - anchorIndex) }))
    .sort((a, b) => a.distance - b.distance)[0];
  // A distant schedule is usually opening hours or an unrelated event block.
  return nearest && nearest.distance <= 150 ? nearest : null;
}`;
parser = replaceOnce(parser, oldNearest, newNearest, 'nearestTimeRange');

// 4) Price must come from the same sentence/clause as the promo, not arbitrary nearby menu copy.
const firstMoneyBlock = `function firstMoney(text) {
  const match = /(?:€\\s*\\d{1,3}(?:[.,]\\d{1,2})?|\\d{1,3}(?:[.,]\\d{1,2})?\\s*(?:€|eur))\\b/i.exec(String(text || ""));
  return match ? match[0].replace(/\\s+/g, " ").trim() : null;
}`;
const enhancedMoneyBlock = `${firstMoneyBlock}

function sameClauseContext(input, index, length) {
  const text = String(input || "");
  const before = text.slice(0, index);
  const after = text.slice(index + length);
  const leftBoundary = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf(";"));
  const rightCandidates = [after.indexOf("."), after.indexOf("!"), after.indexOf("?"), after.indexOf(";")].filter((n) => n >= 0);
  const rightBoundary = rightCandidates.length ? Math.min(...rightCandidates) : Math.min(after.length, 180);
  return text.slice(Math.max(0, leftBoundary + 1), index + length + rightBoundary).trim();
}

function sourcePromoBoost(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    return /\\/(?:happy[-_]?hour|specials?|angebote?|aktionen?|deals?|promos?|events?)(?:\\/|$)/i.test(url.pathname) ? 0.08 : 0;
  } catch {
    return 0;
  }
}

const REVIEW_LIKE_RE = /\\b(?:recommend(?:ed)?\\s+you|approximately\\s+[£$€]|tripadvisor|google\\s+review|customer\\s+review|reviewer|\\d\\s*stars?)\\b/i;`;
parser = replaceOnce(parser, firstMoneyBlock, enhancedMoneyBlock, 'firstMoney helpers');
parser = parser.replace(
  '  const match = /(?:€\\s*\\d{1,3}(?:[.,]\\d{1,2})?|\\d{1,3}(?:[.,]\\d{1,2})?\\s*(?:€|eur))\\b/i.exec(String(text || \"\"));',
  '  const match = /(?:€\\s*\\d{1,3}(?:[.,]\\d{1,2})?|\\d{1,3}(?:[.,]\\d{1,2})?\\s*(?:€|eur))(?![\\d\\w])/i.exec(String(text || \"\"));'
);

const oldCandidateCore = `      const local = localPromoContext(input, match.index, match[0].length);
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
      if (/^https?:\\/\\//i.test(sourceUrl)) confidence += 0.05;
      if (promo.strength === "soft" && !hardSignal) confidence -= 0.25;
      if (openingHoursOnly) confidence -= 0.2;
      confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(2))));`;
const newCandidateCore = `      const local = localPromoContext(input, match.index, match[0].length);
      const anchor = match.index - local.start + match[0].length / 2;
      const timeRange = nearestTimeRange(local.text, anchor);
      const times = timeRange ? { from: timeRange.from, to: timeRange.to } : null;
      const days = parseDays(local.text);
      const sameClause = sameClauseContext(input, match.index, match[0].length);
      const money = firstMoney(sameClause);
      const hardSignal = HARD_DEAL_SIGNAL_RE.test(local.text);
      const reviewLike = REVIEW_LIKE_RE.test(local.text);
      const openingHoursOnly = OPENING_HOURS_RE.test(local.text) && !hardSignal && promo.strength === "soft";

      let confidence = 0.45;
      if (promo.strength === "strong") confidence += 0.2;
      if (times) confidence += 0.2;
      if (days.length) confidence += 0.1;
      if (hardSignal) confidence += 0.15;
      if (/^https?:\\/\\//i.test(sourceUrl)) confidence += 0.05;
      confidence += sourcePromoBoost(sourceUrl);
      if (promo.strength === "soft" && !hardSignal) confidence -= 0.25;
      if (openingHoursOnly) confidence -= 0.2;
      if (reviewLike) confidence -= 0.45;
      confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(2))));`;
parser = replaceOnce(parser, oldCandidateCore, newCandidateCore, 'candidate scoring');

const oldPushTail = `        promoStrength: promo.strength,
        hasHardDealSignal: hardSignal,
      });`;
const newPushTail = `        promoStrength: promo.strength,
        hasHardDealSignal: hardSignal,
        reviewLike,
      });`;
parser = replaceOnce(parser, oldPushTail, newPushTail, 'candidate metadata');

fs.writeFileSync(parserPath, parser);

let crawler = read(crawlerPath);

// 5) Money alone is not a concrete deal signal in the publish gate either.
// 5) Money alone is not a concrete deal signal in the publish gate either.
if (!crawler.includes('function hasPastExplicitDate(')) {
  const concreteRe = /function concreteDealSignal\(text\) \{[\s\S]*?\n\}/;
  if (concreteRe.test(crawler)) crawler = crawler.replace(concreteRe, `function concreteDealSignal(text) {
  return /happy[\\s-]*hours?|2\\s*(?:for|für)\\s*1|1\\s*\\+\\s*1|buy\\s+one\\s+get\\s+one|\\b\\d{1,3}\\s*%\\s*(?:off|discount|rabatt)?\\b|\\b(?:specials?|deals?|aktion(?:en)?|angebot(?:e)?|gratis|free|kostenlos|rabatt|discount|reduced)\\b|save\\s+\\d/i.test(String(text || ""));
}

function hasPastExplicitDate(deal, now = new Date()) {
  const text = String(deal?.text || "");
  const sourceUrl = String(deal?.sourceUrl || "");
  const haystack = text + " " + sourceUrl;
  const currentYear = now.getUTCFullYear();
  const startToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const years = [...haystack.matchAll(/\\b(20\\d{2})\\b/g)].map((m) => Number(m[1]));
  if (years.some((year) => year < currentYear)) return true;

  const fullDates = [];
  for (const m of haystack.matchAll(/\\b(20\\d{2})[-/.](0?[1-9]|1[0-2])[-/.]([0-2]?\\d|3[01])\\b/g)) {
    fullDates.push(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  for (const m of haystack.matchAll(/\\b([0-2]?\\d|3[01])[.\\/-](0?[1-9]|1[0-2])[.\\/-](20\\d{2})\\b/g)) {
    fullDates.push(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  }
  return fullDates.some((stamp) => Number.isFinite(stamp) && stamp < startToday);
}`);
}

if (crawler.includes('function publishableCandidate(') && !crawler.includes('if (hasPastExplicitDate(deal)) return false;')) {
  const publishRe = /function publishableCandidate\(deal\) \{[\s\S]*?\n\}/;
  if (!publishRe.test(crawler)) throw new Error('Patch target not found: publishableCandidate');
  crawler = crawler.replace(publishRe, `function publishableCandidate(deal) {
  if (deal.confidence < MIN_PUBLISH_CONFIDENCE) return false;
  if (!Array.isArray(deal.days) || deal.days.length === 0) return false;
  if (!/^\\d{2}:\\d{2}$/.test(deal.from || "") || !/^\\d{2}:\\d{2}$/.test(deal.to || "")) return false;
  if (hasPastExplicitDate(deal)) return false;
  if (/\\b(?:recommend(?:ed)?\\s+you|approximately\\s+[£$€]|tripadvisor|google\\s+review|customer\\s+review)\\b/i.test(deal.text || "")) return false;
  if (/^(?:Afterwork|Aperitivo)$/i.test(deal.label || "") && !concreteDealSignal(deal.text)) return false;
  return true;
}`);
}

fs.writeFileSync(crawlerPath, crawler);

let tests = read(testPath);
const marker = '// parser-hardening-v5 tests';
if (!tests.includes(marker)) {
  tests = tests.replace(
    '\nconsole.log("Deal parser tests passed.");',
    `\n\n${marker}\nconst ordinaryMenuPrice = extractDealCandidates(\n  "Weißer Spritzer 0,25l €5,10. Bier 0,5l €5,50.",\n  "https://example.at/menu"\n);\nassert.equal(ordinaryMenuPrice.length, 0, "ordinary menu prices must not be deals");\n\nconst randomAfterworkPrice = extractDealCandidates(\n  "Buche dein Afterwork Event. Raummiete €650.",\n  "https://example.at/events"\n);\nassert.equal(randomAfterworkPrice.some((d) => d.label === "Afterwork" && d.hasHardDealSignal), false);\nassert.equal(randomAfterworkPrice.some((d) => d.label === "Afterwork" && d.confidence >= 0.85), false);\n\nconst exactSpecialPrice = extractDealCandidates(\n  "Pssst, ask for our Beer Special for only 2,80€. House wine €3,80.",\n  "https://example.at/specials"\n);\nconst beerSpecial = exactSpecialPrice.find((d) => d.label === "Beer special");\nassert.ok(beerSpecial);\nassert.equal(beerSpecial.priceHint, "2,80€");\n\nconst reviewText = extractDealCandidates(\n  "I recommend you look for cocktail happy hours but go anyway. Happy Hour Friday 18:00-20:00.",\n  "https://example.at/"\n);\nassert.equal(reviewText.some((d) => d.confidence >= 0.85), false, "review-like copy must not auto-publish");\n\nconsole.log("Deal parser tests passed.");`
  );
  fs.writeFileSync(testPath, tests);
}

console.log('Parser hardening v5 applied successfully.');
console.log('Run: node scripts/test-deal-parser.mjs');
