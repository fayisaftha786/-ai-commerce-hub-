"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Import = require("../tracker-import.js");

function row(id, overrides) {
  return Object.assign({
    id,
    state: "promising",
    pageStatus: "ok",
    notSeenInLatestScan: false,
    title: "Campaign " + id,
    url: "https://contentrewards.com/c/campaigns/" + id,
    brief: {
      title: "Campaign " + id,
      deadline: "2026-12-01",
      rate: { model: "CPM", label: "$2.50 / 1,000 qualified views" },
      capPerClip: { value: 100, currency: "USD" },
      minimumPayout: { value: 20, currency: "USD" },
      budget: { total: { value: 500, currency: "USD" }, remaining: { value: 300, currency: "USD" } }
    }
  }, overrides || {});
}

test("canonical campaign URLs accept only HTTPS public campaign detail routes", () => {
  assert.equal(Import.canonicalCampaignUrl("https://contentrewards.com/c/campaigns/abc/"), "https://contentrewards.com/c/campaigns/abc");
  assert.equal(Import.canonicalCampaignUrl("https://www.contentrewards.com/c/campaigns/abc"), "https://www.contentrewards.com/c/campaigns/abc");
  assert.equal(Import.canonicalCampaignUrl("http://contentrewards.com/c/campaigns/abc"), "");
  assert.equal(Import.canonicalCampaignUrl("https://contentrewards.com/c/discover"), "");
  assert.equal(Import.canonicalCampaignUrl("https://evil.example/c/campaigns/abc"), "");
});

test("batch import includes only fresh promising campaigns and maps reviewable fields", () => {
  const plan = Import.buildTrackerImportPlan([
    row("good"),
    row("verify", { state: "verify" }),
    row("stale", { pageStatus: "stale" }),
    row("historical", { notSeenInLatestScan: true }),
    row("bad-url", { url: "https://example.com/campaign" })
  ], [], (brief) => "Captured requirements for " + brief.title);
  assert.equal(plan.records.length, 1);
  assert.equal(plan.records[0].name, "Campaign good");
  assert.equal(plan.records[0].platform, "Content Rewards");
  assert.equal(plan.records[0].status, "idea");
  assert.equal(plan.records[0].deadline, "2026-12-01");
  assert.match(plan.records[0].payoutTerms, /CPM/);
  assert.match(plan.records[0].budgetTerms, /remaining/);
  assert.match(plan.records[0].rules, /Captured requirements/);
  assert.equal(plan.summary.skippedNotPromising, 1);
  assert.equal(plan.summary.skippedStale, 2);
  assert.equal(plan.summary.skippedInvalid, 1);
});

test("batch import is idempotent against existing tracker URLs and within one batch", () => {
  const plan = Import.buildTrackerImportPlan([
    row("existing"),
    row("new"),
    row("new", { title: "Duplicate row" })
  ], [{ url: "https://contentrewards.com/c/campaigns/existing/" }]);
  assert.equal(plan.records.length, 1);
  assert.equal(plan.records[0].url, "https://contentrewards.com/c/campaigns/new");
  assert.equal(plan.summary.skippedDuplicate, 2);
});

test("batch import respects the tracker capacity", () => {
  const plan = Import.buildTrackerImportPlan([row("a"), row("b")], [], null, 1);
  assert.equal(plan.records.length, 1);
  assert.equal(plan.summary.skippedInvalid, 1);
});

test("batch import refuses briefs whose creator requirements remain locked until Join", () => {
  const lockedBrief = Object.assign({}, row("locked").brief, { hiddenRequirements: { locked: true, count: 2 } });
  const plan = Import.buildTrackerImportPlan([
    row("locked", { brief: lockedBrief }),
    row("unlocked")
  ], []);
  assert.equal(plan.records.length, 1);
  assert.equal(plan.records[0].url, "https://contentrewards.com/c/campaigns/unlocked");
  assert.equal(plan.summary.skippedLocked, 1);
});
