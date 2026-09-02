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
assert.ok(german.some((d) => d.from === "16:00" && d.to === "19:00" && d.days.includes(1) && d.days.includes(5)));

const weak = extractDealCandidates("We serve cocktails, beer and food every day.", "https://example.com");
assert.equal(weak.length, 0);

console.log("Deal parser tests passed.");
