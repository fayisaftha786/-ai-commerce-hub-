"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const guide = require("../workflow-guide.js");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
const deploy = fs.readFileSync(path.join(root, ".github", "workflows", "deploy-pages.yml"), "utf8");
const serviceWorker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
const { collectLocalAssets } = require("../scripts/pages-build");

function storage(values) {
  return { getItem(key) { return Object.prototype.hasOwnProperty.call(values, key) ? JSON.stringify(values[key]) : null; } };
}

test("workflow guide counts saved workspace records without inventing missing data", () => {
  const summary = guide.summarizeWorkspace(storage({
    "ai-commerce-hub.products.v1": [{ name: "One" }, { name: "Two" }],
    "ai-commerce-hub.candidates.v1": [{ name: "Candidate", score: 40 }],
    "ai-commerce-hub.campaigns.v1": []
  }));
  assert.deepEqual(summary, { products: 2, candidates: 1, campaigns: 0 });
});

test("workflow guide safely handles malformed or non-array browser storage", () => {
  const broken = { getItem() { return "{not json"; } };
  assert.deepEqual(guide.summarizeWorkspace(broken), { products: 0, candidates: 0, campaigns: 0 });
  assert.deepEqual(guide.summarizeWorkspace({ getItem() { return JSON.stringify({ count: 99 }); } }), { products: 0, candidates: 0, campaigns: 0 });
});

test("next action advances from product discovery to scoring, content, then reporting", () => {
  assert.equal(guide.getNextStep({ products: 0, candidates: 0, campaigns: 0 }).target, "marketplaceSearchForm");
  assert.equal(guide.getNextStep({ products: 1, candidates: 0, campaigns: 0 }).target, "candidateForm");
  assert.equal(guide.getNextStep({ products: 1, candidates: 1, campaigns: 0 }).target, "contentForm");
  assert.equal(guide.getNextStep({ products: 1, candidates: 1, campaigns: 1 }).target, "campaignReportForm");
});

test("workflow guide is deployed and cached for offline use", () => {
  assert.match(html, /id="workflowGuide"/);
  assert.match(html, /id="workflowGuideSummary"/);
  assert.match(html, /id="workflowGuideSteps"/);
  assert.match(html, /<script src="workflow-guide\.js"><\/script>/);
  assert.ok(collectLocalAssets(html).includes("workflow-guide.js"));
  assert.match(serviceWorker, /"\.\/workflow-guide\.js"/);
  assert.match(serviceWorker, /ai-commerce-hub-pwa-v6/);
  assert.match(css, /\.workflow-guide-grid/);
});
