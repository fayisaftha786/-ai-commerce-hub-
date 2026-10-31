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
  assert.equal(Discovery.readSettings(storage).backendUrl, "");
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

test("normalizes backend origins and rejects credentials, cleartext remote URLs and URL paths", () => {
  assert.equal(Discovery.normalizeBackendUrl("https://api.example.com/"), "https://api.example.com");
  assert.equal(Discovery.normalizeBackendUrl("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  assert.equal(Discovery.normalizeBackendUrl("http://api.example.com"), "");
  assert.equal(Discovery.normalizeBackendUrl("https://user:pass@example.com"), "");
  assert.equal(Discovery.normalizeBackendUrl("https://api.example.com/v1"), "");
});

test("backend URL preference is stored without API credentials", () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) };
  assert.equal(Discovery.writeSettings({ enabled: true, backendUrl: "https://api.example.com" }, storage), true);
  assert.equal(Discovery.readSettings(storage).backendUrl, "https://api.example.com");
  assert.equal(memory.get(Discovery.SETTINGS_KEY).includes("token"), false);
});

test("fetches only read-only discovery endpoints using credential-free CORS requests", async () => {
  const calls = [];
  const json = (value) => ({ ok: true, json: async () => value });
  const result = await Discovery.fetchBackendSnapshot({
    backendUrl: "https://api.example.com",
    platform: "Instagram",
    search: "gaming",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return url.endsWith("/api/discovery/status")
        ? json({ enabled: true, scheduler: "server-scheduled", intervalMinutes: 360, sourceRegistry: [] })
        : json({ campaigns: [sample("one")], count: 1, totalSaved: 1, updatedAt: "2026-10-31T00:00:00Z" });
    }
  });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.options.method === "GET" && call.options.credentials === "omit" && call.options.mode === "cors"));
  assert.match(calls[1].url, /platform=Instagram/);
  assert.match(calls[1].url, /search=gaming/);
  assert.equal(result.campaigns.length, 1);
  assert.equal(result.status.scheduler, "server-scheduled");
});

test("backend client rejects malformed payloads and remote cleartext URLs", async () => {
  await assert.rejects(Discovery.fetchBackendSnapshot({ backendUrl: "http://public.example" }), /valid HTTPS backend origin/);
  await assert.rejects(Discovery.fetchBackendSnapshot({
    backendUrl: "https://api.example.com",
    fetchImpl: async () => ({ ok: true, json: async () => ({}) })
  }), /unrecognised response/);
});

test("loads the public GitHub Actions snapshot without credentials and keeps source provenance", async () => {
  let request;
  const result = await Discovery.fetchStaticSnapshot({
    url: "./discovery-snapshot.json",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({
        schemaVersion: 1,
        generatedAt: "2026-10-31T00:00:00Z",
        source: { label: "Third-party snapshot", url: "https://contentrewards.xyz/api/cr/campaigns" },
        totalReceived: 1,
        campaigns: [sample("static")],
        lastScan: { status: "success", at: "2026-10-31T00:00:00Z", newCount: 1 },
        scans: [{ status: "success" }]
      }) };
    }
  });
  assert.equal(request.url, "./discovery-snapshot.json");
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.cache, "no-store");
  assert.equal(request.options.credentials, "omit");
  assert.equal(result.status.scheduler, "github-actions-scheduled");
  assert.equal(result.campaigns[0].id, "static");
  assert.equal(result.sourceLabel, "Third-party snapshot");
});

test("rejects missing or malformed scheduled snapshot data", async () => {
  await assert.rejects(Discovery.fetchStaticSnapshot({
    fetchImpl: async () => ({ ok: false, status: 404 })
  }), /not available yet/);
  await assert.rejects(Discovery.fetchStaticSnapshot({
    fetchImpl: async () => ({ ok: true, json: async () => ({ campaigns: [] }) })
  }), /unrecognised format/);
});

test("marks saved campaigns absent from the latest scan as unverified instead of active", () => {
  const oldTime = Date.parse("2026-10-01T00:00:00Z");
  const first = Discovery.mergeHistory([], [sample("seen", {
    snapshotDate: "2026-10-01", ageDays: 0, freshness: "recent"
  })], oldTime);
  const next = Discovery.mergeHistory(first.campaigns, [], Date.parse("2026-10-31T00:00:00Z"));
  const row = next.campaigns[0];
  assert.equal(row.notSeenInLatestScan, true);
  assert.equal(row.opportunity.status, "stale");
  assert.ok(row.opportunity.missing.includes("Not present in the latest public feed scan"));
  assert.match(row.opportunity.explanation, /not present in the latest public feed scan/i);
});
