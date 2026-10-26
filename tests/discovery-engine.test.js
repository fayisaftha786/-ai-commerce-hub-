"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { scoreCandidate, createContentPack } = require("../discovery-engine");

const base = { name: "Storage organiser", price: 599, rating: 4.4, reviews: 250, commission: 10, demand: 4, competition: 2, inStock: true };

test("scores a candidate with entered signals and estimated commission", () => {
  const result = scoreCandidate(base);
  assert.equal(result.valid, true);
  assert.ok(result.candidate.score >= 0 && result.candidate.score <= 100);
  assert.equal(result.candidate.estimatedCommission, 59.9);
});

test("rejects invalid candidate names, price, ratings and percentages", () => {
  assert.equal(scoreCandidate(null).valid, false);
  assert.equal(scoreCandidate({ ...base, name: "" }).valid, false);
  assert.equal(scoreCandidate({ ...base, price: 0 }).valid, false);
  assert.equal(scoreCandidate({ ...base, rating: 6 }).valid, false);
  assert.equal(scoreCandidate({ ...base, commission: 101 }).valid, false);
  assert.equal(scoreCandidate({ ...base, demand: 7 }).valid, false);
});

test("warns when demand is weak or product is out of stock", () => {
  const result = scoreCandidate({ ...base, demand: 1, inStock: false });
  assert.ok(result.candidate.checks.some((line) => line.includes("Demand evidence is weak")));
  assert.ok(result.candidate.checks.some((line) => line.includes("out of stock")));
});

test("creates Malayalam promo copy with affiliate disclosure and link placeholder", () => {
  const pack = createContentPack({ name: "Storage organiser", benefit: "keeps shelves tidy", language: "Malayalam", type: "Post" });
  assert.match(pack.post, /Affiliate disclosure/);
  assert.match(pack.post, /\[Add your approved affiliate link\]/);
});

test("creates video plan with hook, voice-over and safe footage guidance", () => {
  const pack = createContentPack({ name: "Storage organiser", language: "English", platform: "Instagram", type: "Video" });
  assert.match(pack.video, /SHORT VIDEO PLAN/);
  assert.match(pack.video, /VOICE-OVER/);
  assert.match(pack.video, /authorised to use/);
  assert.match(pack.video, /Affiliate disclosure/);
});

test("does not place non-HTTPS links into promotional copy", () => {
  const pack = createContentPack({ name: "Storage organiser", link: "javascript:alert(1)" });
  assert.ok(pack.post.includes("[Add your approved affiliate link]"));
  assert.ok(!pack.post.includes("javascript:"));
});

test("video plan places affiliate disclosure visibly at the start", () => {
  const pack = createContentPack({ name: "Storage organiser", language: "English" });
  assert.match(pack.video, /0–9s — AFFILIATE DISCLOSURE/);
  assert.match(pack.video, /"Affiliate"/);
  assert.equal(pack.hooks.length, 3);
  assert.equal(pack.ctas.length, 3);
  assert.ok(pack.hooks.every((hook) => hook.length > 10));
  assert.ok(pack.ctas.every((cta) => cta.length > 10));
});


test("creates three distinct hooks and calls to action for simple content testing", () => {
  const pack = createContentPack({ name: "Storage organiser", benefit: "keeps shelves tidy", language: "English" });
  assert.equal(new Set(pack.hooks).size, 3);
  assert.equal(new Set(pack.ctas).size, 3);
  assert.ok(pack.hooks.every((item) => !/guaranteed|best-selling|number one/i.test(item)));
  assert.ok(pack.ctas.some((item) => /price|details/i.test(item)));
});


test("does not recommend a product when key evidence is missing", () => {
  const result = scoreCandidate({
    name: "Unverified product", price: 499, rating: "", reviews: "",
    commission: "", demand: 4, competition: 2, inStock: true
  });
  assert.equal(result.valid, true);
  assert.equal(result.candidate.label, "Need more evidence");
  assert.equal(result.candidate.estimatedCommission, null);
  assert.equal(result.candidate.confidence, "Low");
  assert.ok(result.candidate.checks.some((line) => line.includes("Missing rating")));
  assert.ok(result.candidate.checks.some((line) => line.includes("Missing review count")));
  assert.ok(result.candidate.checks.some((line) => line.includes("Commission is missing")));
});

test("does not treat a blank demand/competition estimate as a real signal", () => {
  const result = scoreCandidate({ ...base, demand: "", competition: "" });
  assert.equal(result.valid, true);
  assert.equal(result.candidate.label, "Need more evidence");
  assert.ok(result.candidate.checks.some((line) => line.includes("Missing demand signal")));
  assert.ok(result.candidate.checks.some((line) => line.includes("Missing competition estimate")));
});

test("only reports estimated commission when a positive rate is supplied", () => {
  assert.equal(scoreCandidate({ ...base, commission: "" }).candidate.estimatedCommission, null);
  assert.equal(scoreCandidate({ ...base, commission: 0 }).candidate.estimatedCommission, null);
});


test("ranks ready candidates before incomplete and out-of-stock candidates", () => {
  const compare = require("../discovery-engine").compareCandidatesByReadiness;
  const ready = { label: "Prioritize for review", inStock: true, score: 60 };
  const incompleteHighScore = { label: "Need more evidence", inStock: true, score: 99 };
  const outOfStock = { label: "Do not promote — out of stock", inStock: false, score: 100 };
  assert.ok(compare(ready, incompleteHighScore) < 0);
  assert.ok(compare(incompleteHighScore, outOfStock) < 0);
  assert.ok(compare({ ...ready, score: 80 }, ready) < 0);
});
