"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Audit = require("../scripts/audit-content-rewards-snapshot.js");

function snapshot(overrides = {}) {
  return Object.assign({
    schemaVersion: 1,
    generatedAt: "2026-11-03T00:00:00.000Z",
    campaigns: [{
      id: "one",
      title: "Current campaign",
      officialUrl: "https://contentrewards.com/c/campaigns/one",
      freshness: "recent",
      deadline: "",
      hiddenRequirements: { locked: true },
      opportunity: { tier: "high", status: "needs-verification" }
    }, {
      id: "old",
      officialUrl: "https://contentrewards.com/c/campaigns/old",
      notSeenInLatestScan: true,
      opportunity: { tier: "high", status: "not-seen-in-latest-scan" }
    }],
    campaignDetails: [{
      url: "https://contentrewards.com/c/campaigns/one",
      status: "ok",
      pageText: "A readable public campaign brief with sufficient text."
    }]
  }, overrides);
}

test("valid snapshot passes structural checks and reports risk indicators separately", () => {
  const result = Audit.auditSnapshot(snapshot(), Date.parse("2026-11-03T01:00:00.000Z"));
  assert.equal(result.ok, true);
  assert.equal(result.metrics.currentCampaignCount, 1);
  assert.equal(result.metrics.historicalCampaignCount, 1);
  assert.equal(result.metrics.readableCurrentDetailCount, 1);
  assert.equal(result.metrics.lockedCurrentRequirementsCount, 1);
  assert.equal(result.metrics.missingCurrentDeadlineCount, 1);
  assert.ok(result.warnings.some((item) => /historical campaign/i.test(item)));
  assert.ok(result.warnings.some((item) => /not an eligibility or earnings prediction/i.test(item)));
});

test("stale snapshots produce warnings but remain structurally valid for safe fallback publishing", () => {
  const result = Audit.auditSnapshot(snapshot({ generatedAt: "2026-10-30T00:00:00.000Z" }), Date.parse("2026-11-03T00:00:00.000Z"));
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((item) => /older than 24 hours/i.test(item)));
});

test("malformed schema and invalid campaign records fail structural validation", () => {
  const result = Audit.auditSnapshot(snapshot({
    schemaVersion: 99,
    campaigns: [null]
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => /schemaVersion/i.test(item)));
  assert.ok(result.errors.some((item) => /campaign record must be an object/i.test(item)));
});

test("duplicate identifiers and unsafe URLs are reported without being presented as active evidence", () => {
  const result = Audit.auditSnapshot(snapshot({
    campaigns: [
      { id: "same", officialUrl: "https://contentrewards.com/c/campaigns/a" },
      { id: "same", officialUrl: "https://contentrewards.com.evil.test/c/campaigns/b" }
    ]
  }));
  assert.equal(result.ok, true);
  assert.equal(result.metrics.duplicateCampaignIds, 1);
  assert.equal(result.metrics.invalidCampaignUrls, 1);
  assert.ok(result.warnings.some((item) => /duplicate campaign ID/i.test(item)));
  assert.ok(result.warnings.some((item) => /non-canonical official URLs/i.test(item)));
});

test("report labels high information score as evidence coverage rather than earnings", () => {
  const report = Audit.formatReport(Audit.auditSnapshot(snapshot()));
  assert.match(report, /High information score \(not earnings\)/);
  assert.match(report, /Structural validation/);
});
