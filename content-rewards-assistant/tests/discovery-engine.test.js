const fs = require("node:fs");
const path = require("node:path");
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Discovery = require("../discovery-engine.js");
function sample(id, overrides) {
  return Object.assign({ id, title: "Creator campaign " + id, brand: "Sample brand", payouts: [{ platform: "Instagram", ratePerKViews: 2.5, minViewsRequired: 1000, maxPayoutPerSubmission: 50 }], officialUrl: "https://contentrewards.com/c/discover", snapshotDate: "2026-10-30", ageDays: 1, freshness: "recent", source: "Third-party scraped snapshot" }, overrides || {});
}
test("labels latest-scan, historical, stale and unknown campaign records without claiming they are open", () => {
  assert.deepEqual(Discovery.listingStatus(sample("current", { notSeenInLatestScan: false })), {
    kind: "latest",
    label: "Seen in latest scan",
    detail: "Listing presence does not prove the campaign is still open or that your account is eligible."
  });
  assert.equal(Discovery.listingStatus(sample("history", { notSeenInLatestScan: true })).kind, "historical");
  assert.equal(Discovery.listingStatus(sample("history-status", { opportunity: { status: "not-seen-in-latest-scan" } })).kind, "historical");
  assert.equal(Discovery.listingStatus(sample("stale", { freshness: "stale" })).kind, "stale");
  for (const campaignStatus of ["Paused", "Ended / closed", "Out of budget"]) {
    const listing = Discovery.listingStatus(sample("closed-" + campaignStatus, {
      notSeenInLatestScan: false,
      campaignStatus
    }));
    assert.equal(listing.kind, "not-accepting", campaignStatus);
    assert.equal(listing.label, campaignStatus);
    assert.match(listing.detail, /do not treat it as an open opportunity/i);
  }
  assert.equal(Discovery.listingStatus(sample("expired", { opportunity: { expired: true } })).kind, "expired");
  assert.equal(Discovery.listingStatus(sample("unknown")).kind, "unknown");
});

