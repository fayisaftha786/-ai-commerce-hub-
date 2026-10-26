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


test("saved candidate shortlist uses readiness-first sorting", () => {
  assert.match(app, /compareCandidatesByReadiness/);
  assert.match(app, /\.sort\(typeof compareCandidates === "function" \? compareCandidates/);
});


test("saved candidate cards explain evidence coverage and handle older records", () => {
  assert.match(app, /Evidence coverage:/);
  assert.match(app, /candidate\.evidenceCoverage/);
  assert.match(app, /Evidence coverage unavailable for this older saved record/);
  assert.match(app, /card\.append\(title, details, evidence, remove\)/);
});


test("content pack download control exists and exports generated text safely", () => {
  assert.ok(html.includes('id="downloadContent"'));
  assert.match(app, /\$\("downloadContent"\)\.addEventListener\("click"/);
  assert.match(app, /new Blob\(\[output \+ "\\n"\], \{ type: "text\/plain;charset=utf-8" \}\)/);
  assert.match(app, /anchor\.download = "ai-commerce-" \+ safeName \+ "\.txt"/);
  assert.match(app, /replace\(\/\[\^a-zA-Z0-9_-\]\+\/g, "-"/);
  assert.match(app, /Create a post or video plan before downloading/);
});

test("saved campaigns expose a confirmed delete action and preserve records if storage save fails", () => {
  assert.match(app, /deleteButton\.textContent = "Delete campaign"/);
  assert.match(app, /window\.confirm\("Delete this campaign record\?/);
  assert.match(app, /campaigns\.splice\(index, 1\)/);
  assert.match(app, /if \(!saved\) \{\s*campaigns\.splice\(index, 0, campaign\)/);
  assert.match(app, /Campaign record deleted from this device/);
});

test("campaign register search filters by product, platform, format, and campaign ID", () => {
  assert.ok(html.includes('id="campaignSearch"'));
  assert.match(app, /\$\("campaignSearch"\)\.addEventListener\("input", renderCampaigns\)/);
  assert.match(app, /\[campaign\.productName, campaign\.platform, campaign\.format, campaign\.id\]/);
  assert.match(app, /No campaigns match this search/);
});

test("campaign register CSV import validates the exported schema and protects existing records", () => {
  assert.ok(html.includes('id="importCampaignsCsv"'));
  assert.ok(html.includes('id="importCampaigns"'));
  assert.match(app, /function parseCampaignCsv\(text\)/);
  assert.match(app, /CSV columns do not match the exported campaign register format/);
  assert.match(app, /file\.size > 1024 \* 1024/);
  assert.match(app, /const duplicates = parsed\.records\.length - unique\.length/);
  assert.match(app, /Existing records will be kept/);
  assert.match(app, /Import could not be saved to browser storage\. Existing records were preserved/);
  assert.match(app, /safeCampaignUrl\(link\.trim\(\)\)/);
});
