"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeOffer, createPromoCopy } = require("../offer-engine");

const validInput = {
  productName: "Kitchen organiser",
  currentPrice: "799",
  originalPrice: "999",
  shipping: "40",
  expiresAt: "2030-12-31",
  url: "https://www.amazon.in/dp/example"
};

test("calculates discount, savings and delivered price", () => {
  const result = analyzeOffer(validInput, new Date("2030-01-01"));
  assert.equal(result.valid, true);
  assert.equal(result.offer.discountPercent, 20);
  assert.equal(result.offer.savings, 200);
  assert.equal(result.offer.deliveredPrice, 839);
  assert.equal(result.offer.expiryState, "upcoming");
});

test("rejects invalid names and non-object input", () => {
  assert.equal(analyzeOffer(null).valid, false);
  assert.equal(analyzeOffer({ ...validInput, productName: " " }).valid, false);
  assert.equal(analyzeOffer({ ...validInput, productName: "x".repeat(121) }).valid, false);
});

test("rejects impossible or invalid prices and shipping", () => {
  for (const changes of [
    { currentPrice: 0 },
    { currentPrice: -1 },
    { originalPrice: 700 },
    { originalPrice: "not a price" },
    { shipping: -1 }
  ]) {
    assert.equal(analyzeOffer({ ...validInput, ...changes }).valid, false);
  }
});

test("rejects malformed expiry dates", () => {
  assert.equal(analyzeOffer({ ...validInput, expiresAt: "not-a-date" }).valid, false);
});

test("marks expired offers and recommends verification", () => {
  const result = analyzeOffer({ ...validInput, expiresAt: "2020-01-01" }, new Date("2030-01-01"));
  assert.equal(result.offer.expiryState, "expired");
  assert.ok(result.offer.recommendations.some((item) => item.includes("expired")));
});

test("does not claim the original price is verified", () => {
  const result = analyzeOffer(validInput, new Date("2030-01-01"));
  assert.ok(result.offer.recommendations.some((item) => item.includes("not been independently verified")));
});

test("creates a promo draft with disclosure and no fake urgency", () => {
  const result = analyzeOffer({ ...validInput, expiresAt: "" }, new Date("2030-01-01"));
  const draft = createPromoCopy(result.offer, "Malayalam", "WhatsApp");
  assert.match(draft, /Affiliate disclosure/);
  assert.ok(draft.includes("[ഇവിടെ നിങ്ങളുടെ സ്ഥിരീകരിച്ച ഉൽപ്പന്ന ലിങ്ക് ചേർക്കുക]"));
  assert.doesNotMatch(draft, /Offer expiry stated as/);
});

test("supports English and channel-specific hashtags", () => {
  const result = analyzeOffer(validInput, new Date("2030-01-01"));
  const draft = createPromoCopy(result.offer, "English", "Instagram");
  assert.match(draft, /Check the seller page/);
  assert.match(draft, /#ShoppingDeals/);
});

test("date-only expiry remains valid through the selected calendar day", () => {
  const result = analyzeOffer({ ...validInput, expiresAt: "2030-12-31" }, new Date("2030-12-31T12:00:00Z"));
  assert.equal(result.offer.expiryState, "upcoming");
});

test("date-only expiry remains valid through the selected calendar day", () => {
  const result = analyzeOffer({ ...validInput, expiresAt: "2030-12-31" }, new Date("2030-12-31T12:00:00Z"));
  assert.equal(result.offer.expiryState, "upcoming");
});
