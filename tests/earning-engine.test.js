"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../earning-engine");

const base = {
  id: "opp-1", title: "Creator campaign", platform: "instagram",
  sourceUrl: "https://example.com/campaign", eligibility: "eligible",
  reward: 2500, effortHours: 5, payoutConfidence: "official-terms",
  risk: "low", deadline: "2026-11-10", sourceCheckedAt: "2026-10-30", deliverables: ["Create one original short video"]
};

test("India provider registry excludes TikTok and lists the supported provider categories", () => {
  const ids = engine.INDIA_PROVIDER_REGISTRY.map(item => item.id);
  assert.ok(ids.includes("youtube"));
  assert.ok(ids.includes("instagram"));
  assert.ok(ids.includes("snapchat"));
  assert.ok(ids.includes("amazon"));
  assert.ok(!ids.includes("tiktok"));
});


test("imports an available official creator program as an unverified research task", () => {
  const source = {
    id: "youtube-ypp",
    status: "available",
    sourceUrl: "https://support.google.com/youtube/answer/72851?hl=en-IN",
    pageTitle: "Official YPP eligibility guide",
    accountCheck: "YouTube Studio → Earn",
    limitation: "Channel eligibility must be checked in Studio.",
    checkedAt: "2026-11-01T01:00:00.000Z",
    ruleEvidence: [{
      label: "Full YPP route",
      excerpt: "1,000 subscribers and 4,000 qualified public watch hours",
      interpretation: "Channel review and other requirements still apply."
    }]
  };
  const result = engine.createOfficialProgramOpportunity(source);
  assert.equal(result.valid, true);
  assert.equal(result.opportunity.id, "official-youtube-ypp");
  assert.equal(result.opportunity.platform, "youtube");
  assert.equal(result.opportunity.eligibility, "unknown");
  assert.equal(result.opportunity.payoutConfidence, "unknown");
  assert.equal(result.opportunity.risk, "unknown");
  assert.equal(result.opportunity.reward, null);
  assert.equal(result.opportunity.effortHours, null);
  assert.equal(result.opportunity.sourceCheckedAt, "2026-11-01");
  assert.match(result.opportunity.description, /1,000 subscribers/);
  assert.match(result.opportunity.notes, /Research task auto-imported/);
  assert.equal(engine.analyzeOpportunity(result.opportunity).analysis.coverage, 15);
});

test("official source importer distinguishes full and expanded YPP and maps Meta programs", () => {
  const cases = [
    ["youtube-expanded-ypp", "youtube", "https://support.google.com/youtube/answer/13429240?hl=en-IN"],
    ["facebook-content-monetization", "facebook", "https://about.fb.com/news/2026/03/creator-fast-track-grow-your-audience-earn-money-on-facebook/"],
    ["instagram-creator-marketplace", "instagram", "https://about.fb.com/news/2024/02/creator-marketplace-for-brands-and-creators-to-collaborate-on-instagram/"]
  ];
  for (const [id, platform, sourceUrl] of cases) {
    const result = engine.createOfficialProgramOpportunity({ id, status: "available", sourceUrl }, "2026-11-01T00:00:00.000Z");
    assert.equal(result.valid, true, id);
    assert.equal(result.opportunity.platform, platform);
    assert.equal(result.opportunity.eligibility, "unknown");
    assert.equal(result.opportunity.reward, null);
  }
});

test("official source importer rejects unknown, unavailable and mismatched source records", () => {
  const valid = {
    id: "youtube-ypp",
    status: "available",
    sourceUrl: "https://support.google.com/youtube/answer/72851?hl=en-IN"
  };
  assert.equal(engine.createOfficialProgramOpportunity({ ...valid, id: "fake-program" }).valid, false);
  assert.equal(engine.createOfficialProgramOpportunity({ ...valid, status: "unavailable" }).valid, false);
  assert.equal(engine.createOfficialProgramOpportunity({ ...valid, sourceUrl: "https://support.google.com/evil" }).valid, false);
  assert.equal(engine.createOfficialProgramOpportunity({ ...valid, sourceUrl: "http://support.google.com/youtube/answer/72851" }).valid, false);
});

