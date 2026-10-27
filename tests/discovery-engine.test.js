"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { scoreCandidate, createContentPack } = require("../discovery-engine");

const today = () => new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0") + "-" + String(new Date().getDate()).padStart(2, "0");
const base = { name: "Storage organiser", price: 599, rating: 4.4, reviews: 250, commission: 10, demand: 4, competition: 2, inStock: true, url: "https://www.amazon.in/dp/B001", source: "Official dashboard", checkedAt: today() };

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
  assert.equal(result.candidate.rating, null);
  assert.equal(result.candidate.reviews, null);
  assert.equal(result.candidate.commission, null);
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
  const ready = { label: "Prioritize for review", inStock: true, score: 60, evidenceTraceable: true, url: "https://www.amazon.in/dp/B010", commission: 10, source: "Official dashboard", checkedAt: today() };
  const incompleteHighScore = { label: "Need more evidence", inStock: true, score: 99 };
  const outOfStock = { label: "Do not promote — out of stock", inStock: false, score: 100 };
  assert.ok(compare(ready, incompleteHighScore) < 0);
  assert.ok(compare(incompleteHighScore, outOfStock) < 0);
  assert.ok(compare({ ...ready, score: 80 }, ready) < 0);
});

test("demotes saved candidates when their evidence becomes stale or future-dated", () => {
  const compare = require("../discovery-engine").compareCandidatesByReadiness;
  const current = { label: "Prioritize for review", inStock: true, score: 55, evidenceTraceable: true, url: "https://www.amazon.in/dp/B010", commission: 10, source: "Official dashboard", checkedAt: today() };
  const staleDate = new Date(Date.now() - 9 * 86400000);
  const staleCheckedAt = staleDate.getFullYear() + "-" + String(staleDate.getMonth() + 1).padStart(2, "0") + "-" + String(staleDate.getDate()).padStart(2, "0");
  const futureDate = new Date(Date.now() + 2 * 86400000);
  const futureCheckedAt = futureDate.getFullYear() + "-" + String(futureDate.getMonth() + 1).padStart(2, "0") + "-" + String(futureDate.getDate()).padStart(2, "0");
  const stale = { ...current, checkedAt: staleCheckedAt, score: 99 };
  const future = { ...current, checkedAt: futureCheckedAt, score: 98 };
  assert.ok(compare(current, stale) < 0);
  assert.ok(compare(current, future) < 0);
});


test("keeps missing demand and competition unknown in saved candidate data", () => {
  const result = scoreCandidate({ ...base, demand: "", competition: "" });
  assert.equal(result.valid, true);
  assert.equal(result.candidate.demand, null);
  assert.equal(result.candidate.competition, null);
  assert.equal(result.candidate.label, "Need more evidence");
  assert.ok(!result.candidate.checks.some((line) => line.includes("Demand evidence is weak")));
});

test("candidate cards label missing signals as not checked rather than numeric estimates", () => {
  const app = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "app.js"), "utf8");
  assert.match(app, /Number\.isFinite\(candidate\.demand\) \? candidate\.demand \+ "\/5" : "not checked"/);
  assert.match(app, /Number\.isFinite\(candidate\.competition\) \? candidate\.competition \+ "\/5" : "not checked"/);
  assert.match(app, /candidate\.commission > 0 \? candidate\.commission \+ "%" : "not confirmed"/);
});


test("requires a current source, date, link, commission and known stock before prioritising", () => {
  const complete = scoreCandidate(base);
  assert.equal(complete.valid, true);
  assert.equal(complete.candidate.evidenceFreshness, "current");
  assert.equal(complete.candidate.evidenceTraceable, true);
  assert.equal(complete.candidate.label, "Test with a small post");
  assert.equal(complete.candidate.inStock, true);
  assert.equal(complete.candidate.evidenceCoverage, 100);

  const noLink = scoreCandidate({ ...base, url: "" });
  assert.equal(noLink.candidate.label, "Need more evidence");
  assert.ok(noLink.candidate.checks.some((line) => line.includes("Missing valid HTTPS")));

  const noCommission = scoreCandidate({ ...base, commission: "" });
  assert.equal(noCommission.candidate.label, "Need more evidence");
  assert.ok(noCommission.candidate.checks.some((line) => line.includes("Commission is missing")));

  const unknownStock = scoreCandidate({ ...base, inStock: null });
  assert.equal(unknownStock.candidate.inStock, null);
  assert.equal(unknownStock.candidate.label, "Need more evidence");
  assert.ok(unknownStock.candidate.checks.some((line) => line.includes("Stock status is not checked")));

  const staleDate = new Date(Date.now() - 10 * 86400000);
  const staleCheckedAt = staleDate.getFullYear() + "-" + String(staleDate.getMonth() + 1).padStart(2, "0") + "-" + String(staleDate.getDate()).padStart(2, "0");
  const stale = scoreCandidate({ ...base, checkedAt: staleCheckedAt });
  assert.equal(stale.candidate.evidenceFreshness, "stale");
  assert.equal(stale.candidate.label, "Need more evidence");

  const futureDate = new Date(Date.now() + 2 * 86400000);
  const futureCheckedAt = futureDate.getFullYear() + "-" + String(futureDate.getMonth() + 1).padStart(2, "0") + "-" + String(futureDate.getDate()).padStart(2, "0");
  const future = scoreCandidate({ ...base, checkedAt: futureCheckedAt });
  assert.equal(future.candidate.evidenceFreshness, "future");
  assert.equal(future.candidate.label, "Need more evidence");

  const outOfStock = scoreCandidate({ ...base, inStock: false });
  assert.equal(outOfStock.candidate.label, "Do not promote — out of stock");
});


test("creates a bulk content pack for each row and preserves per-product details", () => {
  const { createBulkContentPacks } = require("../discovery-engine");
  const packs = createBulkContentPacks([
    { name: "Rack", benefit: "saves counter space", audience: "small homes", proof: "listing dimensions", price: "599", link: "https://example.com/rack" },
    { name: "Bottle", benefit: "helps carry water", proof: "capacity shown on label" }
  ], { language: "English", platform: "Instagram", type: "Video" });
  assert.equal(packs.length, 2);
  assert.match(packs[0].pack.post, /Rack/);
  assert.ok(packs[0].pack.post.includes("https://example.com/rack"));
  assert.match(packs[1].pack.post, /Bottle/);
  assert.match(packs[1].pack.post, /Affiliate disclosure/);
});

test("bulk content rejects missing rows, missing required fields, and batches above 50", () => {
  const { createBulkContentPacks } = require("../discovery-engine");
  assert.throws(() => createBulkContentPacks([]), /at least one product row/i);
  assert.throws(() => createBulkContentPacks([{ name: "Rack", benefit: "" }]), /row 1 needs both/i);
  assert.throws(() => createBulkContentPacks(Array.from({ length: 51 }, (_, i) => ({ name: "P" + i, benefit: "useful" }))), /up to 50/i);
});


test("single-product content can be generated without an unverified benefit claim", () => {
  const { createContentPack } = require("../discovery-engine");
  const pack = createContentPack({ name: "Desk Lamp", benefit: "", proof: "", language: "English", type: "Video" });
  assert.match(pack.post, /Review the listed details to decide whether Desk Lamp fits your needs/);
  assert.doesNotMatch(pack.post, /a useful everyday solution/i);
  assert.match(pack.video, /Show only real product details supported by the listing/);
  assert.match(pack.video, /Do not invent benefits or performance claims/);
});
