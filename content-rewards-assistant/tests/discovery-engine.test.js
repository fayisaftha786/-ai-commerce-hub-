"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Discovery = require("../discovery-engine.js");
function sample(id, overrides) {
  return Object.assign({ id, title: "Creator campaign " + id, brand: "Sample brand", payouts: [{ platform: "Instagram", ratePerKViews: 2.5, minViewsRequired: 1000, maxPayoutPerSubmission: 50 }], officialUrl: "https://contentrewards.com/c/discover", snapshotDate: "2026-10-30", ageDays: 1, freshness: "recent", source: "Third-party scraped snapshot" }, overrides || {});
}
test("scores field coverage and freshness without claiming eligibility", () => {
  const result = Discovery.assessOpportunity(sample("a"), Date.parse("2026-10-31T00:00:00Z"));
  assert.equal(result.tier, "high");
  assert.equal(result.expired, false);
  assert.match(result.explanation, /eligibility still need confirmation/i);
  const weak = Discovery.assessOpportunity(sample("b", { payouts: [], ageDays: 30, freshness: "stale", officialUrl: "" }), Date.now());
  assert.equal(weak.tier, "low");
  assert.ok(weak.missing.includes("Reward rate"));
});
test("marks expired deadlines as expired and low priority", () => {
  const result = Discovery.assessOpportunity(sample("old", { deadline: "2026-10-01" }), Date.parse("2026-10-31T00:00:00Z"));
  assert.equal(result.expired, true);
  assert.equal(result.status, "expired");
});
test("deduplicates repeated IDs and retains the best evidenced record", () => {
  const rows = Discovery.deduplicate([sample("same", { ageDays: 20, freshness: "stale", payouts: [] }), sample("same"), sample("other", { payouts: [] })], Date.parse("2026-10-31T00:00:00Z"));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "same");
  assert.equal(rows[0].opportunity.tier, "high");
});
test("uses a stable fallback identity when provider IDs are missing", () => {
  const a = sample("", { id: "", title: "A campaign", brand: "Brand", payouts: [{ platform: "YouTube" }] });
  const b = sample("", { id: "", title: "A campaign", brand: "Brand", payouts: [{ platform: "YouTube" }] });
  assert.equal(Discovery.keyFor(a), Discovery.keyFor(b));
  assert.equal(Discovery.deduplicate([a, b]).length, 1);
});
test("persists bounded history and validates scan settings", () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) };
  const state = { campaigns: Array.from({ length: 520 }, (_, i) => sample(String(i))), scans: Array.from({ length: 60 }, (_, i) => ({ id: i })) };
  assert.equal(Discovery.writeState(state, storage), true);
  const restored = Discovery.readState(storage);
  assert.equal(restored.campaigns.length, 500);
  assert.equal(restored.scans.length, 50);
  assert.equal(Discovery.writeSettings({ enabled: true, intervalHours: 2, notify: true }, storage), true);
  assert.equal(Discovery.readSettings(storage).intervalHours, 6);
  assert.equal(Discovery.readSettings(storage).notify, true);
});
test("merges history and counts only newly discovered campaigns", () => {
  const now = Date.parse("2026-10-31T00:00:00Z");
  const first = Discovery.mergeHistory([], [sample("one")], now);
  const second = Discovery.mergeHistory(first.campaigns, [sample("one"), sample("two")], now + 1000);
  assert.equal(first.newCount, 1);
  assert.equal(second.newCount, 1);
  assert.equal(second.checkedCount, 2);
  assert.equal(second.campaigns.length, 2);
});
test("scan delegates to feed and reports source provenance", async () => {
  let options;
  const result = await Discovery.scan({ feed: { fetchCampaigns: async (value) => { options = value; return { campaigns: [sample("scan")], totalReceived: 1, fetchedAt: "2026-10-31T00:00:00Z", sourceLabel: "third-party", sourceUrl: "https://example.test" }; } }, platform: "Instagram", search: "gaming", now: Date.parse("2026-10-31T00:00:00Z") });
  assert.equal(options.platform, "Instagram");
  assert.equal(options.search, "gaming");
  assert.equal(result.summary.found, 1);
  assert.equal(result.sources[0].verification, "third-party");
});
