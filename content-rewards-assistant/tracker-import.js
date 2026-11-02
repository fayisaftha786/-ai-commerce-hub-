(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClipRewardTrackerImport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function canonicalCampaignUrl(value) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol !== "https:" || !/(^|\.)contentrewards\.com$/i.test(url.hostname) ||
          !/^\/c\/campaigns\/[^/]+$/.test(url.pathname) || url.username || url.password) return "";
      return url.origin.toLowerCase() + url.pathname.replace(/\/$/, "");
    } catch (_) { return ""; }
  }

  function amountLabel(amount) {
    if (!amount || !Number.isFinite(Number(amount.value))) return "";
    const currency = String(amount.currency || "").toUpperCase();
    const symbol = currency === "INR" ? "₹" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : currency === "USD" ? "$" : currency + " ";
    return symbol + Number(amount.value).toLocaleString("en", { maximumFractionDigits: 2 });
  }

  function buildTrackerImportPlan(analysed, existingCampaigns, buildNotes, maxRecords) {
    const rows = Array.isArray(analysed) ? analysed : [];
    const existing = Array.isArray(existingCampaigns) ? existingCampaigns : [];
    const limit = Number.isInteger(maxRecords) && maxRecords >= 0 ? maxRecords : 500;
    const knownUrls = new Set(existing.map((row) => canonicalCampaignUrl(row && row.url)).filter(Boolean));
    const records = [];
    let skippedNotPromising = 0;
    let skippedStale = 0;
    let skippedInvalid = 0;
    let skippedDuplicate = 0;

    rows.forEach((row) => {
      if (!row || row.state !== "promising") {
        skippedNotPromising += 1;
        return;
      }
      if (row.pageStatus !== "ok" || row.notSeenInLatestScan === true) {
        skippedStale += 1;
        return;
      }
      const url = canonicalCampaignUrl(row.url);
      if (!url || !row.brief || typeof row.brief !== "object") {
        skippedInvalid += 1;
        return;
      }
      if (knownUrls.has(url)) {
        skippedDuplicate += 1;
        return;
      }
      if (records.length >= limit) {
        skippedInvalid += 1;
        return;
      }

      const brief = row.brief;
      const rate = brief.rate && brief.rate.label ? brief.rate.label :
        brief.rate && brief.rate.model ? brief.rate.model + " · verify full terms" : "Payout not recognised · verify";
      const cap = amountLabel(brief.capPerClip);
      const minimum = amountLabel(brief.minimumPayout);
      const payoutTerms = [rate, cap ? "Max per clip " + cap : "", minimum ? "Minimum payout " + minimum : ""]
        .filter(Boolean).join(" · ").slice(0, 180);
      const budgetTerms = [
        brief.budget && brief.budget.spent ? amountLabel(brief.budget.spent) + " used" : "",
        brief.budget && brief.budget.total ? amountLabel(brief.budget.total) + " total" : "",
        brief.budget && brief.budget.remaining ? amountLabel(brief.budget.remaining) + " remaining" : ""
      ].filter(Boolean).join(" · ").slice(0, 180);

      records.push({
        name: String(row.title || brief.title || "Content Rewards campaign").trim().slice(0, 120),
        platform: "Content Rewards",
        url,
        deadline: /^\d{4}-\d{2}-\d{2}$/.test(String(brief.deadline || "")) ? brief.deadline : "",
        payoutTerms,
        budgetTerms,
        rules: typeof buildNotes === "function" ? String(buildNotes(brief) || "").slice(0, 2000) : "",
        status: "idea",
        postUrl: "",
        postPlatform: "Other",
        postedAt: "",
        submittedAt: ""
      });
      knownUrls.add(url);
    });

    return {
      records,
      summary: {
        considered: rows.length,
        imported: records.length,
        skippedNotPromising,
        skippedStale,
        skippedInvalid,
        skippedDuplicate
      }
    };
  }

  return Object.freeze({ canonicalCampaignUrl, buildTrackerImportPlan });
});
