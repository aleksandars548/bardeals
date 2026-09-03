import assert from "node:assert/strict";
import { cleanupVenueDeals } from "./lib/deal-cleanup.mjs";

const frog = cleanupVenueDeals([
  { label: "Happy Hour", days: [0,1,2,3,4,5,6], from: "16:00", to: "00:00", text: "Happy Hour. täglich 16:00 bis 00:00.", sourceUrl: "https://cafefrog.at/", confidence: 1 },
  { label: "Happy Hour", days: [0,1,2,3,4,5,6], from: "10:00", to: "22:00", text: "Happy Hour. Jeden Tag 16:00 - 24:00. Alle Cocktails 7,50€.", sourceUrl: "https://cafefrog.at/", confidence: 1 },
]);
assert.equal(frog.length, 1);
assert.equal(frog[0].from, "16:00");
assert.equal(frog[0].to, "00:00");

const eva = cleanupVenueDeals([
  { label: "Happy Hour", days: [0,1,2,3,4,5,6], from: "16:00", to: "20:00", text: "Cocktail Happy Hour.", sourceUrl: "https://evaundadam.bar/", confidence: 1 },
  { label: "Happy Hour", days: [0,6], from: "10:00", to: "17:00", text: "Cocktail Happy Hour .", sourceUrl: "https://evaundadam.bar/", confidence: 1 },
]);
assert.equal(eva.length, 1);
assert.equal(eva[0].from, "16:00");

const shebeen = cleanupVenueDeals([
  { label: "Happy Hour", days: [1,2,3,4,5], from: "15:00", to: "01:00", text: "Ob zur Happy Hour oder für einen zwanglosen Abend.", sourceUrl: "https://www.shebeen.at/de/drinks.html", confidence: 1 },
  { label: "Happy Hour", days: [0,1,2,3,4,5,6], from: "15:00", to: "01:00", text: "Join us for happy hour or a casual evening.", sourceUrl: "https://www.shebeen.at/en/drinks.html", confidence: 1 },
]);
assert.equal(shebeen.length, 1);

const travelshack = cleanupVenueDeals([
  { label: "2 for 1", days: [2,3,4], from: "19:00", to: "21:00", text: "Captain Morgan & Gin Long drinks 2 for 1 until 11pm.", sourceUrl: "https://travelshackvienna.com/", confidence: 1 },
  { label: "1+1", days: [2,3], from: "19:00", to: "21:00", text: "Long drinks (4cl) 1 + 1 free from 7pm – 9pm.", sourceUrl: "https://travelshackvienna.com/", confidence: 1 },
]);
assert.equal(travelshack.length, 2);

console.log("Deal cleanup tests passed.");
