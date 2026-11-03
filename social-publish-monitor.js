"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClipRewardPublishMonitor = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TERMINAL_ERRORS = new Set(["reconnect_required", "not_connected", "permission_denied", "invalid_facebook_video_id"]);

  function safeReceipt(result, provider) {
    const source = result && typeof result === "object" ? result : {};
    if (source.ok !== true) {
      const error = String(source.error || "provider_status_unavailable");
      return { state: TERMINAL_ERRORS.has(error) ? "failed" : "retry", error };
    }

    const platform = String(provider || "").toLowerCase();
    const privacy = String(source.privacyStatus || "").toLowerCase();
    let url = "";
    let publishedAt = "";
    let isPublic = false;

    if (platform === "youtube") {
      const processed = source.uploadStatus === "processed" && source.processingStatus === "succeeded";
      if (!processed) return { state: "pending" };
      if (privacy !== "public") return { state: "not_public", privacyStatus: privacy || "unknown" };
      url = String(source.url || "");
      publishedAt = String(source.publishedAt || "");
      isPublic = true;
    } else if (platform === "facebook") {
      if (source.published !== true) return { state: "pending" };
      if (privacy !== "public") return { state: "invalid", error: "facebook_public_visibility_not_confirmed" };
      url = String(source.permalink || source.url || "");
      publishedAt = String(source.publishedAt || "");
      isPublic = true;
    } else {
      return { state: "failed", error: "unsupported_publish_provider" };
    }

    let parsed;
    try { parsed = new URL(url); } catch (_) { parsed = null; }
    const allowedHosts = platform === "youtube"
      ? ["youtube.com", "www.youtube.com"]
      : ["facebook.com", "www.facebook.com", "fb.watch"];
    const validUrl = Boolean(parsed && parsed.protocol === "https:" &&
      allowedHosts.includes(parsed.hostname) && !parsed.username && !parsed.password);
    const timestamp = new Date(publishedAt);
    if (!isPublic || !validUrl || Number.isNaN(timestamp.getTime())) {
      return { state: "invalid", error: "public_receipt_missing_safe_url_or_timestamp" };
    }
    if (platform === "youtube") {
      const videoId = String(source.videoId || "");
      if (!/^[A-Za-z0-9_-]{6,32}$/.test(videoId) ||
          parsed.pathname !== "/watch" || parsed.searchParams.get("v") !== videoId) {
        return { state: "invalid", error: "youtube_public_receipt_video_mismatch" };
      }
    }
    return { state: "published", url: parsed.href, publishedAt: timestamp.toISOString() };
  }

  async function pollUntilPublic(check, options) {
    if (typeof check !== "function") throw new TypeError("A provider status check function is required.");
    const settings = options && typeof options === "object" ? options : {};
    const provider = String(settings.provider || "").toLowerCase();
    const maxAttempts = Number.isInteger(settings.maxAttempts)
      ? Math.max(1, Math.min(60, settings.maxAttempts)) : 24;
    const intervalMs = Number.isInteger(settings.intervalMs)
      ? Math.max(0, Math.min(30000, settings.intervalMs)) : 5000;
    const wait = typeof settings.sleep === "function"
      ? settings.sleep
      : (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    let lastResult = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (settings.signal && settings.signal.aborted) {
        return { state: "cancelled", attempt: attempt - 1, result: lastResult };
      }
      try {
        lastResult = await check();
      } catch (error) {
        lastResult = { ok: false, error: String(error && error.message || "provider_status_unavailable") };
      }
      const verdict = safeReceipt(lastResult, provider);
      if (typeof settings.onAttempt === "function") {
        settings.onAttempt(attempt, maxAttempts, verdict);
      }
      if (["published", "not_public", "failed", "invalid"].includes(verdict.state)) {
        return { ...verdict, attempt, result: lastResult };
      }
      if (attempt < maxAttempts && intervalMs > 0) await wait(intervalMs);
    }
    return { state: "timed_out", attempt: maxAttempts, result: lastResult };
  }

  return Object.freeze({ safeReceipt, pollUntilPublic });
});
