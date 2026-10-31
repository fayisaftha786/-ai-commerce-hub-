"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Engine = require("../rewards-intelligence.js");
const brief = (overrides = {}) => ({
  title: "Creator Launch", platforms: ["Instagram", "Facebook", "YouTube"], unsupportedPlatforms: [],
  platformMatch: "match", deadline: "2026-12-15", entryMode: "Application / brand review",
  rate: { model: "CPM", label: "$2 per 1,000 views", amount: { value: 2, currency: "USD" } },
  budget: { remaining: { value: 1200, currency: "USD" } },
  rawExcerpt: "Must publish original clips. Include #ad and @brand. Minimum 30 seconds. Submit within 30 minutes.",
  requirementLines: ["Must publish original clips.", "Include #ad.", "Minimum 30 seconds."], ...overrides
});

test("matching complete campaign brief is promising but never claims account eligibility", () => {
  const result = Engine.assessCampaign({ brief: brief(), platform: "Instagram", today: "2026-10-31" });
  assert.equal(result.state, "promising");
  assert.equal(result.checks.find(x => x.label === "Selected platform").status, "pass");
  assert.equal(result.checks.find(x => x.label === "Creator account / campaign approval").status, "unknown");
  assert.match(result.nextStep, /confirm the exact account/i);
});

test("explicit platform mismatch blocks campaign work", () => {
  const result = Engine.assessCampaign({ brief: brief({ platforms: ["YouTube"], platformMatch: "mismatch" }), platform: "Instagram", today: "2026-10-31" });
  assert.equal(result.state, "blocked");
  assert.equal(result.checks.find(x => x.label === "Selected platform").status, "fail");
});

test("past deadline blocks opportunity recommendation", () => {
  const result = Engine.assessCampaign({ brief: brief({ deadline: "2026-10-30" }), platform: "Instagram", today: "2026-10-31" });
  assert.equal(result.state, "blocked");
});

test("unknown platform, payout, budget and deadline remain unknown", () => {
  const result = Engine.assessCampaign({ brief: brief({ platforms: [], platformMatch: "unknown", rate: null, budget: null, deadline: "", entryMode: "" }), platform: "Facebook", today: "2026-10-31" });
  assert.equal(result.state, "verify");
  for (const label of ["Selected platform", "Payout model", "Budget remaining", "Deadline"]) {
    assert.equal(result.checks.find(x => x.label === label).status, "unknown", label);
  }
});

test("CPM, per-post, retainer and pool payout explanations do not invent rates", () => {
  assert.match(Engine.payoutGuidance({ model: "CPM", amount: { value: 2 }, label: "$2 per 1,000 views" }).formula, /qualified views/i);
  assert.match(Engine.payoutGuidance({ model: "Per post", amount: { value: 50 } }).formula, /approved post/i);
  assert.equal(Engine.payoutGuidance({ model: "Retainer", amount: null }).amountKnown, false);
  assert.match(Engine.payoutGuidance({ model: "Pool", amount: null }).formula, /not a fixed CPM/i);
  assert.equal(Engine.payoutGuidance(null).amountKnown, false);
});

test("campaign brief requirement scan recognises key production and submission rules", () => {
  const keys = Engine.inferBriefRequirements(brief()).map(x => x.key);
  for (const key of ["originality", "disclosure", "duration", "hashtags", "mentions", "submission-window"]) assert.ok(keys.includes(key), key);
  assert.ok(Engine.inferBriefRequirements({ rawExcerpt: "Draft must receive pre-approval before publish." }).some(x => x.key === "preapproval"));
});

test("India platform destinations exclude TikTok", () => {
  assert.deepEqual(Engine.INDIA_POSTING_PLATFORMS, ["Instagram", "Facebook", "YouTube", "X"]);
  const result = Engine.assessCampaign({ brief: brief({ platforms: ["TikTok"], unsupportedPlatforms: ["TikTok"], platformMatch: "mismatch" }), platform: "Instagram", today: "2026-10-31" });
  assert.equal(result.state, "blocked");
});

test("native YouTube, Facebook and Instagram earnings remain separate and unknown without APIs", () => {
  const result = Engine.assessAll({ brief: brief(), platform: "Instagram", today: "2026-10-31" });
  assert.deepEqual(result.nativePrograms.map(x => x.platform), ["YouTube", "Facebook", "Instagram"]);
  assert.ok(result.nativePrograms.every(x => x.status === "unknown" && x.checks.length >= 4));
  assert.equal(result.apiStatus, "not-connected");
  assert.ok(result.nativePrograms.every(x => /^https:\/\//.test(x.source)));
});

test("UI loads the engine, renders the three native checks and refreshes its offline cache", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const worker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "..", "package.json"), "utf8"));
  assert.match(html, /rewards-intelligence\.js/);
  assert.match(html, /id="reward-intelligence-results"/);
  assert.match(app, /ClipRewardIntelligence\.assessAll/);
  assert.match(app, /renderRewardsIntelligence/);
  assert.match(worker, /rewards-intelligence\.js/);
  assert.match(worker, /clipreward-static-v8/);
  assert.match(packageJson.scripts.check, /content-rewards-assistant\/rewards-intelligence\.js/);
  assert.match(packageJson.scripts.check, /content-rewards-assistant\/tests\/rewards-intelligence\.test\.js/);
});
