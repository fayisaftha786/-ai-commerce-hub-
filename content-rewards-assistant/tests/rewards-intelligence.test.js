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
  budget: { remaining: { value: 1200, currency: "USD" }, total: { value: 3000, currency: "USD" } },
  capPerClip: { value: 50, currency: "USD" },
  minimumViews: 1000,
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
  for (const label of ["Selected platform", "Platform payout rate", "Budget remaining", "Deadline"]) {
    assert.equal(result.checks.find(x => x.label === label).status, "unknown", label);
  }
});

test("CPM, per-post, retainer and pool payout explanations do not invent rates", () => {
  assert.match(Engine.payoutGuidance({ model: "CPM", amount: { value: 2 }, label: "$2 per 1,000 views" }).formula, /qualified views/i);
  assert.match(Engine.payoutGuidance({ model: "Per post", amount: { value: 50 } }).formula, /clip is approved/i);
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
  assert.match(worker, /clipreward-static-v36/);
  assert.match(packageJson.scripts.check, /content-rewards-assistant\/rewards-intelligence\.js/);
  assert.match(packageJson.scripts.check, /content-rewards-assistant\/tests\/rewards-intelligence\.test\.js/);
});


test("complete copied brief is analysed beyond the shortened preview excerpt", () => {
  const rawText = "Campaign: Long brief\n" + "Plain overview details without rule keywords. ".repeat(90) +
    "\nDo not use AI-generated voice or unlicensed music. This rule is near the end of the copied brief.";
  const result = Engine.inferBriefRequirements({
    rawExcerpt: rawText.slice(0, 1400),
    rawText,
    requirementLines: []
  });
  assert.ok(rawText.length > 1400);
  assert.ok(result.some((item) => item.key === "prohibited-actions"));
  assert.ok(result.some((item) => item.key === "rights"));
});

test("selected platform's own rate, per-clip cap and minimum views override general campaign figures", () => {
  const result = Engine.assessCampaign({
    platform: "YouTube",
    today: "2026-10-31",
    brief: brief({
      platformRates: [
        { platform: "Instagram", model: "CPM", label: "$2.50 per 1,000 views", amount: { value: 2.5, currency: "USD" } },
        { platform: "YouTube", model: "CPM", label: "$1.25 per 1,000 views", amount: { value: 1.25, currency: "USD" } }
      ],
      platformCaps: [
        { platform: "Instagram", amount: { value: 75, currency: "USD" } },
        { platform: "YouTube", amount: { value: 40, currency: "USD" } }
      ],
      platformMinimumViews: [
        { platform: "Instagram", value: 5000 },
        { platform: "YouTube", value: 10000 }
      ],
      capPerClip: { value: 75, currency: "USD" },
      minimumViews: 5000
    })
  });
  assert.equal(result.rate.amount.value, 1.25);
  assert.equal(result.capPerClip.value, 40);
  assert.equal(result.minimumViews, 10000);
  assert.equal(result.state, "promising");
});

test("a campaign with platform-specific rates does not borrow another platform's rate", () => {
  const result = Engine.assessCampaign({
    platform: "Facebook",
    today: "2026-10-31",
    brief: brief({
      platformRates: [{ platform: "YouTube", model: "CPM", label: "$1 CPM", amount: { value: 1, currency: "USD" } }],
      rate: { model: "CPM", label: "$2 CPM", amount: { value: 2, currency: "USD" } },
      platformMatch: "match"
    })
  });
  assert.equal(result.rate, null);
  assert.equal(result.checks.find((item) => item.label === "Platform payout rate").status, "unknown");
  assert.equal(result.state, "verify");
});

test("campaign payout guidance reflects current creator-fee tiers without inventing a payout amount", () => {
  const cpmFee = Engine.creatorFee({ model: "CPM" }, { total: { value: 1000, currency: "USD" } });
  const poolFee = Engine.creatorFee({ model: "Pool" }, { total: { value: 5000, currency: "USD" } });
  const perPostPremium = Engine.creatorFee({ model: "Per post" }, { total: { value: 5000, currency: "USD" } });
  const perPostStandard = Engine.creatorFee({ model: "Per post" }, { total: { value: 4999, currency: "USD" } });
  const unknownBudget = Engine.creatorFee({ model: "Retainer" }, null);
  assert.equal(cpmFee.percent, 10);
  assert.equal(poolFee.percent, 10);
  assert.equal(perPostPremium.percent, 0);
  assert.equal(perPostStandard.percent, 10);
  assert.equal(unknownBudget.percent, null);
  assert.equal(Engine.creatorFee({ model: "Retainer" }, { total: { value: 6000, currency: "INR" } }).percent, null);
});

