"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("content-rewards-assistant/app.js", "utf8");
const start = app.indexOf("async function analysePublicCampaignUrl()");
const end = app.indexOf("\n  function autofillCampaignTracker()", start);
const analyzer = app.slice(start, end);

test("on-demand URL analyzer distinguishes an exact URL fetch failure from a URL never scanned", () => {
  assert.ok(start >= 0 && end > start, "public URL analyzer must be present");
  assert.match(analyzer, /scanUrl === canonicalUrl/);
  assert.match(analyzer, /requestedCampaignPageStatus === "failed"/);
  assert.match(analyzer, /latest on-demand scan tried this exact URL/i);
  assert.match(analyzer, /matchingDetail && matchingDetail\.lastError/);
  assert.match(analyzer, /requestedCampaignPageStatus === "not-attempted"/);
});

test("on-demand URL analyzer reports failed and partial background scans with coverage", () => {
  assert.match(analyzer, /scan\.status === "failed"/);
  assert.match(analyzer, /scan\.error \|\| "No error detail was recorded\."/);
  assert.match(analyzer, /scan\.status === "partial"/);
  assert.match(analyzer, /detailPagesAvailable/);
  assert.match(analyzer, /detailPagesAttempted/);
});

test("on-demand diagnostics write untrusted scan errors as text, never HTML", () => {
  assert.match(analyzer, /scout-on-demand-help"\)\.textContent = helpText/);
  assert.doesNotMatch(analyzer, /scout-on-demand-help"\)\.innerHTML/);
});
