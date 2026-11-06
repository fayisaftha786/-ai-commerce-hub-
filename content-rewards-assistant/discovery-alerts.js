(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClipRewardDiscoveryAlerts = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const STORAGE_KEY = "clipreward-discovery-alert-state-v1";
  const MAX_SEEN_KEYS = 10000;

  function clean(value, max) {
    return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max || 300);
  }

  function officialUrl(value) {
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

  function candidate(row) {
    if (!row || typeof row !== "object" || row.notSeenInLatestScan !== false) return null;
    if ((row.sourceVerification || row.verification) !== "official-public-page") return null;
    const url = officialUrl(row.officialUrl || row.url);
    if (!url) return null;
    const identity = clean(row.discoveryKey || row.id, 160);
    const key = identity || "url:" + url;
    return { key, title: clean(row.title, 160) || "New Content Rewards campaign", url };
  }

  function createObserver(options) {
    const opts = options && typeof options === "object" ? options : {};
    let storage = opts.storage || null;
    if (!storage) {
      try { storage = typeof globalThis.localStorage !== "undefined" ? globalThis.localStorage : null; }
      catch (_) { storage = null; }
    }
    const storageKey = clean(opts.storageKey || STORAGE_KEY, 120);

    function read() {
      if (!storage || typeof storage.getItem !== "function") return { ok: false, initialized: false, seenKeys: [] };
      try {
        const raw = storage.getItem(storageKey);
        if (!raw) return { ok: true, initialized: false, seenKeys: [] };
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.seenKeys)) {
          return { ok: true, initialized: false, seenKeys: [] };
        }
        return {
          ok: true,
          initialized: parsed.initialized === true,
          seenKeys: parsed.seenKeys.filter((key) => typeof key === "string" && key.length <= 200).slice(-MAX_SEEN_KEYS)
        };
      } catch (_) {
        return { ok: false, initialized: false, seenKeys: [] };
      }
    }

    function observe(rows) {
      const previous = read();
      if (!previous.ok || !storage || typeof storage.setItem !== "function") {
        return { ok: false, baseline: false, newCampaigns: [], error: "Discovery alert history is unavailable; no alert was sent." };
      }
      const current = new Map();
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        const item = candidate(row);
        if (item) current.set(item.key, item);
      });
      const baseline = !previous.initialized;
      const known = new Set(previous.seenKeys);
      const newCampaigns = baseline ? [] : [...current.values()].filter((item) => !known.has(item.key));
      const seenKeys = [...known];
      current.forEach((item) => {
        if (!known.has(item.key)) seenKeys.push(item.key);
      });
      try {
        storage.setItem(storageKey, JSON.stringify({
          version: 1,
          initialized: true,
          seenKeys: seenKeys.slice(-MAX_SEEN_KEYS),
          updatedAt: new Date().toISOString()
        }));
      } catch (_) {
        return { ok: false, baseline: false, newCampaigns: [], error: "Discovery alert history could not be saved; no alert was sent." };
      }
      return { ok: true, baseline, newCampaigns, seenCount: current.size };
    }

    return Object.freeze({ observe });
  }

  return Object.freeze({ STORAGE_KEY, MAX_SEEN_KEYS, officialUrl, candidate, createObserver });
});
