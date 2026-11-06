"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("fresh public Promising campaigns are imported automatically without a manual import button", () => {
  assert.match(app, /function autoImportFreshPromisingCampaigns\\(result\\)/);
  assert.match(app, /const autoImport = autoImportFreshPromisingCampaigns\\(result\\)/);
  assert.match(app, /buildTrackerImportPlan\\(\\s*result\\.campaigns/);
  assert.doesNotMatch(html, /id="discovery-import-promising"/);
  assert.match(html, /AUTO-IMPORT ON/);
});

test("automatic campaign draft preparation is safe and does not overwrite existing user work", () => {
  assert.match(app, /function autoPrepareDraftFromCampaign\\(row\\)/);
  assert.match(app, /if \\(\\$\\("draft-topic"\\)\\.value\\.trim\\(\\) \\|\\| \\$(\"draft-output\")\\.value\\.trim\\(\\)\\) return false/);
  assert.match(app, /benefit:\\s*""/);
  assert.match(html, /id="draft-auto-status"/);
});
