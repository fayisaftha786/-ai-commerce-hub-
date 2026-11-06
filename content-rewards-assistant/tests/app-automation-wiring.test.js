"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("fresh public Promising campaigns are imported automatically across supported platforms", () => {
  assert.ok(app.includes("function autoImportFreshPromisingCampaigns(result)"));
  assert.ok(app.includes('const targets = ["Instagram", "Facebook", "YouTube"]'));
  assert.ok(app.includes("function getDiscoveryAutomationAnalysis()"));
  assert.ok(app.includes("autoImportFreshPromisingCampaigns(automationResult)"));
  assert.ok(app.includes("buildTrackerImportPlan("));
  assert.ok(app.includes("result.campaigns"));
  assert.ok(!app.includes("data-discovery-import"));
  assert.ok(html.includes("AUTO-SCREEN + IMPORT ON"));
  assert.ok(html.includes("Every readable official public campaign detail is automatically screened against Instagram, Facebook and YouTube."));
  assert.ok(app.includes("Partially screened "));
  assert.ok(app.includes("summary.failures && summary.failures.length"));
});

test("automatic campaign draft preparation is safe and does not overwrite existing user work", () => {
  assert.ok(app.includes("function autoPrepareDraftFromCampaign(row)"));
  assert.ok(app.includes('if ($("draft-topic").value.trim() || $("draft-output").value.trim()) return false;'));
  assert.ok(app.includes('benefit: ""'));
  assert.ok(!app.includes("data-deep-draft"));
  assert.ok(html.includes('id="draft-auto-status"'));
});

test("the latest scheduled snapshot is automatically refreshed while the app is visible", () => {
  assert.ok(app.includes("SCHEDULED_SNAPSHOT_REFRESH_MS = 30 * 60 * 1000"));
  assert.ok(app.includes("function refreshScheduledSnapshotIfDue()"));
  assert.ok(app.includes("scheduledSnapshotRefreshTimer = window.setInterval(refreshScheduledSnapshotIfDue, 60 * 1000)"));
  assert.ok(app.includes('document.addEventListener("visibilitychange", refreshScheduledSnapshotIfDue)'));
  assert.ok(app.includes('window.addEventListener("focus", refreshScheduledSnapshotIfDue)'));
});

test("non-automated campaign lookup and manual feed controls are hidden from the automation-first radar", () => {
  assert.ok(html.includes('<div class="panel-header" hidden>'));
  assert.ok(html.includes('<div class="scout-platform-tiles" hidden>'));
  assert.ok(html.includes('<section class="campaign-feed-panel" aria-labelledby="campaign-feed-heading" hidden>'));
  assert.ok(html.includes('<form id="campaign-scout-form" class="scout-form" hidden>'));
  assert.ok(html.includes('<div class="discovery-controls" hidden>'));
});
