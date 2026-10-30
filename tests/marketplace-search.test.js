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

test("one-tap category preset renders all three marketplace links and clears old scoring evidence", () => {
  const { init } = require("../marketplace-search.js");
  const elements = new Map();
  const makeNode = (id) => ({
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    children: [],
    dataset: {},
    listeners: {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = [...items]; },
    scrollIntoView() {},
    focus() {}
  });
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, makeNode(id));
    return elements.get(id);
  };
  const preset = makeNode("preset");
  preset.dataset.keyword = "kitchen organiser";
  const document = {
    getElementById: get,
    querySelectorAll(selector) { return selector === ".keyword-preset" ? [preset] : []; },
    createElement(tag) { return makeNode(tag); }
  };

  init({ document });
  preset.listeners.click();

  assert.equal(get("marketplaceSearchQuery").value, "kitchen organiser");
  assert.equal(get("marketplaceSearchResults").children.length, 4);
  const cards = get("marketplaceSearchResults").children.slice(1);
  assert.deepEqual(cards.map((card) => card.children[0].textContent), ["Amazon", "Flipkart", "Meesho"]);
  assert.match(cards[0].children[1].href, /amazon\.in\/s\?k=kitchen%20organiser/);
  assert.match(cards[1].children[1].href, /flipkart\.com\/search\?q=kitchen%20organiser/);
  assert.match(cards[2].children[1].href, /meesho\.com\/search\?q=kitchen%20organiser/);
  assert.match(get("marketplaceSearchStatus").textContent, /One-tap discovery ready/);

  get("candidatePrice").value = "999";
  get("candidateCommission").value = "12";
  cards[0].children[2].listeners.click();
  assert.equal(get("candidateName").value, "kitchen organiser");
  assert.equal(get("candidatePrice").value, "");
  assert.equal(get("candidateCommission").value, "");
  assert.match(get("marketplaceSearchStatus").textContent, /search links do not contain live listing data/);
});

test("manual keyword submission uses the same marketplace search flow", () => {
  const { init } = require("../marketplace-search.js");
  const elements = new Map();
  const makeNode = (id) => ({
    id, value: "", textContent: "", children: [], listeners: {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = [...items]; },
    scrollIntoView() {}, focus() {}
  });
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, makeNode(id));
    return elements.get(id);
  };
  const document = {
    getElementById: get,
    querySelectorAll() { return []; },
    createElement(tag) { return makeNode(tag); }
  };
  init({ document });
  get("marketplaceSearchQuery").value = "mobile stand";
  get("marketplaceSearchForm").listeners.submit({ preventDefault() {} });
  assert.equal(get("marketplaceSearchResults").children.length, 4);
  assert.match(get("marketplaceSearchStatus").textContent, /One-tap discovery ready/);
});

test("marketplace search cards can hand the keyword to scoring without carrying over old evidence", () => {
  const source = fs.readFileSync(path.join(root, "marketplace-search.js"), "utf8");
  assert.match(source, /scoreButton\.textContent = "Analyse a product from this search"/);
  assert.match(source, /candidateName: result\.query/);
  for (const id of ["candidatePrice", "candidateCommission", "candidateDemand", "candidateCompetition", "candidateUrl", "candidateSource", "candidateCheckedAt", "candidateStock"]) {
    assert.match(source, new RegExp(id + ': ""'));
  }
  assert.match(source, /search links do not contain live listing data/);
  assert.match(source, /form\.scrollIntoView/);
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


test("keyword presets are clearly framed as research prompts and wired to one-tap search", () => {
  const source = fs.readFileSync(path.join(root, "marketplace-search.js"), "utf8");
  assert.match(html, /data-keyword="kitchen organiser"/);
  assert.match(html, /not verified bestsellers/i);
  assert.ok(source.includes('querySelectorAll(".keyword-preset")'));
  assert.match(source, /input\.value = button\.dataset\.keyword/);
});
