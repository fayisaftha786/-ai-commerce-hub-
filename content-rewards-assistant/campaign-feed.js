(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClipRewardFeed = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const API_URL = "https://contentrewards.xyz/api/cr/campaigns";
  const OFFICIAL_DISCOVER = "https://contentrewards.com/c/discover";
  const INDIA_PLATFORMS = ["Instagram", "Facebook", "YouTube", "X"];

  function text(value, max) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max || 500);
  }

  function number(value) {
    if (value == null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function normalizePlatform(value) {
    const raw = text(value, 40).toLowerCase();
    const map = { instagram: "Instagram", ig: "Instagram", facebook: "Facebook", fb: "Facebook",
      youtube: "YouTube", yt: "YouTube", x: "X", twitter: "X", tiktok: "TikTok" };
    return map[raw] || "";
  }

  function safeOfficialUrl(value) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol !== "https:" || (url.hostname !== "contentrewards.com" && !url.hostname.endsWith(".contentrewards.com"))) return "";
      return url.href;
    } catch (_) { return ""; }
  }

  function canonicalCampaignUrl(value) {
    const safe = safeOfficialUrl(value);
    if (!safe) return "";
    try {
      const url = new URL(safe);
      if (!/^\\/c\\//i.test(url.pathname) || /^\\/c\\/discover(?:\\/|$)/i.test(url.pathname)) return "";
      if (url.pathname.split("/").filter(Boolean).length < 2) return "";
      url.search = "";
      url.hash = "";
      url.pathname = url.pathname.replace(/\\/+$/, "");
      return url.href;
    } catch (_) {
      return "";
    }
  }

  function normalizeCampaign(item, now) {
    if (!item || typeof item !== "object") return null;
    const payouts = (Array.isArray(item.payouts) ? item.payouts : []).map((entry) => ({
      platform: normalizePlatform(entry && entry.platform),
      ratePerKViews: number(entry && entry.ratePerKViews),
      minViewsRequired: number(entry && entry.minViewsRequired),
      maxPayoutPerSubmission: number(entry && entry.maxPayoutPerSubmission),
      payoutModel: text(entry && (entry.model || entry.payoutModel), 40)
    })).filter((entry) => entry.platform);
    const snapshot = item.latest_snapshot && typeof item.latest_snapshot === "object" ? item.latest_snapshot : {};
    const snapshotDate = text(snapshot.snapshotDate || item.snapshotDate || item.updatedAt, 30);
    const parsedDate = snapshotDate ? Date.parse(snapshotDate + (snapshotDate.length === 10 ? "T00:00:00Z" : "")) : NaN;
    const ageDays = Number.isFinite(parsedDate) ? Math.max(0, Math.floor((now - parsedDate) / 86400000)) : null;
    const budget = number(snapshot.budgetUsd != null ? snapshot.budgetUsd : item.budgetUsd);
    const spent = number(snapshot.budgetSpentUsd != null ? snapshot.budgetSpentUsd : item.budgetSpentUsd);
    const remaining = budget != null && spent != null && budget >= spent ? budget - spent : null;
    return {
      id: text(item.externalId || item.id, 120),
      title: text(item.title || item.name, 160) || "Untitled campaign",
      brand: text(item.brand || item.organization || item.company, 100),
      type: text(item.type || item.campaignType, 40),
      description: text(item.description, 1200),
      requirementsText: text(item.requirements_text || item.requirementsText, 6000),
      payouts,
      budgetUsd: budget,
      spentUsd: spent,
      remainingUsd: remaining,
      snapshotDate,
      ageDays,
      freshness: ageDays == null ? "unknown" : ageDays > 7 ? "stale" : "recent",
      officialUrl: safeOfficialUrl(item.url || item.campaignUrl || item.publicUrl),
      source: "Third-party scraped snapshot"
    };
  }

  function normalizeResponse(payload, now) {
    if (!payload || payload.success === false) throw new Error("The campaign data source did not return a successful response.");
    const rows = Array.isArray(payload) ? payload : payload.data;
    if (!Array.isArray(rows)) throw new Error("The campaign data response format was not recognised.");
    return rows.map((row) => normalizeCampaign(row, now)).filter((row) => row && row.id);
  }

  function filterCampaigns(rows, options) {
    const platform = normalizePlatform(options && options.platform);
    const query = text(options && options.search, 100).toLowerCase();
    return rows.filter((row) => {
      if (platform && !row.payouts.some((payout) => payout.platform === platform)) return false;
      if (query && !(row.title + " " + row.brand + " " + row.description + " " + row.requirementsText).toLowerCase().includes(query)) return false;
      return true;
    }).filter((row) => !row.payouts.every((payout) => payout.platform === "TikTok"))
      .sort((a, b) => {
        const rate = (row) => Math.max(0, ...row.payouts.filter((p) => !platform || p.platform === platform).map((p) => p.ratePerKViews || 0));
        return rate(b) - rate(a);
      });
  }

  function campaignToBrief(campaign, platform) {
    const selected = campaign.payouts.find((payout) => payout.platform === normalizePlatform(platform));
    const lines = [
      "Campaign: " + campaign.title,
      campaign.brand ? "Brand: " + campaign.brand : "",
      "Campaign type: " + (campaign.type || "Not stated in third-party record"),
      "Platform: " + (selected ? selected.platform : "Not verified"),
      selected && selected.ratePerKViews != null ? "CPM: $" + selected.ratePerKViews + " per 1,000 views" : "",
      selected && selected.minViewsRequired != null ? "Minimum views: " + selected.minViewsRequired : "",
      selected && selected.maxPayoutPerSubmission != null ? "Maximum payout per submission: $" + selected.maxPayoutPerSubmission : "",
      campaign.budgetUsd != null ? "Budget: $" + campaign.spentUsd + " spent / $" + campaign.budgetUsd + " total" : "",
      campaign.remainingUsd != null ? "Budget remaining (derived from snapshot): $" + campaign.remainingUsd : "",
      campaign.description,
      campaign.requirementsText,
      "Third-party scraped snapshot date: " + (campaign.snapshotDate || "Not stated"),
      "Important: This is a third-party scraped snapshot, not an official campaign brief. Verify all details, current availability, eligibility and rules on the official Content Rewards page before applying."
    ];
    return lines.filter(Boolean).join("\n");
  }

  async function fetchCampaigns(options) {
    const opts = options || {};
    const fetcher = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!fetcher) throw new Error("This browser does not support fetching campaign data.");
    const params = new URLSearchParams({ page: "1", limit: "100", sort: "rate", order: "desc" });
    if (opts.search) params.set("search", text(opts.search, 100));
    if (opts.type && opts.type !== "all") params.set("type", text(opts.type, 30).toLowerCase());
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 12000) : null;
    let response;
    try {
      response = await fetcher(API_URL + "?" + params.toString(), {
        method: "GET", mode: "cors", credentials: "omit",
        headers: { Accept: "application/json" },
        signal: controller ? controller.signal : undefined
      });
    } catch (error) {
      if (error && error.name === "AbortError") throw new Error("Campaign feed request timed out. Try again later.");
      throw new Error("Campaign feed could not be reached from this browser (network or cross-origin access). Use the official Discover page instead.");
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    if (!response || !response.ok) throw new Error("Third-party campaign feed returned HTTP " + (response ? response.status : "no response") + ".");
    let payload;
    try { payload = await response.json(); } catch (_) { throw new Error("Third-party campaign feed returned invalid JSON."); }
    const rows = normalizeResponse(payload, opts.now == null ? Date.now() : opts.now);
    return {
      campaigns: filterCampaigns(rows, opts),
      totalReceived: rows.length,
      sourceUrl: API_URL,
      sourceLabel: "Third-party scraped snapshot · not official",
      fetchedAt: new Date(opts.now == null ? Date.now() : opts.now).toISOString()
    };
  }

  return { API_URL, OFFICIAL_DISCOVER, INDIA_PLATFORMS, safeOfficialUrl, canonicalCampaignUrl, normalizeCampaign, normalizeResponse,
    filterCampaigns, campaignToBrief, fetchCampaigns };
});
