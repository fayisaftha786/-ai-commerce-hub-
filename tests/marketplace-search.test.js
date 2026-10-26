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
