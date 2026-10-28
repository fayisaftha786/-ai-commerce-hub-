"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMarketplaceSearches } = require("../marketplace-search.js");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("builds fixed HTTPS search links for all supported marketplaces", () => {
  const result = buildMarketplaceSearches("kitchen organiser");
  assert.equal(result.valid, true);
  assert.deepEqual(result.searches.map((item) => item.platform), ["Amazon", "Flipkart", "Meesho"]);
  assert.ok(result.searches.every((item) => item.url.startsWith("https://")));
  assert.match(result.searches[0].url, /amazon\.in\/s\?k=kitchen%20organiser/);
});

test("rejects empty search and bounds the keyword length", () => {
  assert.equal(buildMarketplaceSearches(" ").valid, false);
  assert.equal(buildMarketplaceSearches("x".repeat(200)).query.length, 120);
});

test("marketplace search cards can hand the keyword to scoring without carrying over old evidence", () => {
  const source = fs.readFileSync(path.join(root, "marketplace-search.js"), "utf8");
  assert.match(source, /scoreButton\.textContent = "Analyse a product from this search"/);
  assert.match(source, /candidateName: result\.query/);
  for (const id of ["candidatePrice", "candidateCommission", "candidateDemand", "candidateCompetition", "candidateUrl", "candidateSource", "candidateCheckedAt", "candidateStock"]) {
    assert.match(source, new RegExp(id + ': ""'));
  }
  assert.match(source, /search links do not contain live listing data/);
  assert.match(source, /candidateForm\.scrollIntoView/);
});

test("search UI exists and module loads before app initialisation", () => {
  for (const id of ["marketplaceSearchForm", "marketplaceSearchQuery", "marketplaceSearchResults", "marketplaceSearchStatus"]) {
    assert.ok(html.includes('id="' + id + '"'), "missing " + id);
  }
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(scripts.indexOf("marketplace-search.js") >= 0);
  assert.ok(scripts.indexOf("marketplace-search.js") < scripts.indexOf("app.js"));
  assert.match(pkg.scripts.check, /node --check marketplace-search\.js/);
  assert.match(pkg.scripts.check, /node --check tests\/marketplace-search\.test\.js/);
});


test("keyword presets are clearly framed as research prompts and wired to the search input", () => {
  const source = fs.readFileSync(path.join(root, "marketplace-search.js"), "utf8");
  assert.match(html, /data-keyword="kitchen organiser"/);
  assert.match(html, /not verified bestsellers/i);
  assert.ok(source.includes('querySelectorAll(".keyword-preset")'));
  assert.match(source, /input\.value = button\.dataset\.keyword/);
  assert.match(source, /Quick search prepared/);\n  assert.match(source, /runSearch\\(input\\.value\\)/);
});
