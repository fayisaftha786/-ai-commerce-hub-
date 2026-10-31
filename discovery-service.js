"use strict";

const Feed = require("./content-rewards-assistant/campaign-feed.js");
const Discovery = require("./content-rewards-assistant/discovery-engine.js");

function positiveInterval(value, fallback = 360) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 15 && parsed <= 1440 ? parsed : fallback;
}

function createDiscoveryService(options = {}) {
  const store = options.store;
  if (!store || typeof store.readState !== "function" || typeof store.writeState !== "function") {
    throw new TypeError("A persistent discovery store with readState/writeState is required.");
  }
  const feed = options.feed || Feed;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const enabled = options.enabled === true;
  const intervalMinutes = positiveInterval(options.intervalMinutes, 360);
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  let timer = null;
  let inFlight = null;
  let lastError = "";

  async function readState() {
    return store.readState();
  }

  async function runScan() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const startedAt = new Date(now()).toISOString();
      try {
        const previous = await store.readState();
        const result = await Discovery.scan({
          feed,
          platform: "",
          search: "",
          fetchImpl,
          now: now()
        });
        const merged = Discovery.mergeHistory(previous.campaigns, result.campaigns, now());
        const record = {
          at: result.fetchedAt || startedAt,
          completedAt: new Date(now()).toISOString(),
          status: "success",
          checkedCount: merged.checkedCount,
          newCount: merged.newCount,
          source: result.sourceLabel || "Third-party public snapshot",
          sourceUrl: result.sourceUrl || "",
          summary: result.summary
        };
        const state = {
          campaigns: merged.campaigns,
          scans: [record, ...(previous.scans || [])].slice(0, 50),
          updatedAt: record.completedAt
        };
        await store.writeState(state);
        lastError = "";
        return { ok: true, ...record, totalSaved: state.campaigns.length };
      } catch (error) {
        lastError = error && error.message ? error.message : "Discovery scan failed.";
        let previous = { campaigns: [], scans: [] };
        try { previous = await store.readState(); } catch (_) {}
        const record = {
          at: startedAt,
          completedAt: new Date(now()).toISOString(),
          status: "failed",
          checkedCount: 0,
          newCount: 0,
          source: "Content Rewards third-party public snapshot",
          error: lastError
        };
        try {
          await store.writeState({
            campaigns: previous.campaigns || [],
            scans: [record, ...(previous.scans || [])].slice(0, 50),
            updatedAt: record.completedAt
          });
        } catch (_) {}
        throw error;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  async function getStatus() {
    const state = await store.readState();
    const lastScan = (state.scans || [])[0] || null;
    return {
      enabled,
      scheduler: enabled ? "server-scheduled" : "disabled",
      intervalMinutes,
      running: Boolean(inFlight),
      lastScan,
      lastError: lastError || (lastScan && lastScan.status === "failed" ? lastScan.error : ""),
      sourceRegistry: Discovery.SOURCES,
      campaignCount: (state.campaigns || []).length,
      updatedAt: state.updatedAt || ""
    };
  }

  async function getCampaigns(options = {}) {
    const state = await store.readState();
    const platform = String(options.platform || "").trim().toLowerCase();
    const query = String(options.search || "").trim().slice(0, 100).toLowerCase();
    const limit = Math.max(1, Math.min(100, Number.parseInt(options.limit, 10) || 100));
    const campaigns = (state.campaigns || []).filter((campaign) => {
      const platforms = Array.isArray(campaign.platforms) ? campaign.platforms : [];
      const platformMatch = !platform || platforms.some((item) => String(item).toLowerCase() === platform);
      const text = [campaign.title, campaign.brand, campaign.description, campaign.requirementsText].join(" ").toLowerCase();
      return platformMatch && (!query || text.includes(query));
    }).slice().sort((a, b) => {
      const aScore = a.opportunity && Number(a.opportunity.score) || 0;
      const bScore = b.opportunity && Number(b.opportunity.score) || 0;
      return bScore - aScore;
    }).slice(0, limit);
    return { campaigns, count: campaigns.length, totalSaved: (state.campaigns || []).length, updatedAt: state.updatedAt || "" };
  }

  function start() {
    if (!enabled || timer) return false;
    // Run once at process start, then continue on the configured server-side interval.
    runScan().catch(() => {});
    timer = (options.setInterval || setInterval)(() => runScan().catch(() => {}), intervalMinutes * 60 * 1000);
    if (timer && typeof timer.unref === "function") timer.unref();
    return true;
  }

  function stop() {
    if (timer) (options.clearInterval || clearInterval)(timer);
    timer = null;
  }

  return {
    enabled, intervalMinutes, readState, getStatus, getCampaigns, runScan, start, stop,
    get running() { return Boolean(inFlight); }
  };
}

module.exports = { positiveInterval, createDiscoveryService };
