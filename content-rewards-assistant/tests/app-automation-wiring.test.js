"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const packSource = fs.readFileSync(path.join(root, "auto-content-pack.js"), "utf8");
const serviceWorker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");

test("fresh public Promising campaigns are imported automatically across supported platforms", () => {
  assert.ok(app.includes("function autoImportFreshPromisingCampaigns(result)"));
  assert.ok(app.includes('const targets = ["Instagram", "Facebook", "YouTube"]'));
  assert.ok(app.includes("function getDiscoveryAutomationAnalysis()"));
  assert.ok(app.includes("autoImportFreshPromisingCampaigns(result)"));
  assert.ok(app.includes("buildTrackerImportPlan("));
  assert.ok(app.includes("result.campaigns"));
  assert.ok(!app.includes("data-discovery-import"));
  assert.ok(html.includes("AUTO-SCREEN + IMPORT ON"));
  assert.ok(html.includes("Every readable official public campaign detail is automatically screened against Instagram, Facebook and YouTube."));
  assert.ok(app.includes("Partially screened "));
  assert.ok(app.includes("summary.failures && summary.failures.length"));
});


test("the best fresh public campaign automatically generates a bilingual downloadable content pack", () => {
  assert.ok(app.includes("const AutoContentPack = window.ClipRewardAutoContentPack"));
  assert.ok(app.includes("function renderAutoContentPack(row, emptyMessage)"));
  assert.ok(app.includes("AutoContentPack.create(row)"));
  assert.ok(app.includes("AutoContentPack.toText(currentAutoContentPack)"));
  assert.ok(app.includes("AutoContentPack.toJson(currentAutoContentPack)"));
  assert.ok(app.includes("renderAutoContentPack(topPromising"));
  assert.ok(html.includes('id="auto-content-pack"'));
  assert.ok(html.includes('id="auto-content-pack-download-text"'));
  assert.ok(html.includes('id="auto-content-pack-download-json"'));
  assert.ok(html.includes('id="auto-content-pack-copy"'));
  assert.ok(html.includes('src="./auto-content-pack.js"'));
  assert.ok(packSource.includes("This is a local template pack, not an AI-generated or rendered video file."));
  assert.ok(serviceWorker.includes("clipreward-static-v44"));
  assert.ok(serviceWorker.includes("./auto-content-pack.js"));
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

test("non-automated account, submission, video and editing tools are hidden from the main workspace", () => {
  assert.ok(html.includes('<section id="account-center" class="panel account-center" hidden>'));
  assert.ok(html.includes('<section id="content-rewards-workflow" class="panel" hidden>'));
  assert.ok(html.includes('<section id="submissions" class="panel submissions-panel" hidden>'));
  assert.ok(html.includes('<section id="creator-operations" class="panel ops-panel" hidden>'));
  assert.ok(html.includes('<form id="draft-form" class="form-stack" hidden>'));
  assert.ok(html.includes('<section class="video-analysis-panel" id="video-analysis-section" hidden>'));
  assert.ok(html.includes('<section class="video-export-studio" id="real-video-export" hidden>'));
  assert.ok(html.includes('<section class="panel timestamp-panel" hidden>'));
  assert.ok(html.includes('id="add-campaign-button" type="button" hidden'));
  assert.ok(html.includes('<div class="filter-row" hidden>'));
  assert.ok(app.includes('<div class="campaign-actions" hidden>'));
  assert.ok(app.includes("Verify official campaign"));
});

test("the visible campaign tracker is a read-only view of automated imports", () => {
  assert.ok(html.includes("Auto-imported campaigns"));
  assert.ok(html.includes("Records are added automatically as Found / idea."));
  assert.ok(app.includes('viewCampaignLink + postLink'));
});
