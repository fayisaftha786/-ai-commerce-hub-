const fs = require("node:fs");
const path = require("node:path");
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
  assert.equal(result.sources[0].verification, "official-public-page");
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
        campaignDetails: [{ url: "https://contentrewards.com/c/campaigns/static", status: "ok", pageText: "Campaign details" }],
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
  assert.equal(result.campaignDetails[0].pageText, "Campaign details");
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

test("scores current minimum-payout CPM and recognised pool campaigns without inventing per-creator rates", () => {
  const cpm = Discovery.assessOpportunity(sample("min-payout", {
    payouts: [{
      platform: "Instagram",
      ratePerKViews: 2,
      payoutModel: "CPM",
      minViewsRequired: null,
      minPayout: { value: 5, currency: "USD" },
      maxPayoutPerSubmission: 250
    }]
  }), Date.parse("2026-11-01T00:00:00Z"));
  assert.ok(!cpm.missing.includes("Minimum payout or view threshold"));

  const pool = Discovery.assessOpportunity(sample("pool", {
    payouts: [{ platform: "Instagram", payoutModel: "Pool", ratePerKViews: null, minViewsRequired: null, maxPayoutPerSubmission: null }],
    pool: { amount: { value: 25000, currency: "USD" }, splitBy: "Views", paidWhen: "When the pool ends" },
    campaignStatus: "Appears live in copied text"
  }), Date.parse("2026-11-01T00:00:00Z"));
  assert.ok(!pool.missing.includes("Payout model / rate"));
  assert.ok(!pool.missing.includes("Per-clip maximum or pool allocation rules"));
  assert.ok(!pool.missing.includes("Deadline or current accepting status"));
});
test("does not mark a shared Pool or flat-fee campaign as missing a CPM threshold", () => {
  const pool = Discovery.assessOpportunity(sample("pool-no-threshold", {
    payouts: [{ platform: "Instagram", payoutModel: "Pool", ratePerKViews: null }],
    pool: { amount: { value: 9000, currency: "USD" }, splitBy: "Views", paidWhen: "When the pool ends" },
    campaignStatus: "Appears live in copied text"
  }), Date.parse("2026-11-01T00:00:00Z"));
  assert.ok(!pool.missing.includes("Minimum payout or view threshold"));
  const perPost = Discovery.assessOpportunity(sample("flat-fee", {
    payouts: [{ platform: "YouTube", payoutModel: "Per post", flatAmount: 50 }]
  }), Date.parse("2026-11-01T00:00:00Z"));
  assert.ok(!perPost.missing.includes("Minimum payout or view threshold"));
});


test("batch analyser ranks every readable public campaign for the chosen platform", () => {
  const Scout = require("../campaign-scout.js");
  const Rewards = require("../rewards-intelligence.js");
  const pages = [
    {
      url: "https://contentrewards.com/c/campaigns/open-good",
      status: "ok",
      fetchedAt: "2026-11-01T00:00:00.000Z",
      pageText: [
        "Campaign: Open YouTube Clips",
        "Accepting clips",
        "Launched 1 day ago",
        "YouTube Instagram",
        "Join Campaign",
        "YouTube",
        "Per 1K views",
        "$3.00",
        "Min payout",
        "$5.00",
        "Max payout",
        "$250.00",
        "Budget",
        "$500 / $2,000"
      ].join("\n")
    },
    {
      url: "https://contentrewards.com/c/campaigns/closed-bad",
      status: "ok",
      fetchedAt: "2026-11-01T00:00:00.000Z",
      pageText: [
        "Campaign: Closed Instagram Project",
        "Ended",
        "Instagram",
        "Per 1K views",
        "$2",
        "Min payout",
        "$2",
        "Max payout",
        "$200",
        "Budget",
        "$0 / $200"
      ].join("\n")
    },
    {
      url: "https://contentrewards.com/c/campaigns/stale-open",
      status: "stale",
      fetchedAt: "2026-10-25T00:00:00.000Z",
      pageText: [
        "Campaign: Stale YouTube Project",
        "Accepting clips",
        "YouTube",
        "Per 1K views",
        "$3",
        "Min payout",
        "$5",
        "Max payout",
        "$250",
        "Budget",
        "$500 / $2,000"
      ].join("\n")
    }
  ];
  const campaigns = pages.map((page, index) => ({
    id: "campaign-" + index,
    title: "Snapshot title " + index,
    officialUrl: page.url,
    brand: "Brand " + index,
    opportunity: { score: 90 - index }
  }));
  const result = Discovery.analyzePublicCampaigns(campaigns, pages, Scout, Rewards, "YouTube", {
    today: "2026-11-01"
  });
  assert.equal(result.summary.totalCampaigns, 3);
  assert.equal(result.summary.analysed, 3);
  assert.equal(result.summary.promising + result.summary.verify + result.summary.blocked, 3);
  assert.equal(result.campaigns[0].title, "Open YouTube Clips");
  assert.equal(result.campaigns.find((row) => row.title === "Stale YouTube Project").state, "verify");
  assert.equal(result.campaigns.find((row) => row.title === "Closed Instagram Project").state, "blocked");
  assert.equal(result.campaigns[0].platform, "YouTube");
  assert.equal(result.campaigns[0].brief.minimumPayout.value, 5);
});

