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
    { id: "contentrewards-official-discover", name: "Official Content Rewards Discover", type: "official-public-pages", mode: "automatic", verification: "official-public-page", platforms: ["Instagram", "Facebook", "YouTube", "X"], note: "Automatically reads public campaign links visible on official Discover, then fetches public detail pages. Private, join-only and hidden requirements are not crawled." },
    { id: "contentrewards-snapshot", name: "Third-party Content Rewards feed", type: "third-party-feed", mode: "fallback", verification: "third-party", platforms: ["Instagram", "Facebook", "YouTube", "X"], note: "Used only if the official public Discover page cannot be read; may be stale and is not official availability." }
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
    const knownRate = payoutRows.some((item) => Number.isFinite(item && item.ratePerKViews) ||
      Number.isFinite(item && item.flatAmount) || item && ["Pool", "Retainer"].includes(item.payoutModel));
    const noSeparateThresholdRequired = payoutRows.length > 0 && payoutRows.every((item) =>
      item && ["Pool", "Per post", "Retainer"].includes(item.payoutModel)
    );
    const knownMinimum = noSeparateThresholdRequired || payoutRows.some((item) => Number.isFinite(item && item.minViewsRequired) ||
      Number.isFinite(item && item.minPayout && item.minPayout.value));
    const poolAllocationKnown = payoutRows.some((item) => item && item.payoutModel === "Pool") &&
      Boolean(row.pool && row.pool.amount && row.pool.splitBy && row.pool.paidWhen);
    const knownCap = payoutRows.some((item) => Number.isFinite(item && item.maxPayoutPerSubmission)) || poolAllocationKnown;
    const hasDeadline = Boolean(row.deadline || row.endDate);
    const currentlyAccepting = row.campaignStatus === "Appears live in copied text";
    const hasSource = Boolean(row.source || row.sourceUrl || row.officialUrl);
    const age = Number.isFinite(row.ageDays) ? row.ageDays : null;
    const today = new Date(now == null ? Date.now() : now).toISOString().slice(0, 10);
    const expired = Boolean(row.deadline && /^\d{4}-\d{2}-\d{2}$/.test(row.deadline) && row.deadline < today);
    let score = 0;
    if (knownRate) score += 25;
    if (knownMinimum) score += 10;
    if (knownCap) score += 10;
    if (hasDeadline || currentlyAccepting) score += 10;
    if (hasSource) score += 10;
    if (row.title && row.title !== "Untitled campaign") score += 10;
    if (row.brand) score += 5;
    if (age != null && age <= 2) score += 20;
    else if (age != null && age <= 7) score += 12;
    else if (age == null) score += 3;
    if (age != null && age > 14) score -= 15;
    if (row.notSeenInLatestScan === true) score -= 15;
    if (expired) score -= 35;
    score = Math.max(0, Math.min(100, score));
    const missing = [];
    if (!knownRate) missing.push("Reward rate");
    if (!knownMinimum) missing.push("Minimum payout or view threshold");
    if (!knownCap) missing.push("Per-clip maximum or pool allocation rules");
    if (!hasDeadline && !currentlyAccepting) missing.push("Deadline or current accepting status");
    if (!hasSource) missing.push("Source link");
    if (age == null) missing.push("Snapshot date");
    if (row.notSeenInLatestScan === true) missing.push("Not present in the latest public feed scan");
    const status = expired ? "expired" : row.freshness === "stale" || (age != null && age > 7) ? "stale" : row.notSeenInLatestScan === true ? "not-seen-in-latest-scan" : "needs-verification";
    return {
      score, tier: score >= 75 ? "high" : score >= 50 ? "medium" : "low", status, expired, missing,
      confidence: missing.length <= 1 ? "strong field coverage" : missing.length <= 3 ? "partial field coverage" : "limited field coverage",
      explanation: expired ? "Deadline appears to have passed; verify the official page before spending time." :
        row.notSeenInLatestScan === true ? "This lead was not present in the latest public feed scan. It may have ended or been removed; verify its official status before prioritising." :
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
    row.verification = row.sourceVerification || (row.source === "Official API" ? "official-api" : "third-party");
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


  async function fetchBackendCampaignPage(options) {
    const opts = options || {};
    const baseUrl = normalizeBackendUrl(opts.backendUrl);
    const campaignUrl = canonicalPublicCampaignUrl(opts.url);
    if (!baseUrl) throw new Error("Enter a valid HTTPS backend origin before using live public-page analysis.");
    if (!campaignUrl) throw new Error("Only a public HTTPS Content Rewards campaign detail URL can be analysed.");
    const fetcher = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!fetcher) throw new Error("This browser does not support secure live campaign-page requests.");
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutMs = Number.isInteger(opts.timeoutMs) ? Math.max(1000, Math.min(30000, opts.timeoutMs)) : 15000;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetcher(baseUrl + "/api/discovery/analyze-public-campaign", {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ url: campaignUrl }),
        signal: controller ? controller.signal : undefined
      });
      let payload = null;
      try { payload = await response.json(); } catch (_) {}
      if (!response || !response.ok) {
        const message = payload && (payload.message || payload.error);
        throw new Error(clean(message || "Live public campaign scan returned an HTTP error.", 260));
      }
      const detail = payload && payload.detail;
      if (!payload || payload.sourceVerification !== "official-public-page" ||
          !detail || canonicalPublicCampaignUrl(detail.url) !== campaignUrl ||
          detail.status !== "ok" || typeof detail.pageText !== "string" ||
          detail.pageText.trim().length < 20 || detail.pageText.length > 20000) {
        throw new Error("The backend returned an invalid live public campaign analysis. No snapshot result was substituted.");
      }
      return detail;
    } catch (error) {
      if (error && error.name === "AbortError") throw new Error("Live public campaign analysis timed out. Check the backend and try again.");
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
      campaignDetails: Array.isArray(snapshot.campaignDetails) ? snapshot.campaignDetails.slice(0, 60) : [],
      scans: Array.isArray(snapshot.scans) ? snapshot.scans.slice(0, 50) : [],
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
    const timestamp = now == null ? Date.now() : now;
    const oldRows = Array.isArray(existing) ? existing : [];
    const oldMap = new Map(oldRows.map((row) => [row.discoveryKey || keyFor(row), row]));
    const current = deduplicate(incoming, timestamp);
    const seenKeys = new Set();
    let newCount = 0;
    current.forEach((row) => {
      const previous = oldMap.get(row.discoveryKey);
      if (!previous) {
        newCount += 1;
        row.firstSeenAt = row.lastSeenAt;
      } else {
        row.firstSeenAt = previous.firstSeenAt || previous.lastSeenAt || row.lastSeenAt;
        row.lastSeenAt = new Date(timestamp).toISOString();
      }
      row.notSeenInLatestScan = false;
      oldMap.set(row.discoveryKey, row);
      seenKeys.add(row.discoveryKey);
    });

    // Keep past discoveries for audit, but explicitly lower their priority when the
    // current upstream snapshot no longer returns them. Never imply they are active.
    for (const [key, previous] of oldMap.entries()) {
      if (seenKeys.has(key)) continue;
      const sourceTime = Date.parse(previous.snapshotDate || previous.updatedAt || previous.lastSeenAt || "");
      const unseenAge = Number.isFinite(sourceTime) ? Math.max(0, Math.floor((timestamp - sourceTime) / 86400000)) : previous.ageDays;
      const aged = Object.assign({}, previous, {
        ageDays: Number.isFinite(unseenAge) ? unseenAge : null,
        freshness: Number.isFinite(unseenAge) && unseenAge > 7 ? "stale" : previous.freshness || "unknown",
        notSeenInLatestScan: true
      });
      oldMap.set(key, enrich(aged, timestamp));
      oldMap.get(key).firstSeenAt = previous.firstSeenAt || previous.lastSeenAt || "";
      oldMap.get(key).lastSeenAt = previous.lastSeenAt || "";
    }
    return {
      // Current official Discover results always outrank historical leads. A
      // high evidence score must never let a campaign absent from the latest
      // source scan crowd active candidates out of the first screen.
      campaigns: [...oldMap.values()].sort((a, b) =>
        Number(a.notSeenInLatestScan === true) - Number(b.notSeenInLatestScan === true) ||
        b.opportunity.score - a.opportunity.score ||
        a.title.localeCompare(b.title)
      ).slice(0, 500),
      newCount,
      checkedCount: current.length
    };
  }
  function canonicalPublicCampaignUrl(value) {
    try {
      const url = new URL(String(value || ""));
      const host = url.hostname.toLowerCase();
      if (url.protocol !== "https:" || (host !== "contentrewards.com" && !host.endsWith(".contentrewards.com")) ||
          url.username || url.password || (url.port && url.port !== "443") ||
          !/^\/c\/campaigns\/[^/]+$/.test(url.pathname)) return "";
      return url.origin + url.pathname;
    } catch (_) {
      return "";
    }
  }

  function analyzePublicCampaigns(campaigns, details, scout, intelligence, platform, options) {
    const rows = Array.isArray(campaigns) ? campaigns : [];
    const pages = Array.isArray(details) ? details : [];
    const target = clean(platform, 30);
    const opts = options && typeof options === "object" ? options : {};
    if (!target) throw new Error("Choose a target platform before analysing saved campaigns.");
    if (!scout || typeof scout.parseCampaignBrief !== "function" ||
        !intelligence || typeof intelligence.assessAll !== "function") {
      throw new Error("The campaign parser or Rewards Intelligence engine is unavailable.");
    }
    const today = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.today || ""))
      ? String(opts.today)
      : new Date().toISOString().slice(0, 10);
    const detailMap = new Map();
    pages.forEach((page) => {
      const url = canonicalPublicCampaignUrl(page && page.url);
      if (url && !detailMap.has(url)) detailMap.set(url, page);
    });

    const analysed = [];
    let missingDetailCount = 0;
    let unreadableDetailCount = 0;
    let parserFailureCount = 0;
    rows.forEach((row) => {
      const url = canonicalPublicCampaignUrl(row && (row.officialUrl || row.sourceUrl));
      const detail = url ? detailMap.get(url) : null;
      if (!detail) {
        missingDetailCount += 1;
        return;
      }
      if (!["ok", "stale"].includes(detail.status) || typeof detail.pageText !== "string" || detail.pageText.trim().length < 20) {
        unreadableDetailCount += 1;
        return;
      }
      try {
        const brief = scout.parseCampaignBrief({
          url,
          requestedPlatform: target,
          text: detail.pageText
        });
        if (!brief.title && row.title) brief.title = clean(row.title, 180);
        brief.rawText = detail.pageText;
        const assessment = intelligence.assessAll({
          brief,
          platform: target,
          today,
          account: opts.account || null
        });
        const campaignAssessment = Object.assign({}, assessment.campaign);
        const notSeenInLatestScan = row.notSeenInLatestScan === true ||
          (row.opportunity && row.opportunity.status === "not-seen-in-latest-scan");
        if (campaignAssessment.state === "promising" && (detail.status === "stale" || notSeenInLatestScan)) {
          campaignAssessment.state = "verify";
          campaignAssessment.stateLabel = "More evidence required";
          campaignAssessment.reasons = [
            ...campaignAssessment.reasons,
            detail.status === "stale"
              ? "The saved campaign detail is stale; re-fetch the current public page before joining."
              : "This historical lead is absent from the latest official Discover listing. It may have ended, paused or become unlisted; verify its current status before applying."
          ];
          campaignAssessment.nextStep = "Re-check the current official campaign page and confirm it is still accepting creators before taking action.";
        }
        const coverage = Number.isFinite(brief.coverageScore) ? brief.coverageScore : 0;
        const discovery = row.opportunity && Number.isFinite(row.opportunity.score)
          ? row.opportunity.score
          : 0;
        analysed.push({
          id: clean(row.id || row.discoveryKey || url, 160),
          url,
          title: clean(brief.title || row.title || "Untitled campaign", 180),
          brand: clean(row.brand || "", 120),
          platform: target,
          state: campaignAssessment.state,
          stateLabel: campaignAssessment.stateLabel,
          coverageScore: coverage,
          discoveryScore: discovery,
          pageStatus: detail.status,
          notSeenInLatestScan,
          lastSeenAt: clean(row.lastSeenAt || "", 40),
          pageFetchedAt: clean(detail.fetchedAt || "", 40),
          rate: brief.rate,
          platformRates: brief.platformRates,
          minimumPayout: brief.minimumPayout,
          pool: brief.pool,
          budget: brief.budget,
          deadline: brief.deadline,
          entryMode: brief.entryMode,
          campaignStatus: brief.campaignStatus,
          missing: brief.missing.slice(0, 12),
          reasons: campaignAssessment.reasons.slice(0, 8),
          assessment: campaignAssessment,
          brief
        });
      } catch (_) {
        parserFailureCount += 1;
      }
    });

    const stateOrder = { promising: 0, verify: 1, blocked: 2 };
    analysed.sort((a, b) =>
      (stateOrder[a.state] ?? 3) - (stateOrder[b.state] ?? 3) ||
      b.coverageScore - a.coverageScore ||
      b.discoveryScore - a.discoveryScore ||
      a.title.localeCompare(b.title)
    );
    const summary = {
      totalCampaigns: rows.length,
      analysed: analysed.length,
      promising: analysed.filter((item) => item.state === "promising").length,
      verify: analysed.filter((item) => item.state === "verify").length,
      blocked: analysed.filter((item) => item.state === "blocked").length,
      missingDetailCount,
      unreadableDetailCount,
      parserFailureCount,
      notSeenInLatestScanCount: rows.filter((row) => row && (row.notSeenInLatestScan === true ||
        (row.opportunity && row.opportunity.status === "not-seen-in-latest-scan"))).length,
      staleDetailCount: pages.filter((page) => page && page.status === "stale").length,
      platform: target,
      checkedAt: new Date().toISOString()
    };
    return { summary, campaigns: analysed };
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
  return { STORAGE_KEY, SETTINGS_KEY, DEFAULT_INTERVAL_HOURS, SOURCES, keyFor, assessOpportunity, enrich, deduplicate, readState, writeState, readSettings, writeSettings, normalizeBackendUrl, fetchBackendSnapshot, fetchBackendCampaignPage, fetchStaticSnapshot, mergeHistory, canonicalPublicCampaignUrl, analyzePublicCampaigns, scan };
});
