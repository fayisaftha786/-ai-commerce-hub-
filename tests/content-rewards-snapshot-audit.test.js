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
      opportunity: { score: 74, tier: "medium", status: "needs-verification", missing: ["Full creator requirements hidden until joining"] }
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

test("locked creator requirements cannot pass the audit with a High score or without a missing-evidence warning", () => {
  const result = Audit.auditSnapshot(snapshot({
    campaigns: [{
      id: "locked-high",
      title: "Locked brief with falsely high score",
      officialUrl: "https://contentrewards.com/c/campaigns/locked-high",
      freshness: "recent",
      hiddenRequirements: { locked: true, count: 1 },
      opportunity: { score: 95, tier: "high", status: "needs-verification", missing: [] }
    }],
    campaignDetails: [{
      url: "https://contentrewards.com/c/campaigns/locked-high",
      status: "ok",
      pageText: "A readable public campaign brief with sufficient text."
    }]
  }));
  assert.equal(result.ok, false);
  assert.equal(result.metrics.lockedRequirementsHighInformationCount, 1);
  assert.equal(result.metrics.lockedRequirementsWithoutWarningCount, 1);
  assert.ok(result.errors.some((item) => /locked creator requirements.*High information tier/i.test(item)));
  assert.ok(result.errors.some((item) => /omit the required missing-evidence warning/i.test(item)));
  assert.match(Audit.formatReport(result), /Locked briefs incorrectly rated High/);
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