test("scores field coverage and freshness without claiming eligibility", () => {
  const result = Discovery.assessOpportunity(sample("a"), Date.parse("2026-10-31T00:00:00Z"));
  assert.equal(result.tier, "high");
  assert.equal(result.expired, false);
  assert.match(result.explanation, /eligibility still need confirmation/i);
  const weak = Discovery.assessOpportunity(sample("b", { payouts: [], ageDays: 30, freshness: "stale", officialUrl: "" }), Date.now());
  assert.equal(weak.tier, "low");
  assert.ok(weak.missing.includes("Reward rate"));
});
test("caps information tier when creator requirements remain hidden until joining", () => {
  const locked = Discovery.assessOpportunity(sample("hidden-brief", {
    hiddenRequirements: { locked: true, count: 2, referenceFiles: 3 },
    campaignStatus: "Appears live in copied text"
  }), Date.parse("2026-11-04T00:00:00Z"));
  assert.equal(locked.score, 74);
  assert.equal(locked.tier, "medium");
  assert.equal(locked.confidence, "incomplete public brief");
  assert.ok(locked.missing.includes("Full creator requirements hidden until joining"));
  assert.match(locked.explanation, /capped at Medium information score/i);
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
  assert.match(app, /data-deep-draft/);
  assert.match(app, /Campaign title and platform prepared/);
  assert.match(app, /Add only a benefit you can verify/);
  assert.match(app, /Brief locked · join required/);
  assert.match(app, /No deadline found/);
  assert.match(app, /automatic import is blocked/);
  assert.match(worker, /clipreward-static-v42/);
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

test("deep scan exposes current campaigns with locked briefs and missing deadlines", () => {
  const Scout = require("../campaign-scout.js");
  const Rewards = require("../rewards-intelligence.js");
  const url = "https://contentrewards.com/c/campaigns/locked-brief-current";
  const pageText = [
    "Campaign: Clips Hablando de VALOR",
    "Accepting clips",
    "Launched 2 months ago",
    "Instagram YouTube",
    "Join Campaign",
    "Instagram",
    "Per 1K views",
    "$0.50",
    "Min payout",
    "$5.00",
    "Max payout",
    "$100.00",
    "Budget",
    "$2,123 / $5,000",
    "Join to see the brief"
  ].join("\n");
  const result = Discovery.analyzePublicCampaigns([{
    id: "locked-brief-current",
    title: "Clips Hablando de VALOR",
    officialUrl: url,
    notSeenInLatestScan: false,
    opportunity: { score: 90, status: "needs-verification" }
  }], [{
    url,
    status: "ok",
    fetchedAt: "2026-11-03T13:00:00.000Z",
    pageText
  }], Scout, Rewards, "Instagram", { today: "2026-11-03" });

  assert.equal(result.summary.analysed, 1);
  assert.equal(result.summary.lockedBriefCount, 1);
  assert.equal(result.summary.missingDeadlineCount, 1);
  assert.equal(result.summary.promising, 0);
  assert.equal(result.summary.verify, 1);
  assert.equal(result.campaigns[0].brief.hiddenRequirements.locked, true);
  assert.equal(result.campaigns[0].state, "verify");
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



test("deep analysis keeps latest-scan listings above higher-scoring historical rows", () => {
  const Scout = require("../campaign-scout.js");
  const Rewards = require("../rewards-intelligence.js");
  const currentUrl = "https://contentrewards.com/c/campaigns/current-lower-score";
  const historicalUrl = "https://contentrewards.com/c/campaigns/historical-higher-score";
  const pageText = (title) => [
    "Campaign: " + title, "Accepting clips", "Instagram", "Per 1K views",
    "$1.00", "Min payout", "$5.00", "Max payout", "$100.00",
    "Budget", "$200 / $500", "Join to see the brief"
  ].join("\n");
  const result = Discovery.analyzePublicCampaigns([
    { id: "current-lower-score", title: "Current listing", officialUrl: currentUrl,
      notSeenInLatestScan: false, opportunity: { score: 55, status: "needs-verification" } },
    { id: "historical-higher-score", title: "Historical listing", officialUrl: historicalUrl,
      notSeenInLatestScan: true, opportunity: { score: 99, status: "not-seen-in-latest-scan" } }
  ], [
    { url: currentUrl, status: "ok", fetchedAt: "2026-11-05T10:00:00.000Z", pageText: pageText("Current listing") },
    { url: historicalUrl, status: "ok", fetchedAt: "2026-10-30T10:00:00.000Z", pageText: pageText("Historical listing") }
  ], Scout, Rewards, "Instagram", { today: "2026-11-05" });

  assert.equal(result.campaigns.length, 2);
  assert.equal(result.campaigns[0].id, "current-lower-score");
  assert.equal(result.campaigns[0].notSeenInLatestScan, false);
  assert.equal(result.campaigns[1].id, "historical-higher-score");
  assert.equal(result.campaigns[1].notSeenInLatestScan, true);
});

test("radar headline count and quick list use only campaigns seen in the latest scan", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.match(html, /Seen in latest scan/);
  assert.match(app, /\$\("discovery-total"\)\.textContent = latestScanCount/);
  assert.match(app, /campaigns\.filter\(\(row\) => row\.notSeenInLatestScan === false/);
  assert.match(app, /Historical records remain in deep analysis/);
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

test("live public campaign analysis posts one canonical URL to the configured HTTPS backend without credentials", async () => {
  const calls = [];
  const detail = {
    url: "https://contentrewards.com/c/campaigns/live-123",
    finalUrl: "https://contentrewards.com/c/campaigns/live-123",
    status: "ok",
    fetchedAt: "2026-11-03T06:00:00.000Z",
    pageText: "Campaign: Live public campaign\nInstagram\nAccepting clips\n$2 per 1,000 views",
    htmlBytes: 420,
    detected: { platforms: ["Instagram"], missing: [] }
  };
  const result = await Discovery.fetchBackendCampaignPage({
    backendUrl: "https://api.example.com",
    url: "https://contentrewards.com/c/campaigns/live-123?utm_source=ignored",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, async json() { return { sourceVerification: "official-public-page", detail }; } };
    }
  });
  assert.deepEqual(result, detail);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example.com/api/discovery/analyze-public-campaign");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.mode, "cors");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].options.body), { url: detail.url });
});

test("live public campaign analysis rejects unsafe origins and non-Content-Rewards URLs before fetch", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error("must not fetch"); };
  await assert.rejects(Discovery.fetchBackendCampaignPage({
    backendUrl: "http://api.example.com", url: "https://contentrewards.com/c/campaigns/one", fetchImpl
  }), /valid HTTPS backend origin/i);
  await assert.rejects(Discovery.fetchBackendCampaignPage({
    backendUrl: "https://api.example.com", url: "https://evil.example/c/campaigns/one", fetchImpl
  }), /public HTTPS Content Rewards/i);
  assert.equal(calls, 0);
});

test("live public campaign analysis rejects mismatched, stale or malformed backend results", async () => {
  const validBase = {
    status: "ok", fetchedAt: "2026-11-03T06:00:00.000Z",
    pageText: "Campaign: Example public campaign\nYouTube\nAccepting clips"
  };
  const cases = [
    { sourceVerification: "third-party", detail: { ...validBase, url: "https://contentrewards.com/c/campaigns/one" } },
    { sourceVerification: "official-public-page", detail: { ...validBase, url: "https://contentrewards.com/c/campaigns/two" } },
    { sourceVerification: "official-public-page", detail: { ...validBase, url: "https://contentrewards.com/c/campaigns/one", status: "stale" } },
    { sourceVerification: "official-public-page", detail: { ...validBase, url: "https://contentrewards.com/c/campaigns/one", pageText: "short" } }
  ];
  for (const payload of cases) {
    await assert.rejects(Discovery.fetchBackendCampaignPage({
      backendUrl: "https://api.example.com", url: "https://contentrewards.com/c/campaigns/one",
      fetchImpl: async () => ({ ok: true, status: 200, async json() { return payload; } })
    }), /invalid live public campaign analysis/i);
  }
});

test("live public campaign analysis reports backend errors without hiding the response message", async () => {
  await assert.rejects(Discovery.fetchBackendCampaignPage({
    backendUrl: "https://api.example.com", url: "https://contentrewards.com/c/campaigns/one",
    fetchImpl: async () => ({
      ok: false, status: 429,
      async json() { return { error: "rate_limited", message: "Wait before scanning again." }; }
    })
  }), /Wait before scanning again/);
});

test("live site analysis is wired before the historical snapshot fallback when a backend is configured", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const liveCall = appSource.indexOf("fetchBackendCampaignPage");
  const snapshotCall = appSource.indexOf('fetchStaticSnapshot({ url: "./discovery-snapshot.json" })', liveCall);
  assert.ok(liveCall >= 0);
  assert.ok(snapshotCall > liveCall);
  assert.match(appSource, /analysisSource === "live-public-url"/);
  assert.match(appSource, /No saved or historical page was substituted/);
});

test("same-origin backend detection accepts only a healthy discovery API and never sends credentials", async () => {
  const calls = [];
  const origin = await Discovery.detectSameOriginBackend({
    origin: "https://clipreward.example.com/",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() { return { sourceRegistry: [{ id: "official-public-discover" }] }; }
      };
    }
  });
  assert.equal(origin, "https://clipreward.example.com");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://clipreward.example.com/api/discovery/status");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.cache, "no-store");
});

