"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Alerts = require("../discovery-alerts.js");

function campaign(id, overrides) {
  return Object.assign({
    id,
    discoveryKey: "id:" + id,
    title: "Campaign " + id,
    officialUrl: "https://contentrewards.com/c/campaigns/" + id,
    sourceVerification: "official-public-page",
    verification: "official-public-page",
    notSeenInLatestScan: false
  }, overrides || {});
}
function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    values
  };
}

test("first successful official snapshot seeds a quiet baseline without a notification flood", () => {
  const storage = memoryStorage();
  const observer = Alerts.createObserver({ storage });
  const result = observer.observe([campaign("one"), campaign("two")]);
  assert.equal(result.ok, true);
  assert.equal(result.baseline, true);
  assert.deepEqual(result.newCampaigns, []);
  assert.equal(JSON.parse(storage.values.get(Alerts.STORAGE_KEY)).seenKeys.length, 2);
});

test("only genuinely new official campaigns are returned once across repeated refreshes", () => {
  const storage = memoryStorage();
  const observer = Alerts.createObserver({ storage });
  observer.observe([campaign("one")]);
  const first = observer.observe([campaign("one"), campaign("two")]);
  assert.equal(first.baseline, false);
  assert.deepEqual(first.newCampaigns.map((row) => row.key), ["id:two"]);
  const repeated = observer.observe([campaign("one"), campaign("two")]);
  assert.deepEqual(repeated.newCampaigns, []);
});

test("removed and later reappearing campaigns are not misreported as newly discovered", () => {
  const observer = Alerts.createObserver({ storage: memoryStorage() });
  observer.observe([campaign("one"), campaign("two")]);
  assert.deepEqual(observer.observe([campaign("one")]).newCampaigns, []);
  assert.deepEqual(observer.observe([campaign("one"), campaign("two")]).newCampaigns, []);
});

test("ignores third-party, stale, historical, unsafe and non-campaign records", () => {
  const observer = Alerts.createObserver({ storage: memoryStorage() });
  observer.observe([campaign("baseline")]);
  const result = observer.observe([
    campaign("third", { sourceVerification: "third-party", verification: "third-party" }),
    campaign("stale", { notSeenInLatestScan: true }),
    campaign("bad-host", { officialUrl: "https://example.com/c/campaigns/bad" }),
    campaign("sign-in", { officialUrl: "https://user:pass@contentrewards.com/c/campaigns/bad" }),
    campaign("bad-path", { officialUrl: "https://contentrewards.com/c/discover" }),
    campaign("new")
  ]);
  assert.deepEqual(result.newCampaigns.map((row) => row.key), ["id:new"]);
});

test("observer persists across instances and bounds the saved seen-key history", () => {
  const storage = memoryStorage();
  Alerts.createObserver({ storage }).observe([campaign("one")]);
  const second = Alerts.createObserver({ storage });
  assert.deepEqual(second.observe([campaign("one")]).newCampaigns, []);
  const many = Array.from({ length: Alerts.MAX_SEEN_KEYS + 20 }, (_, index) => campaign("campaign-" + index));
  second.observe(many);
  const saved = JSON.parse(storage.values.get(Alerts.STORAGE_KEY));
  assert.equal(saved.seenKeys.length, Alerts.MAX_SEEN_KEYS);
});

test("does not emit a new-campaign event when alert history cannot be read or written", () => {
  const readFailure = Alerts.createObserver({ storage: { getItem() { throw new Error("blocked"); }, setItem() {} } });
  assert.equal(readFailure.observe([campaign("one")]).ok, false);
  const writeFailure = Alerts.createObserver({ storage: { getItem() { return null; }, setItem() { throw new Error("quota"); } } });
  assert.equal(writeFailure.observe([campaign("one")]).ok, false);
});

test("official URL validation accepts only public Content Rewards campaign detail paths", () => {
  assert.equal(Alerts.officialUrl("https://contentrewards.com/c/campaigns/abc-123"), "https://contentrewards.com/c/campaigns/abc-123");
  assert.equal(Alerts.officialUrl("http://contentrewards.com/c/campaigns/abc"), "");
  assert.equal(Alerts.officialUrl("https://contentrewards.com/c/discover"), "");
  assert.equal(Alerts.officialUrl("https://evilcontentrewards.com/c/campaigns/abc"), "");
});