test("batch analyser skips hidden or missing detail pages and rejects invalid target platforms safely", () => {
  const Scout = require("../campaign-scout.js");
  const Rewards = require("../rewards-intelligence.js");
  const campaigns = [
    { id: "a", officialUrl: "https://contentrewards.com/c/campaigns/a" },
    { id: "b", officialUrl: "https://contentrewards.com/c/campaigns/b" },
    { id: "c", officialUrl: "https://evil.example/c/campaigns/c" }
  ];
  const result = Discovery.analyzePublicCampaigns(campaigns, [{
    url: campaigns[0].officialUrl,
    status: "unavailable",
    pageText: ""
  }], Scout, Rewards, "Instagram", { today: "2026-11-01" });
  assert.equal(result.summary.analysed, 0);
  assert.equal(result.summary.missingDetailCount, 2);
  assert.equal(result.summary.unreadableDetailCount, 1);
  assert.throws(() => Discovery.analyzePublicCampaigns(campaigns, [], Scout, Rewards, "", {}), /Choose a target platform/);
});

test("batch analyser rejects a detail page outside the canonical Content Rewards campaign URL boundary", () => {
  assert.equal(Discovery.canonicalPublicCampaignUrl("https://contentrewards.com.evil.test/c/campaigns/x"), "");
  assert.equal(Discovery.canonicalPublicCampaignUrl("http://contentrewards.com/c/campaigns/x"), "");
  assert.equal(Discovery.canonicalPublicCampaignUrl("https://contentrewards.com/c/settings"), "");
  assert.equal(Discovery.canonicalPublicCampaignUrl("https://contentrewards.com/c/campaigns/x?ref=public"), "https://contentrewards.com/c/campaigns/x");
});

test("ClipReward auto shortlist is wired into the radar and deep findings panel", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const worker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  for (const id of [
    "discovery-deep-status",
    "discovery-deep-summary",
    "discovery-deep-list"
  ]) assert.ok(html.includes('id="' + id + '"'), "missing batch analysis panel node " + id);
  assert.match(app, /analyzePublicCampaigns/);
  assert.match(app, /renderDeepCampaignAnalysis/);
  assert.match(app, /data-deep-open/);
  assert.match(worker, /clipreward-static-v30/);
  assert.match(worker, /discovery-engine\.js/);
});


test("historical leads absent from the latest official scan cannot remain Promising", () => {
  const Scout = require("../campaign-scout.js");
  const Rewards = require("../rewards-intelligence.js");
  const url = "https://contentrewards.com/c/campaigns/historical-only";
  const page = {
    url,
    status: "ok",
    fetchedAt: "2026-11-01T00:00:00.000Z",
    pageText: [
      "Campaign: Historical YouTube Clips",
      "Accepting clips",
      "YouTube",
      "Join Campaign",
      "Per 1K views",
      "$3.00",
      "Min payout",
      "$5.00",
      "Max payout",
      "$250.00",
      "Budget",
      "$500 / $2,000"
    ].join("\n")
  };
  const result = Discovery.analyzePublicCampaigns([{
    id: "historical-only",
    title: "Historical YouTube Clips",
    officialUrl: url,
    notSeenInLatestScan: true,
    lastSeenAt: "2026-10-31T00:00:00.000Z",
    opportunity: { score: 92, status: "not-seen-in-latest-scan" }
  }], [page], Scout, Rewards, "YouTube", { today: "2026-11-01" });
  assert.equal(result.summary.analysed, 1);
  assert.equal(result.summary.promising, 0);
  assert.equal(result.summary.verify, 1);
  assert.equal(result.summary.notSeenInLatestScanCount, 1);
  assert.equal(result.campaigns[0].state, "verify");
  assert.equal(result.campaigns[0].notSeenInLatestScan, true);
  assert.match(result.campaigns[0].reasons.join(" "), /absent from the latest official Discover listing/i);
});

test("current official leads rank ahead of higher-scoring historical leads", () => {
  const merged = Discovery.mergeHistory([
    sample("old-high", {
      opportunity: { score: 99, tier: "high", status: "needs-verification", expired: false, missing: [], confidence: "strong", explanation: "old" },
      lastSeenAt: "2026-10-30T00:00:00.000Z"
    })
  ], [
    sample("current-lower", {
      opportunity: { score: 58, tier: "medium", status: "needs-verification", expired: false, missing: [], confidence: "partial", explanation: "current" },
      lastSeenAt: "2026-11-01T00:00:00.000Z"
    })
  ], Date.parse("2026-11-01T00:00:00.000Z"));
  assert.equal(merged.campaigns[0].id, "current-lower");
  assert.equal(merged.campaigns[0].notSeenInLatestScan, false);
  assert.equal(merged.campaigns[1].id, "old-high");
  assert.equal(merged.campaigns[1].notSeenInLatestScan, true);
});

test("deep analysis keeps historical leads visible but counts them separately from current high-information leads", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(appSource, /row\.notSeenInLatestScan !== true && row\.opportunity/);
  assert.match(appSource, /Historical lead · absent from the latest official Discover scan/);
  assert.match(appSource, /notSeenInLatestScan/);
});


test("historical campaign count includes leads whose detail page is missing from the current snapshot", () => {
  const result = Discovery.analyzePublicCampaigns([
    { id: "current", title: "Current", officialUrl: "https://contentrewards.com/c/campaigns/current" },
    { id: "history-a", title: "History A", officialUrl: "https://contentrewards.com/c/campaigns/history-a", notSeenInLatestScan: true },
    { id: "history-b", title: "History B", officialUrl: "https://contentrewards.com/c/campaigns/history-b", opportunity: { status: "not-seen-in-latest-scan" } }
  ], [], require("../campaign-scout.js"), require("../rewards-intelligence.js"), "Instagram", { today: "2026-11-01" });
  assert.equal(result.summary.notSeenInLatestScanCount, 2);
  assert.equal(result.summary.missingDetailCount, 3);
  assert.equal(result.summary.analysed, 0);
});