test("same-origin backend detection silently falls back for GitHub Pages, invalid origins and malformed responses", async () => {
  let calls = 0;
  const notBackend = await Discovery.detectSameOriginBackend({
    origin: "https://fayisaftha786.github.io",
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, async json() { return { message: "Not Found" }; } };
    }
  });
  assert.equal(notBackend, "");
  const wrongOrigin = await Discovery.detectSameOriginBackend({
    origin: "http://api.example.com",
    fetchImpl: async () => { calls += 1; return { ok: true, async json() { return { sourceRegistry: [] }; } }; }
  });
  assert.equal(wrongOrigin, "");
  const unavailable = await Discovery.detectSameOriginBackend({
    origin: "https://clipreward.example.com",
    fetchImpl: async () => { throw new Error("not deployed"); }
  });
  assert.equal(unavailable, "");
  assert.equal(calls, 1);
});

test("ClipReward attempts same-origin backend detection before falling back to the GitHub snapshot", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const configureAt = appSource.indexOf("function configureDiscovery()");
  const detectAt = appSource.indexOf("detectSameOriginBackend", configureAt);
  const snapshotAt = appSource.indexOf("syncScheduledSnapshot()", detectAt);
  assert.ok(configureAt >= 0 && detectAt > configureAt && snapshotAt > detectAt);
  assert.match(appSource, /Auto-detected the same-origin discovery backend/);
});

