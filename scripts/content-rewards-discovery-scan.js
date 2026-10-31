"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const Feed = require("../content-rewards-assistant/campaign-feed.js");
const Discovery = require("../content-rewards-assistant/discovery-engine.js");

const DEFAULT_FILE = path.join(__dirname, "..", "content-rewards-assistant", "discovery-snapshot.json");

async function readSnapshot(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.campaigns) || !Array.isArray(parsed.scans)) {
      throw new Error("Scheduled discovery snapshot has an invalid structure.");
    }
    return parsed;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { schemaVersion: 1, campaigns: [], scans: [], lastScan: null, generatedAt: "", totalReceived: 0 };
    }
    throw error;
  }
}

async function writeSnapshot(filePath, snapshot) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = filePath + "." + process.pid + "." + Date.now() + ".tmp";
  try {
    await fs.writeFile(temporary, JSON.stringify(snapshot, null, 2) + "\n", { encoding: "utf8", mode: 0o644, flag: "wx" });
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function runScheduledScan(options = {}) {
  const filePath = path.resolve(options.filePath || DEFAULT_FILE);
  const feed = options.feed || Feed;
  const now = typeof options.now === "function" ? options.now() : options.now == null ? Date.now() : options.now;
  const startedAt = new Date(now).toISOString();
  let previous;
  try {
    previous = await readSnapshot(filePath);
  } catch (error) {
    return { ok: false, error: "Existing discovery snapshot could not be read: " + error.message };
  }

  try {
    const result = await feed.fetchCampaigns({
      platform: "",
      search: "",
      fetchImpl: options.fetchImpl,
      now
    });
    const merged = Discovery.mergeHistory(previous.campaigns, result.campaigns, now);
    const record = {
      at: result.fetchedAt || startedAt,
      completedAt: new Date(now).toISOString(),
      status: "success",
      checkedCount: merged.checkedCount,
      newCount: merged.newCount,
      totalReceived: result.totalReceived,
      source: result.sourceLabel || "Third-party public snapshot",
      sourceUrl: result.sourceUrl || "",
      summary: {
        saved: merged.campaigns.length,
        high: merged.campaigns.filter((row) => row.opportunity && row.opportunity.tier === "high").length,
        medium: merged.campaigns.filter((row) => row.opportunity && row.opportunity.tier === "medium").length,
        low: merged.campaigns.filter((row) => row.opportunity && row.opportunity.tier === "low").length
      }
    };
    const snapshot = {
      schemaVersion: 1,
      generatedAt: record.completedAt,
      source: { id: "contentrewards-snapshot", verification: "third-party", url: result.sourceUrl || "", label: result.sourceLabel || "Third-party public snapshot" },
      totalReceived: result.totalReceived || merged.checkedCount,
      campaigns: merged.campaigns,
      lastScan: record,
      scans: [record, ...(previous.scans || [])].slice(0, 50)
    };
    await writeSnapshot(filePath, snapshot);
    return { ok: true, snapshot, filePath };
  } catch (error) {
    const message = error && error.message ? error.message : "Scheduled campaign scan failed.";
    const record = {
      at: startedAt,
      completedAt: new Date(now).toISOString(),
      status: "failed",
      checkedCount: 0,
      newCount: 0,
      source: "Content Rewards third-party public snapshot",
      error: message
    };
    const snapshot = {
      schemaVersion: 1,
      generatedAt: record.completedAt,
      source: previous.source || { id: "contentrewards-snapshot", verification: "third-party", url: "", label: "Third-party public snapshot" },
      totalReceived: previous.totalReceived || 0,
      campaigns: previous.campaigns || [],
      lastScan: record,
      scans: [record, ...(previous.scans || [])].slice(0, 50)
    };
    try {
      await writeSnapshot(filePath, snapshot);
    } catch (writeError) {
      return { ok: false, error: message + " Snapshot status could not be saved: " + writeError.message, filePath };
    }
    return { ok: false, error: message, snapshot, filePath };
  }
}

if (require.main === module) {
  runScheduledScan().then((result) => {
    if (!result.ok) {
      process.stderr.write("Scheduled discovery failed: " + result.error + "\n");
      process.exitCode = 1;
      return;
    }
    const scan = result.snapshot.lastScan;
    process.stdout.write("Scheduled discovery complete: " + scan.checkedCount + " checked, " + scan.newCount + " new, " + result.snapshot.campaigns.length + " saved.\n");
  }).catch((error) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  });
}

module.exports = { DEFAULT_FILE, readSnapshot, writeSnapshot, runScheduledScan };
