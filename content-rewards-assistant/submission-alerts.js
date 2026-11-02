(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClipRewardSubmissionAlerts = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const WINDOW_MS = 30 * 60 * 1000;
  const REMINDER_THRESHOLDS = Object.freeze([
    { stage: "1m", thresholdMs: 60 * 1000, message: "Less than 1 minute remains. Submit the public link inside Content Rewards immediately." },
    { stage: "5m", thresholdMs: 5 * 60 * 1000, message: "The post is in its final 5 minutes. Submit its public link inside Content Rewards now." },
    { stage: "15m", thresholdMs: 15 * 60 * 1000, message: "The post is in its final 15 minutes. Submit its public link inside Content Rewards." }
  ]);

  function getAlertKey(campaign, stage) {
    if (!campaign || !campaign.id || !campaign.postedAt || !stage) return "";
    return [campaign.id, campaign.postedAt, stage].join("|");
  }

  function getReminder(campaign, now) {
    if (!campaign || campaign.platform !== "Content Rewards" || !campaign.postedAt ||
        ["submitted", "approved", "rejected"].includes(campaign.status)) return null;
    const postedAt = Date.parse(campaign.postedAt);
    const currentTime = now == null ? Date.now() : Number(now);
    if (!Number.isFinite(postedAt) || !Number.isFinite(currentTime)) return null;

    const remainingMs = postedAt + WINDOW_MS - currentTime;
    if (remainingMs <= 0 || remainingMs > REMINDER_THRESHOLDS[0].thresholdMs) return null;
    const threshold = REMINDER_THRESHOLDS.find((item) => remainingMs <= item.thresholdMs);
    if (!threshold) return null;

    const campaignName = String(campaign.name || "your campaign").slice(0, 120);
    return {
      key: getAlertKey(campaign, threshold.stage),
      stage: threshold.stage,
      remainingMs,
      title: "Content Rewards · " + campaignName,
      body: threshold.message
    };
  }

  return Object.freeze({ WINDOW_MS, getAlertKey, getReminder });
});