test("paused, ended and zero-budget campaigns are blocked before creator work begins", () => {
  for (const status of ["Paused", "Ended / closed", "Out of budget"]) {
    const result = Engine.assessCampaign({
      platform: "Instagram",
      today: "2026-10-31",
      brief: brief({ campaignStatus: status })
    });
    assert.equal(result.state, "blocked", status);
    assert.ok(result.reasons.some((item) => item.includes(status)));
  }
});

test("private invitation campaigns get an invitation-specific action plan", () => {
  const result = Engine.assessCampaign({
    platform: "Instagram",
    today: "2026-10-31",
    brief: brief({ entryMode: "Private / invitation-only" })
  });
  assert.match(result.nextStep, /invitation link/i);
});


test("locked public campaign requirements block a positive recommendation until reviewed", () => {
  const result = Engine.assessCampaign({
    platform: "Instagram",
    today: "2026-10-31",
    brief: brief({
      minimumPayout: { value: 1, currency: "USD" },
      hiddenRequirements: { locked: true, count: 1, referenceFiles: 3 },
      entryMode: "Open campaign / direct join"
    })
  });
  assert.equal(result.state, "verify");
  assert.equal(result.minimumPayout.value, 1);
  assert.ok(result.requirements.some((item) => item.key === "locked-requirements"));
  assert.equal(result.checks.find((item) => item.label === "Full creator requirements").status, "unknown");
});

test("minimum payout threshold is separate from minimum views", () => {
  const result = Engine.assessCampaign({
    platform: "Instagram",
    today: "2026-10-31",
    brief: brief({
      minimumPayout: { value: 2, currency: "USD" },
      minimumViews: null
    })
  });
  assert.equal(result.minimumPayout.value, 2);
  assert.equal(result.minimumViews, null);
  assert.equal(result.checks.find((item) => item.label === "Minimum payout threshold").status, "pass");
});

test("current CPM cards can use a platform-specific minimum payout when no minimum view count is displayed", () => {
  const result = Engine.assessCampaign({
    platform: "YouTube",
    today: "2026-11-01",
    brief: brief({
      deadline: "",
      campaignStatus: "Appears live in copied text",
      entryMode: "Open campaign / direct join",
      minimumViews: null,
      minimumPayout: { value: 5, currency: "USD" },
      platformMinimumPayouts: [
        { platform: "Instagram", amount: { value: 2, currency: "USD" } },
        { platform: "YouTube", amount: { value: 5, currency: "USD" } }
      ],
      platformRates: [
        { platform: "Instagram", model: "CPM", label: "$2 per 1K views", amount: { value: 2, currency: "USD" } },
        { platform: "YouTube", model: "CPM", label: "$3 per 1K views", amount: { value: 3, currency: "USD" } }
      ],
      platformCaps: [{ platform: "YouTube", amount: { value: 250, currency: "USD" } }],
      platformMinimumViews: []
    })
  });
  assert.equal(result.state, "promising");
  assert.equal(result.rate.amount.value, 3);
  assert.equal(result.minimumPayout.value, 5);
  assert.equal(result.acceptingWithoutDeadline, true);
  assert.equal(result.checks.find((item) => item.label === "Minimum views").status, "not-applicable");
  assert.equal(result.checks.find((item) => item.label === "Minimum payout threshold").status, "pass");
  assert.ok(result.reasons.some((item) => /no fixed closing date/i.test(item)));
});

test("Pool campaigns require visible pool size, split basis and payout timing before a promising assessment", () => {
  const complete = Engine.assessCampaign({
    platform: "Instagram",
    today: "2026-11-01",
    brief: brief({
      rate: { model: "Pool", amount: null, label: "Pool — shared allocation" },
      minimumViews: null,
      minimumPayout: null,
      capPerClip: null,
      pool: {
        amount: { value: 25000, currency: "USD" },
        splitBy: "Views",
        paidWhen: "When the pool ends"
      }
    })
  });
  assert.equal(complete.state, "promising");
  assert.equal(complete.checks.find((item) => item.label === "Pool allocation terms").status, "pass");
  assert.equal(complete.payout.amountKnown, false);

  const incomplete = Engine.assessCampaign({
    platform: "Instagram",
    today: "2026-11-01",
    brief: brief({
      rate: { model: "Pool", amount: null, label: "Pool — shared allocation" },
      pool: { amount: { value: 25000, currency: "USD" }, splitBy: "", paidWhen: "" }
    })
  });
  assert.equal(incomplete.state, "verify");
  assert.equal(incomplete.checks.find((item) => item.label === "Pool allocation terms").status, "unknown");
});


