"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");

test("every direct app event-listener target exists in the HTML", () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const targets = [...app.matchAll(/\$\("([^"]+)"\)\.addEventListener\(/g)].map((match) => match[1]);
  assert.ok(targets.length > 0, "expected app event listeners");
  assert.deepEqual([...new Set(targets.filter((id) => !ids.has(id)))], []);
});

test("catalog importer is loaded exactly once before app.js", () => {
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(scripts.filter((src) => src === "catalog-import.js").length, 1);
  assert.ok(scripts.indexOf("catalog-import.js") < scripts.indexOf("app.js"));
});


test("imported catalog products can be transferred to Content Studio without stale claims", () => {
  assert.match(app, /contentButton\.textContent = "Use in Content Studio"/);
  assert.match(app, /contentButton\.addEventListener\("click", \(\) => useCatalogProductInContent\(record\)\)/);
  assert.match(app, /\$\("contentName"\)\.value = record\.name/);
  assert.match(app, /\$\("contentBenefit"\)\.value = ""/);
  assert.match(app, /\$\("contentProof"\)\.value = ""/);
});


test("campaign registry controls exist and are wired to local campaign storage and CSV export", () => {
  for (const id of ["saveContentCampaign", "exportCampaigns", "campaignList", "campaignMessage"]) {
    assert.ok(html.includes('id="' + id + '"'), "missing campaign UI id: " + id);
  }
  assert.ok(app.includes('const CAMPAIGN_KEY = "ai-commerce-hub.campaigns.v1"'));
  assert.ok(app.includes("campaigns.push(campaign)"));
  assert.ok(app.includes("campaign_id"));
  assert.ok(html.includes("does not track external clicks"));
  assert.ok(app.includes('parsed.protocol === "https:"'));
});

test("campaign records reject unsafe stored URLs and require a parseable timestamp", () => {
  assert.match(app, /function safeCampaignUrl\(value\)/);
  assert.match(app, /parsed\.protocol === "https:" && parsed\.hostname && !parsed\.username && !parsed\.password/);
  assert.match(app, /link\.href = safeLink/);
  assert.match(app, /Number\.isFinite\(Date\.parse\(item\.createdAt\)\)/);
  assert.match(html, /not sales analytics/);
});

test("workspace backup and restore controls are present and validated", () => {
  assert.ok(html.includes('id="exportWorkspaceBackup"'));
  assert.ok(html.includes('id="importWorkspaceBackup"'));
  assert.ok(html.includes('id="backupMessage"'));
  assert.match(app, /format: "ai-commerce-hub-backup", version: 1/);
  assert.match(app, /function validateBackup\(payload\)/);
  assert.match(app, /MAX_BACKUP_BYTES = 2 \* 1024 \* 1024/);
  assert.match(app, /window\.confirm\("Restore this backup\?/);
  assert.match(app, /best-effort rollback/);
});


test("candidate stock checkbox wiring passes a boolean to the discovery engine", () => {
  const stockInput = html.match(/<input\\b(?=[^>]*\\bid="candidateStock")([^>]*)>/i);
  assert.ok(stockInput, "candidate stock input must exist");
  assert.match(stockInput[1], /\\btype="checkbox"/i);
  assert.match(app, /inStock:\\s*\\$\\("candidateStock"\\)\\.checked/);
});
