import assert from "node:assert/strict";
import { extractDealCandidates, parseDays, parseTimeRange } from "./lib/deal-parser.mjs";

assert.deepEqual(parseDays("Monday-Friday"), [1, 2, 3, 4, 5]);
assert.deepEqual(parseDays("Montag bis Freitag"), [1, 2, 3, 4, 5]);
assert.deepEqual(parseDays("daily"), [0, 1, 2, 3, 4, 5, 6]);
assert.deepEqual(parseTimeRange("17:00-20:00"), { from: "17:00", to: "20:00" });
assert.deepEqual(parseTimeRange("von 17 bis 21 Uhr"), { from: "17:00", to: "21:00" });
assert.deepEqual(parseTimeRange("from 5pm to 8pm"), { from: "17:00", to: "20:00" });

const english = extractDealCandidates(
  "Happy Hour Monday-Friday from 17:00-20:00. All cocktails only €7.",
  "https://example.com/happy-hour"
);
assert.ok(english.some((d) => d.from === "17:00" && d.to === "20:00" && d.days.length === 5 && d.confidence >= 0.9));

const german = extractDealCandidates(
  "Afterwork: Montag bis Freitag von 16:00 bis 19:00 Uhr. Spritzer 1+1 gratis.",
  "https://example.at/angebote"
);
assert.ok(german.some((d) => d.from === "16:00" && d.to === "19:00" && d.days.includes(1) && d.days.includes(5) && d.confidence >= 0.85));

const happyHourNoPrice = extractDealCandidates(
  "Bier Happy Hour. Montag bis Donnerstag 16:00-18:00.",
  "https://example.at/happy-hour"
);
assert.ok(happyHourNoPrice.some((d) => d.label === "Happy Hour" && d.from === "16:00" && d.to === "18:00" && d.confidence >= 0.85));

const openingHoursTrap = extractDealCandidates(
  "Öffnungszeiten Montag-Freitag 10:00-17:00. Cocktail Happy Hour. Montag-Freitag 16:00-20:00. Cocktails €7.",
  "https://example.at/happy-hour"
);
assert.ok(openingHoursTrap.some((d) => d.label === "Happy Hour" && d.from === "16:00" && d.to === "20:00"));
assert.equal(openingHoursTrap.some((d) => d.label === "Happy Hour" && d.from === "10:00" && d.to === "17:00" && d.confidence >= 0.85), false);

const afterworkVibe = extractDealCandidates(
  "Perfekt für After-Work, Date-Night oder einfach einen entspannten Abend mit Freunden. Geöffnet täglich 11:30-22:00.",
  "https://example.at/"
);
assert.equal(afterworkVibe.some((d) => d.label === "Afterwork" && d.confidence >= 0.85), false);

const aperitivoVibe = extractDealCandidates(
  "Der perfekte Treffpunkt für Aperitivo, Spritz und italienische Drinks. Täglich 11:00-22:00.",
  "https://example.at/"
);
assert.equal(aperitivoVibe.some((d) => d.label === "Aperitivo" && d.confidence >= 0.85), false);

const duplicate = extractDealCandidates(
  "Happy Hour täglich 18:00-20:00. Happy Hour täglich 18:00-20:00. Happy Hour täglich 18:00-20:00.",
  "https://example.at/happy-hour"
).filter((d) => d.label === "Happy Hour");
assert.equal(duplicate.length, 1);

const normalMenuPrice = extractDealCandidates(
  "Weißer Spritzer € 5,10. Ginger Beer € 4,50. Bier 0,5l € 5,20.",
  "https://example.at/drinks"
);
assert.equal(normalMenuPrice.length, 0);

const afterworkWithRandomPrice = extractDealCandidates(
  "Perfekt für Afterwork mit Freunden. Unsere normale Karte: Spritzer €5,10.",
  "https://example.at/"
);
assert.equal(afterworkWithRandomPrice.some((d) => d.label === "Afterwork" && d.confidence >= 0.85), false);

const correctNearbyPrice = extractDealCandidates(
  "Beer Special for only €2.80. House wine €3.80. Happy Hour daily 18:00-20:00.",
  "https://example.at/specials"
);
const beerSpecial = correctNearbyPrice.find((d) => d.label === "Beer special");
assert.equal(beerSpecial?.priceHint, "€2.80");

const reviewText = extractDealCandidates(
  "I recommend this place. Approximately €3 for a pint and there was happy hour on spirits.",
  "https://example.at/"
);
assert.equal(reviewText.some((d) => d.confidence >= 0.85), false);

const weak = extractDealCandidates("We serve cocktails, beer and food every day.", "https://example.com");
assert.equal(weak.length, 0);

console.log("Deal parser tests passed.");