test("CPM net scenario applies the per-clip cap, remaining budget and 10% creator fee", () => {
  const result = Engine.estimateCreatorNetPayout({
    rate: { model: "CPM", amount: { value: 2, currency: "USD" } },
    views: 100000,
    minimumViews: 1000,
    capPerClip: { value: 100, currency: "USD" },
    budgetRemaining: { value: 80, currency: "USD" },
    approved: true
  });
  assert.equal(result.available, true);
  assert.equal(result.projectedGross, 80);
  assert.equal(result.creatorFeePercent, 10);
  assert.equal(result.projectedNet, 72);
  assert.equal(result.estimatedNetAfterApproval, 72);
  assert.equal(result.confirmedPayable, 0);
  assert.equal(result.confidence, "scenario-only");
});

test("CPM scenario does not pay before the minimum views threshold", () => {
  const result = Engine.estimateCreatorNetPayout({
    rate: { model: "CPM", amount: { value: 3, currency: "USD" } },
    views: 500,
    minimumViews: 1000,
    capPerClip: { value: 50, currency: "USD" },
    budgetRemaining: { value: 500, currency: "USD" },
    approved: true
  });
  assert.equal(result.projectedGross, 0);
  assert.equal(result.estimatedNetAfterApproval, 0);
  assert.ok(result.warnings.some((warning) => /minimum-view threshold/i.test(warning)));
});

test("unknown CPM threshold permits a labelled scenario but never a payable amount", () => {
  const result = Engine.estimateCreatorNetPayout({
    rate: { model: "CPM", amount: { value: 2, currency: "USD" } },
    views: 10000,
    minimumViews: null,
    capPerClip: { value: 50, currency: "USD" },
    budgetRemaining: { value: 500, currency: "USD" },
    approved: true
  });
  assert.equal(result.projectedGross, 20);
  assert.equal(result.projectedNet, 18);
  assert.equal(result.estimatedNetAfterApproval, 0);
  assert.equal(result.confidence, "incomplete");
});

test("per-post payout uses the campaign budget fee rule and requires approval", () => {
  const baseInput = {
    rate: { model: "Per post", amount: { value: 75, currency: "USD" } },
    budget: { total: { value: 6000, currency: "USD" } },
    budgetRemaining: { value: 500, currency: "USD" },
    minimumViews: 5000,
    views: 8000
  };
  const pending = Engine.estimateCreatorNetPayout({ ...baseInput, approved: false });
  assert.equal(pending.creatorFeePercent, 0);
  assert.equal(pending.projectedNet, 75);
  assert.equal(pending.estimatedNetAfterApproval, 75);
  assert.equal(pending.confirmedPayable, 0);
  const approved = Engine.estimateCreatorNetPayout({ ...baseInput, approved: true });
  assert.equal(approved.estimatedNetAfterApproval, 75);
});

test("pool payout and mismatched currency do not produce a false estimate", () => {
  const pool = Engine.estimateCreatorNetPayout({
    rate: { model: "Pool", amount: null, currency: "USD" },
    views: 100000
  });
  assert.equal(pool.available, false);
  const mismatch = Engine.estimateCreatorNetPayout({
    rate: { model: "CPM", amount: { value: 2, currency: "USD" } },
    views: 10000,
    minimumViews: 1000,
    capPerClip: { value: 50, currency: "INR" },
    budgetRemaining: { value: 500, currency: "USD" }
  });
  assert.equal(mismatch.available, false);
});

test("Rewards Studio wires the payout scenario calculator and refreshes its static cache", () => {
  const root = path.join(__dirname, "..");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const worker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  assert.match(app, /estimateCreatorNetPayout/);
  assert.match(app, /ri-estimate-views/);
  assert.match(app, /confirmedPayable/);
  assert.match(worker, /clipreward-static-v36/);
});
