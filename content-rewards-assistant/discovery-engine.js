(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClipRewardDiscovery = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const STORAGE_KEY = "clipreward-discovery-v2";
  const SETTINGS_KEY = "clipreward-discovery-settings-v2";
  const DEFAULT_INTERVAL_HOURS = 6;
  const SOURCES = Object.freeze([
    { id: "contentrewards-snapshot", name: "Content Rewards public snapshot", type: "third-party-feed", mode: "automatic", verification: "third-party", platforms: ["Instagram", "Facebook", "YouTube", "X"], note: "Public third-party scraped snapshot; may be stale and is not official availability." },
    { id: "contentrewards-official", name: "Content Rewards official Discover", type: "official-marketplace", mode: "guided", verification: "official-page", platforms: ["Instagram", "Facebook", "YouTube", "X"], note: "Open the official page and verify live campaign status and eligibility. Private or joined-only data is not crawled." }
  ]);
  function clean(value, max) { return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max || 500); }
  function platformList(campaign) {
    return [...new Set((Array.isArray(campaign && campaign.payouts) ? campaign.payouts : []).map((item) => clean(item && item.platform, 30)).filter(Boolean))];
  }
  function keyFor(campaign) {
    const id = clean(campaign && campaign.id, 120).toLowerCase();
    if (id) return "id:" + id;
    const identity = [campaign && campaign.title, campaign && campaign.brand, ...platformList(campaign)].map((part) => clean(part, 100).toLowerCase()).filter(Boolean).join("|");
    return "fallback:" + identity;
  }
  function assessOpportunity(campaign, now) {
    const row = campaign && typeof campaign === "object" ? campaign : {};
    const payoutRows = Array.isArray(row.payouts) ? row.payouts : [];
    const knownRate = payoutRows.some((item) => Number.isFinite(item && item.ratePerKViews));
    const knownMinimum = payoutRows.some((item) => Number.isFinite(item && item.minViewsRequired));
    const knownCap = payoutRows.some((item) => Number.isFinite(item && item.maxPayoutPerSubmission));
    const hasDeadline = Boolean(row.deadline || row.endDate);
    const hasSource = Boolean(row.source || row.sourceUrl || row.officialUrl);
    const age = Number.isFinite(row.ageDays) ? row.ageDays : null;
    const today = new Date(now == null ? Date.now() : now).toISOString().slice(0, 10);
    const expired = Boolean(row.deadline && /^\d{4}-\d{2}-\d{2}$/.test(row.deadline) && row.deadline < today);
    let score = 0;
    if (knownRate) score += 25;
    if (knownMinimum) score += 10;
    if (knownCap) score += 10;
    if (hasDeadline) score += 10;
    if (hasSource) score += 10;
    if (row.title && row.title !== "Untitled campaign") score += 10;
    if (row.brand) score += 5;
    if (age != null && age <= 2) score += 20;
    else if (age != null && age <= 7) score += 12;
    else if (age == null) score += 3;
    if (age != null && age > 14) score -= 15;
    if (expired) score -= 35;
    score = Math.max(0, Math.min(100, score));
    const missing = [];
    if (!knownRate) missing.push("Reward rate");
    if (!knownMinimum) missing.push("Minimum views");
    if (!knownCap) missing.push("Maximum payout");
    if (!hasDeadline) missing.push("Deadline");
    if (!hasSource) missing.push("Source link");
    if (age == null) missing.push("Snapshot date");
    const status = expired ? "expired" : row.freshness === "stale" || (age != null && age > 7) ? "stale" : "needs-verification";
    return {
      score, tier: score >= 75 ? "high" : score >= 50 ? "medium" : "low", status, expired, missing,
      confidence: missing.length <= 1 ? "strong field coverage" : missing.length <= 3 ? "partial field coverage" : "limited field coverage",
      explanation: expired ? "Deadline appears to have passed; verify the official page before spending time." :
        score >= 75 ? "Good information coverage and/or fresh snapshot. Official availability and eligibility still need confirmation." :
          score >= 50 ? "Some useful reward information is available, but important details remain unknown." :
            "Insufficient or stale information. Verify the source and fill missing details before prioritising."
    };
  }
  function enrich(campaign, now) {
    const row = Object.assign({}, campaign || {});
    row.discoveryKey = keyFor(row);
    row.platforms = platformList(row);
    row.opportunity = assessOpportunity(row, now);
    row.verification = row.source === "Official API" ? "official-api" : "third-party";
    row.lastSeenAt = row.lastSeenAt || new Date(now == null ? Date.now() : now).toISOString();
    return row;
  }
  function deduplicate(campaigns, now) {
    const map = new Map();
    (Array.isArray(campaigns) ? campaigns : []).forEach((campaign) => {
      if (!campaign || !clean(campaign.title, 160)) return;
      const row = enrich(campaign, now);
      const prior = map.get(row.discoveryKey);
      if (!prior) map.set(row.discoveryKey, row);
      else {
        if (row.opportunity.score > prior.opportunity.score) map.set(row.discoveryKey, Object.assign({}, prior, row, { firstSeenAt: prior.firstSeenAt || prior.lastSeenAt, lastSeenAt: row.lastSeenAt }));
        else prior.lastSeenAt = row.lastSeenAt;
      }
    });
    return [...map.values()].sort((a, b) => b.opportunity.score - a.opportunity.score || a.title.localeCompare(b.title));
  }
  function readState(storage) {
    const target = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!target) return { campaigns: [], scans: [], updatedAt: "" };
    try {
      const parsed = JSON.parse(target.getItem(STORAGE_KEY) || "{}");
      return { campaigns: Array.isArray(parsed.campaigns) ? parsed.campaigns.slice(0, 500) : [], scans: Array.isArray(parsed.scans) ? parsed.scans.slice(0, 50) : [], updatedAt: clean(parsed.updatedAt, 40) };
    } catch (_) { return { campaigns: [], scans: [], updatedAt: "" }; }
  }
  function writeState(state, storage) {
    const target = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!target) return false;
    try {
      target.setItem(STORAGE_KEY, JSON.stringify({ campaigns: (state.campaigns || []).slice(0, 500), scans: (state.scans || []).slice(0, 50), updatedAt: new Date().toISOString() }));
      return true;
    } catch (_) { return false; }
  }
  function normalizeBackendUrl(value) {
    const raw = clean(value, 500);
    if (!raw) return "";
    try {
      const url = new URL(raw);
      const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
      if ((url.protocol !== "https:" && !localHttp) || !url.hostname || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return "";
      return url.origin;
    } catch (_) { return ""; }
  }

  async function fetchBackendSnapshot(options) {
    const opts = options || {};
    const baseUrl = normalizeBackendUrl(opts.backendUrl);
    if (!baseUrl) throw new Error("Enter a valid HTTPS backend origin (localhost is allowed for development).");
    const fetcher = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!fetcher) throw new Error("This browser does not support secure backend requests.");
    const params = new URLSearchParams();
    if (opts.platform) params.set("platform", clean(opts.platform, 30));
    if (opts.search) params.set("search", clean(opts.search, 100));
    params.set("limit", "100");
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 12000) : null;
    try {
      const request = { method: "GET", mode: "cors", credentials: "omit", headers: { Accept: "application/json" }, signal: controller ? controller.signal : undefined };
      const responses = await Promise.all([
        fetcher(baseUrl + "/api/discovery/status", request),
        fetcher(baseUrl + "/api/discovery/campaigns?" + params.toString(), request)
      ]);
      if (responses.some((response) => !response || !response.ok)) throw new Error("Discovery backend returned an HTTP error.");
      const [status, data] = await Promise.all(responses.map((response) => response.json()));
      if (!status || !Array.isArray(status.sourceRegistry) || !data || !Array.isArray(data.campaigns)) throw new Error("Discovery backend returned an unrecognised response.");
      return { status, campaigns: deduplicate(data.campaigns), totalReceived: data.totalSaved || data.count, fetchedAt: data.updatedAt || status.updatedAt || "", sourceLabel: "Server-side scheduled discovery", sourceUrl: baseUrl };
    } catch (error) {
      if (error && error.name === "AbortError") throw new Error("Discovery backend request timed out.");
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function fetchStaticSnapshot(options) {
    const opts = options || {};
    const fetcher = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!fetcher) throw new Error("This browser does not support loading the scheduled discovery snapshot.");
    const url = opts.url || "./discovery-snapshot.json";
    const response = await fetcher(url, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" }
    });
    if (!response || !response.ok) throw new Error("Scheduled discovery snapshot is not available yet.");
    const snapshot = await response.json();
    if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.campaigns) || !Array.isArray(snapshot.scans)) {
      throw new Error("Scheduled discovery snapshot has an unrecognised format.");
    }
    const rows = deduplicate(snapshot.campaigns);
    const lastScan = snapshot.lastScan || null;
    return {
      status: {
        enabled: Boolean(lastScan),
        scheduler: "github-actions-scheduled",
        intervalMinutes: 360,
        running: false,
        lastScan,
        lastError: lastScan && lastScan.status === "failed" ? lastScan.error || "The latest scheduled scan failed." : "",
        sourceRegistry: SOURCES,
        campaignCount: rows.length,
        updatedAt: snapshot.generatedAt || ""
      },
      campaigns: rows,
      totalReceived: snapshot.totalReceived || rows.length,
      fetchedAt: snapshot.generatedAt || "",
      sourceLabel: snapshot.source && snapshot.source.label || "Third-party scheduled snapshot",
      sourceUrl: snapshot.source && snapshot.source.url || ""
    };
  }

  function readSettings(storage) {
    const target = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    const defaults = { enabled: true, intervalHours: DEFAULT_INTERVAL_HOURS, notify: false, backendUrl: "" };
    if (!target) return defaults;
    try {
      const value = JSON.parse(target.getItem(SETTINGS_KEY) || "{}");
      const interval = Number(value.intervalHours);
      return { enabled: value.enabled !== false, intervalHours: [1, 3, 6, 12, 24].includes(interval) ? interval : DEFAULT_INTERVAL_HOURS, notify: value.notify === true, backendUrl: normalizeBackendUrl(value.backendUrl) };
    } catch (_) { return defaults; }
  }
  function writeSettings(settings, storage) {
    const target = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!target) return false;
    try {
      const interval = Number(settings && settings.intervalHours);
      target.setItem(SETTINGS_KEY, JSON.stringify({ enabled: settings && settings.enabled !== false, intervalHours: [1, 3, 6, 12, 24].includes(interval) ? interval : DEFAULT_INTERVAL_HOURS, notify: Boolean(settings && settings.notify), backendUrl: normalizeBackendUrl(settings && settings.backendUrl) }));
      return true;
    } catch (_) { return false; }
  }
  function mergeHistory(existing, incoming, now) {
    const oldRows = Array.isArray(existing) ? existing : [];
    const oldMap = new Map(oldRows.map((row) => [row.discoveryKey || keyFor(row), row]));
    const current = deduplicate(incoming, now);
    let newCount = 0;
    current.forEach((row) => {
      const previous = oldMap.get(row.discoveryKey);
      if (!previous) { newCount += 1; row.firstSeenAt = row.lastSeenAt; }
      else { row.firstSeenAt = previous.firstSeenAt || previous.lastSeenAt || row.lastSeenAt; row.lastSeenAt = new Date(now == null ? Date.now() : now).toISOString(); }
      oldMap.set(row.discoveryKey, row);
    });
    return { campaigns: [...oldMap.values()].sort((a, b) => b.opportunity.score - a.opportunity.score).slice(0, 500), newCount, checkedCount: current.length };
  }
  async function scan(options) {
    const opts = options || {};
    if (!opts.feed || typeof opts.feed.fetchCampaigns !== "function") throw new Error("The public campaign feed connector is not available.");
    const result = await opts.feed.fetchCampaigns({ platform: opts.platform || "", search: opts.search || "", fetchImpl: opts.fetchImpl, now: opts.now });
    const campaigns = deduplicate(result.campaigns, opts.now);
    return {
      campaigns, totalReceived: result.totalReceived, fetchedAt: result.fetchedAt, sourceLabel: result.sourceLabel, sourceUrl: result.sourceUrl, sources: SOURCES,
      summary: {
        found: campaigns.length,
        high: campaigns.filter((row) => row.opportunity.tier === "high").length,
        medium: campaigns.filter((row) => row.opportunity.tier === "medium").length,
        low: campaigns.filter((row) => row.opportunity.tier === "low").length,
        stale: campaigns.filter((row) => row.opportunity.status === "stale").length,
        expired: campaigns.filter((row) => row.opportunity.expired).length
      }
    };
  }
  return { STORAGE_KEY, SETTINGS_KEY, DEFAULT_INTERVAL_HOURS, SOURCES, keyFor, assessOpportunity, enrich, deduplicate, readState, writeState, readSettings, writeSettings, normalizeBackendUrl, fetchBackendSnapshot, fetchStaticSnapshot, mergeHistory, scan };
});
