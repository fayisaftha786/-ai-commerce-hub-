"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { runScheduledScan } = require("../scripts/content-rewards-discovery-scan.js");

function sample(id) {
  return {
    id, title: "Campaign " + id, brand: "Sample brand",
    payouts: [{ platform: "Instagram", ratePerKViews: 2.5, minViewsRequired: 1000, maxPayoutPerSubmission: 50 }],
    ageDays: 1, freshness: "recent", officialUrl: "https://contentrewards.com/c/discover",
    source: "Third-party scraped snapshot"
  };
}

test("scheduled scan writes a schema-versioned snapshot and deduplicates new campaign rows", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clipreward-cron-"));
  const filePath = path.join(directory, "snapshot.json");
  try {
    const result = await runScheduledScan({
      filePath,
      now: Date.parse("2026-10-31T00:00:00Z"),
      feed: { fetchCampaigns: async () => ({
        campaigns: [sample("one"), sample("one"), sample("two")],
        totalReceived: 3,
        fetchedAt: "2026-10-31T00:00:00.000Z",
        sourceLabel: "Third-party public snapshot",
        sourceUrl: "https://contentrewards.xyz/api/cr/campaigns"
      }) }
    });
    assert.equal(result.ok, true);
    assert.equal(result.snapshot.schemaVersion, 1);
    assert.equal(result.snapshot.campaigns.length, 2);
    assert.equal(result.snapshot.lastScan.status, "success");
    assert.equal(result.snapshot.lastScan.newCount, 2);
    assert.equal(JSON.parse(await fs.readFile(filePath, "utf8")).campaigns.length, 2);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("failed scheduled scan retains prior campaign results and publishes a failure record", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clipreward-cron-"));
  const filePath = path.join(directory, "snapshot.json");
  const previous = {
    schemaVersion: 1, generatedAt: "2026-10-30T00:00:00Z",
    source: { id: "contentrewards-snapshot", verification: "third-party", url: "", label: "Public snapshot" },
    totalReceived: 1, campaigns: [sample("kept")], scans: [], lastScan: { status: "success" }
  };
  try {
    await fs.writeFile(filePath, JSON.stringify(previous), "utf8");
    const result = await runScheduledScan({
      filePath,
      now: Date.parse("2026-10-31T00:00:00Z"),
      feed: { fetchCampaigns: async () => { throw new Error("upstream unavailable"); } }
    });
    assert.equal(result.ok, false);
    assert.equal(result.snapshot.campaigns[0].id, "kept");
    assert.equal(result.snapshot.lastScan.status, "failed");
    assert.match(result.snapshot.lastScan.error, /upstream unavailable/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("scheduled scan refuses to overwrite a malformed existing snapshot", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clipreward-cron-"));
  const filePath = path.join(directory, "snapshot.json");
  try {
    await fs.writeFile(filePath, "{bad", "utf8");
    const result = await runScheduledScan({ filePath, feed: { fetchCampaigns: async () => ({ campaigns: [] }) } });
    assert.equal(result.ok, false);
    assert.match(result.error, /could not be read/i);
    assert.equal(await fs.readFile(filePath, "utf8"), "{bad");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
