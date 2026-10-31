"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDiscoveryService, positiveInterval } = require("../discovery-service.js");

function makeStore(initial = { campaigns: [], scans: [], updatedAt: "" }) {
  let state = initial;
  return {
    async readState() { return JSON.parse(JSON.stringify(state)); },
    async writeState(next) { state = JSON.parse(JSON.stringify(next)); },
    snapshot() { return state; }
  };
}
function sample(id) {
  return {
    id, title: "Campaign " + id, brand: "Test brand",
    payouts: [{ platform: "Instagram", ratePerKViews: 2, minViewsRequired: 1000, maxPayoutPerSubmission: 30 }],
    officialUrl: "https://contentrewards.com/c/discover",
    ageDays: 1, freshness: "recent", source: "Third-party scraped snapshot"
  };
}

test("validates server scan intervals and rejects unsafe values", () => {
  assert.equal(positiveInterval("60"), 60);
  assert.equal(positiveInterval("2"), 360);
  assert.equal(positiveInterval("99999", 120), 120);
});

test("server scan persists deduplicated campaign history and scan evidence", async () => {
  const store = makeStore();
  const service = createDiscoveryService({
    store,
    now: () => Date.parse("2026-10-31T00:00:00Z"),
    feed: { fetchCampaigns: async () => ({
      campaigns: [sample("one"), sample("one"), sample("two")],
      totalReceived: 3, fetchedAt: "2026-10-31T00:00:00.000Z",
      sourceLabel: "Third-party snapshot", sourceUrl: "https://public-feed.example/api"
    }) }
  });
  const result = await service.runScan();
  assert.equal(result.ok, true);
  assert.equal(result.checkedCount, 2);
  assert.equal(result.newCount, 2);
  const saved = store.snapshot();
  assert.equal(saved.campaigns.length, 2);
  assert.equal(saved.scans.length, 1);
  assert.equal(saved.scans[0].status, "success");
  assert.equal((await service.getStatus()).scheduler, "disabled");
  assert.equal((await service.getCampaigns({ platform: "instagram" })).count, 2);
  assert.equal((await service.getCampaigns({ search: "two" })).count, 1);
});

test("concurrent manual and scheduled triggers share one in-flight scan", async () => {
  const store = makeStore();
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const service = createDiscoveryService({
    store,
    feed: { fetchCampaigns: async () => {
      calls += 1;
      await gate;
      return { campaigns: [sample("one")], totalReceived: 1, fetchedAt: new Date().toISOString(), sourceLabel: "feed", sourceUrl: "" };
    } }
  });
  const first = service.runScan();
  const second = service.runScan();
  assert.equal(service.running, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
});

test("failed source fetch is recorded and old campaign data is preserved", async () => {
  const store = makeStore({ campaigns: [sample("saved")], scans: [], updatedAt: "" });
  const service = createDiscoveryService({
    store,
    now: () => Date.parse("2026-10-31T00:00:00Z"),
    feed: { fetchCampaigns: async () => { throw new Error("feed offline"); } }
  });
  await assert.rejects(service.runScan(), /feed offline/);
  assert.equal(store.snapshot().campaigns.length, 1);
  assert.equal(store.snapshot().scans[0].status, "failed");
  assert.match((await service.getStatus()).lastError, /feed offline/);
});

test("scheduler runs an initial scan, creates a bounded interval and stops cleanly", async () => {
  const store = makeStore();
  let scheduled;
  let cleared = false;
  let calls = 0;
  const service = createDiscoveryService({
    store, enabled: true, intervalMinutes: 30,
    feed: { fetchCampaigns: async () => {
      calls += 1;
      return { campaigns: [], totalReceived: 0, fetchedAt: new Date().toISOString(), sourceLabel: "feed", sourceUrl: "" };
    } },
    setInterval: (callback, delay) => { scheduled = { callback, delay, unref() {} }; return scheduled; },
    clearInterval: (timer) => { if (timer === scheduled) cleared = true; }
  });
  assert.equal(service.start(), true);
  assert.equal(service.start(), false);
  assert.equal(scheduled.delay, 30 * 60 * 1000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  service.stop();
  assert.equal(cleared, true);
});
