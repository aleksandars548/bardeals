import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const crawlPath = path.join(root, 'scripts', 'crawl-deals.mjs');
const parserPath = path.join(root, 'scripts', 'lib', 'deal-parser.mjs');

function read(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function replaceOnce(src, oldText, newText, label) {
  const count = src.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 target, found ${count}. Your files may differ from the expected v6.`);
  return src.replace(oldText, newText);
}

let crawl = read(crawlPath);
let parser = read(parserPath);

// Backups before touching anything.
fs.copyFileSync(crawlPath, `${crawlPath}.v6-backup`);
fs.copyFileSync(parserPath, `${parserPath}.v6-backup`);

crawl = replaceOnce(
  crawl,
  'const MAX_PAGES = Math.max(1, Math.min(14, Number(process.env.MAX_PAGES_PER_BAR || 8)));\nconst MAX_PDFS = Math.max(0, Math.min(5, Number(process.env.MAX_PDFS_PER_BAR || 2)));\nconst MAX_SITEMAP_URLS = Math.max(0, Math.min(40, Number(process.env.MAX_SITEMAP_URLS || 18)));',
  'const MAX_PAGES = Math.max(1, Math.min(14, Number(process.env.MAX_PAGES_PER_BAR || 12)));\nconst MAX_PDFS = Math.max(0, Math.min(5, Number(process.env.MAX_PDFS_PER_BAR || 4)));\nconst MAX_SITEMAP_URLS = Math.max(0, Math.min(40, Number(process.env.MAX_SITEMAP_URLS || 32)));',
  'crawl-depth defaults'
);

crawl = replaceOnce(
  crawl,
  'const PAGE_HINT = /happy|hour|deal|offer|special|drink|cocktail|beer|bier|spritz|afterwork|aperitivo|aktion|angebot|event|menu|karte|getr[aä]nk|beverage|promo|student|ladies|terrace|bar/i;\nconst PDF_HINT = /\\.pdf(?:$|[?#])|menu|karte|getr[aä]nk|drink|cocktail|happy|offer|angebot|aktion|special/i;',
  'const PAGE_HINT = /happy|hour|deal|offer|special|drink|cocktail|beer|bier|spritz|afterwork|aperitivo|aktion|angebot|event|menu|karte|getr[aä]nk|beverage|promo|promotion|student|ladies|women|shot|shots|bucket|longdrink|rabatt|discount|gratis|free|weekday|weekend|night|terrace|bar/i;\nconst PDF_HINT = /\\.pdf(?:$|[?#])|menu|karte|getr[aä]nk|drink|cocktail|happy|offer|angebot|aktion|special|deal|promo|rabatt|discount|shot|bucket/i;',
  'page/pdf hints'
);

crawl = replaceOnce(
  crawl,
  '  "/drinks", "/drink-menu", "/menu", "/menus", "/getraenkekarte", "/getränkekarte", "/bar", "/events"\n];',
  '  "/drinks", "/drink-menu", "/menu", "/menus", "/getraenkekarte", "/getränkekarte", "/bar", "/events",\n  "/specials", "/deals", "/promotions", "/promo", "/happyhours", "/student-night", "/student",\n  "/ladies-night", "/weekly-specials", "/drink-specials", "/cocktail-specials", "/bar-specials"\n];',
  'direct path probes'
);

const oldExtractLinks = `function extractLinks(html, baseUrl) {
  const out = [];
  const base = new URL(baseUrl);
  const re = /<a\\b[^>]*href\\s*=\\s*["']([^"'#]+)["'][^>]*>([\\s\\S]*?)<\\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    try {
      const url = new URL(match[1], base);
      if (!/^https?:$/.test(url.protocol) || url.origin !== base.origin) continue;
      url.hash = "";
      const label = htmlToText(match[2]);
      const haystack = \`${'${url.pathname} ${url.search} ${label}'}\`;
      if (!PAGE_HINT.test(haystack) && !PDF_HINT.test(haystack)) continue;
      out.push(url.toString());
    } catch {}
  }
  return [...new Set(out)];
}`;

const newExtractLinks = `function linkPriority(haystack) {
  const text = String(haystack || "").toLowerCase();
  let score = 0;
  if (/happy|2\\s*(?:for|für)\\s*1|1\\s*\\+\\s*1/.test(text)) score += 12;
  if (/special|deal|aktion|angebot|promo|promotion|rabatt|discount|gratis|free/.test(text)) score += 9;
  if (/drink|cocktail|longdrink|beer|bier|spritz|shot|bucket/.test(text)) score += 6;
  if (/student|ladies|women|afterwork|aperitivo/.test(text)) score += 4;
  if (/menu|karte|getr[aä]nk|beverage/.test(text)) score += 3;
  if (/event/.test(text)) score += 2;
  return score;
}

function extractLinks(html, baseUrl) {
  const out = [];
  const base = new URL(baseUrl);
  const re = /<a\\b[^>]*href\\s*=\\s*["']([^"'#]+)["'][^>]*>([\\s\\S]*?)<\\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    try {
      const url = new URL(match[1], base);
      if (!/^https?:$/.test(url.protocol) || url.origin !== base.origin) continue;
      url.hash = "";
      const label = htmlToText(match[2]);
      const haystack = \`${'${url.pathname} ${url.search} ${label}'}\`;
      if (!PAGE_HINT.test(haystack) && !PDF_HINT.test(haystack)) continue;
      out.push({ url: url.toString(), score: linkPriority(haystack) });
    } catch {}
  }
  const best = new Map();
  for (const item of out) {
    const old = best.get(item.url);
    if (!old || item.score > old.score) best.set(item.url, item);
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .map((item) => item.url);
}`;

crawl = replaceOnce(crawl, oldExtractLinks, newExtractLinks, 'ranked relevant links');

// Parser: recognize more explicit promotional wording, but never ordinary item+price.
const oldPatternsTail = `  { label: "Spritz special", strength: "strong", re: /\\bspritz(?:er)?\\s+(?:special|deal|aktion|angebot)s?\\b/i },
  // These words often describe a vibe/event rather than a discount. They are candidates only`;
const newPatternsTail = `  { label: "Spritz special", strength: "strong", re: /\\bspritz(?:er)?\\s+(?:special|deal|aktion|angebot)s?\\b/i },
  { label: "Longdrink special", strength: "strong", re: /\\blong\\s*drinks?\\s+(?:special|deal|aktion|angebot)s?\\b/i },
  { label: "Shot special", strength: "strong", re: /\\bshots?\\s+(?:special|deal|aktion|angebot)s?\\b/i },
  { label: "Bottle special", strength: "strong", re: /\\b(?:bottle|flaschen?)\\s*[- ]?(?:special|deal|aktion|angebot)s?\\b/i },
  { label: "Bucket special", strength: "strong", re: /\\bbuckets?\\s+(?:special|deal|aktion|angebot)s?\\b/i },
  { label: "Student special", strength: "strong", re: /\\bstudent(?:en)?\\s+(?:special|deal|aktion|angebot|night)s?\\b/i },
  { label: "Ladies special", strength: "strong", re: /\\b(?:ladies|women(?:'s)?)\\s+(?:special|deal|night)s?\\b/i },
  // These words often describe a vibe/event rather than a discount. They are candidates only`;
parser = replaceOnce(parser, oldPatternsTail, newPatternsTail, 'extra promo patterns');

// Allow common compact ranges: "from 5 to 7pm" / "5-7 pm".
const oldAmpm = `  const amPmRe = /\\b(?:from\\s*)?(\\d{1,2})(?::([0-5]\\d))?\\s*(am|pm)\\s*(?:-|to|until|till|through)\\s*(\\d{1,2})(?::([0-5]\\d))?\\s*(am|pm)\\b/gi;
  let match;
  while ((match = amPmRe.exec(value))) {
    const from = to24Hour(match[1], match[2], match[3]);
    const to = to24Hour(match[4], match[5], match[6]);
    if (from && to) ranges.push({ from, to, index: match.index, length: match[0].length });
  }

  const h24Re =`;
const newAmpm = `  const amPmRe = /\\b(?:from\\s*)?(\\d{1,2})(?::([0-5]\\d))?\\s*(am|pm)\\s*(?:-|to|until|till|through)\\s*(\\d{1,2})(?::([0-5]\\d))?\\s*(am|pm)\\b/gi;
  let match;
  while ((match = amPmRe.exec(value))) {
    const from = to24Hour(match[1], match[2], match[3]);
    const to = to24Hour(match[4], match[5], match[6]);
    if (from && to) ranges.push({ from, to, index: match.index, length: match[0].length });
  }

  // Common bar wording omits the first am/pm suffix: "from 5 to 7pm".
  const compactAmPmRe = /\\b(?:from\\s*)?(\\d{1,2})(?::([0-5]\\d))?\\s*(?:-|to|until|till|through)\\s*(\\d{1,2})(?::([0-5]\\d))?\\s*(am|pm)\\b/gi;
  while ((match = compactAmPmRe.exec(value))) {
    const endHour = Number(match[3]);
    const suffix = String(match[5]).toLowerCase();
    let startSuffix = suffix;
    const startHour = Number(match[1]);
    // 5-7pm => both PM; 11-1am => 11pm to 1am is the natural overnight interpretation.
    if (suffix === "am" && startHour > endHour) startSuffix = "pm";
    const from = to24Hour(match[1], match[2], startSuffix);
    const to = to24Hour(match[3], match[4], suffix);
    if (from && to) ranges.push({ from, to, index: match.index, length: match[0].length });
  }

  const h24Re =`;
parser = replaceOnce(parser, oldAmpm, newAmpm, 'compact am/pm ranges');

// Give the parser a little more room to connect nearby day/time wording while retaining opening-hours checks.
parser = replaceOnce(
  parser,
  '  const start = Math.max(0, index - 120);\n  const end = Math.min(input.length, index + Math.max(length, 1) + 360);',
  '  const start = Math.max(0, index - 180);\n  const end = Math.min(input.length, index + Math.max(length, 1) + 520);',
  'local promo context'
);

fs.writeFileSync(crawlPath, crawl);
fs.writeFileSync(parserPath, parser);

console.log('v7 applied successfully.');
console.log('Backups created:');
console.log('  scripts/crawl-deals.mjs.v6-backup');
console.log('  scripts/lib/deal-parser.mjs.v6-backup');
console.log('Next run:');
console.log('  node scripts/test-deal-parser.mjs');
console.log('  node scripts/test-deal-cleanup.mjs');
console.log('  node --check scripts/crawl-deals.mjs');
