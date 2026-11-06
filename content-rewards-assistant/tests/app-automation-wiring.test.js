"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("fresh public Promising campaigns are imported automatically without a manual import button", () => {
  assert.ok(app.includes("function autoImportFreshPromisingCampaigns(result)"));
  assert.ok(app.includes("const autoImport = autoImportFreshPromisingCampaigns(result)"));
  assert.ok(app.includes("buildTrackerImportPlan(\n      result.campaigns"));
  assert.ok(!html.includes('id="discovery-import-promising"'));
  assert.ok(html.includes("AUTO-IMPORT ON"));
});

test("automatic campaign draft preparation is safe and does not overwrite existing user work", () => {
  assert.ok(app.includes("function autoPrepareDraftFromCampaign(row)"));
  assert.ok(app.includes('if ($("draft-topic").value.trim() || $("draft-output").value.trim()) return false;'));
  assert.ok(app.includes('benefit: ""'));
  assert.ok(!app.includes("data-deep-draft"));
  assert.ok(html.includes('id="draft-auto-status"'));
});