test("validates required fields and rejects unsafe source links", () => {
  assert.equal(engine.validateOpportunity(base).valid, true);
  assert.equal(engine.validateOpportunity({ ...base, sourceUrl: "javascript:alert(1)" }).valid, false);
  assert.equal(engine.validateOpportunity({ ...base, sourceUrl: "http://example.com" }).valid, false);
  assert.equal(engine.validateOpportunity({ ...base, title: "" }).valid, false);
});

test("rejects invalid amounts, effort, currency and dates", () => {
  assert.equal(engine.validateOpportunity({ ...base, reward: -1 }).valid, false);
  assert.equal(engine.validateOpportunity({ ...base, effortHours: 0 }).valid, false);
  assert.equal(engine.validateOpportunity({ ...base, currency: "RUPEES" }).valid, false);
  assert.equal(engine.validateOpportunity({ ...base, deadline: "2026-02-31" }).valid, false);
});

test("score reports evidence coverage and blocks ineligible or high-risk opportunities", () => {
  const full = engine.analyzeOpportunity(base, new Date("2026-10-30T00:00:00Z"));
  assert.equal(full.valid, true);
  assert.equal(full.analysis.coverage, 100);
  assert.equal(full.analysis.blocked, false);
  assert.ok(full.analysis.score >= 0 && full.analysis.score <= 100);
  const blocked = engine.analyzeOpportunity({ ...base, eligibility: "ineligible" });
  assert.equal(blocked.analysis.blocked, true);
  const risky = engine.analyzeOpportunity({ ...base, risk: "high" });
  assert.equal(risky.analysis.blocked, true);
});

test("stale source evidence lowers the score and impossible source dates are rejected", () => {
  const fresh = engine.analyzeOpportunity(base, new Date("2026-10-30T00:00:00Z"));
  const stale = engine.analyzeOpportunity({ ...base, sourceCheckedAt: "2026-09-01" }, new Date("2026-10-30T00:00:00Z"));
  assert.ok(stale.analysis.score < fresh.analysis.score);
  assert.equal(engine.validateOpportunity({ ...base, sourceCheckedAt: "2026-02-31" }).valid, false);
});

test("unknown fields lower evidence coverage rather than receiving positive points", () => {
  const result = engine.analyzeOpportunity({ ...base, eligibility: "unknown", reward: null, effortHours: null, payoutConfidence: "unknown", risk: "unknown", deadline: "", sourceCheckedAt: "" });
  assert.equal(result.analysis.coverage, 0);
  assert.equal(result.analysis.score, 0);
  assert.equal(result.analysis.label, "Need more evidence");
});

test("task planner includes approval gates and evidence capture", () => {
  const result = engine.createTaskPlan(base);
  assert.equal(result.valid, true);
  assert.ok(result.tasks.some(task => /eligibility/i.test(task.title) && task.requiresApproval));
  assert.ok(result.tasks.some(task => /publish/i.test(task.title) && task.requiresApproval));
  assert.ok(result.tasks.some(task => /evidence/i.test(task.title)));
  assert.ok(result.tasks.some(task => /payout/i.test(task.title)));
});

test("earnings summary separates estimated, confirmed and paid INR amounts", () => {
  const result = engine.summarizeEarnings([
    { status: "estimated", amount: 100, currency: "INR" },
    { status: "confirmed", amount: 250, currency: "INR" },
    { status: "paid", amount: 75, currency: "INR" },
    { status: "paid", amount: 999, currency: "USD" },
    { status: "paid", amount: -1, currency: "INR" }
  ]);
  assert.deepEqual(result, { estimated: 100, confirmed: 250, paid: 75, currency: "INR", count: 3 });
});

test("ranking puts eligible evidence-backed items ahead of blocked items", () => {
  const result = engine.rankOpportunities([
    { ...base, id: "blocked", eligibility: "ineligible" },
    { ...base, id: "ready" }
  ], new Date("2026-10-30T00:00:00Z"));
  assert.equal(result[0].id, "ready");
  assert.equal(result[1].id, "blocked");
});
