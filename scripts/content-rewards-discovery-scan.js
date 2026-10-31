"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const Feed = require("../content-rewards-assistant/campaign-feed.js");
const Discovery = require("../content-rewards-assistant/discovery-engine.js");
const Scout = require("../content-rewards-assistant/campaign-scout.js");

const MAX_DETAIL_PAGES = 60;
const OFFICIAL_DISCOVER_URL = "https://contentrewards.com/c/discover";
const MAX_PAGE_BYTES = 1_500_000;
const MAX_PAGE_TEXT = 20_000;
const DETAIL_CONCURRENCY = 3;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const TRANSIENT_FEED_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_FEED_RETRY_DELAYS_MS = [350, 1000];

const DEFAULT_FILE = path.join(__dirname, "..", "content-rewards-assistant", "discovery-snapshot.json");

async function readSnapshot(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.campaigns) || !Array.isArray(parsed.scans)) {
      throw new Error("Scheduled discovery snapshot has an invalid structure.");
    }
    parsed.campaignDetails = Array.isArray(parsed.campaignDetails) ? parsed.campaignDetails.slice(0, MAX_DETAIL_PAGES) : [];
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


function decodeHtmlEntities(value) {
  const named = { amp: "&", quot: '"', apos: "'", nbsp: " ", lt: "<", gt: ">", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1] && entity[1].toLowerCase() === "x";
      const number = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : match;
    }
    return Object.prototype.hasOwnProperty.call(named, entity.toLowerCase()) ? named[entity.toLowerCase()] : match;
  });
}

function extractVisibleText(html) {
  let source = String(html || "").replace(/<!--[\s\S]*?-->/g, " ");
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(source);
  if (main && main[1].length > 100) source = main[1];
  else {
    const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(source);
    if (body) source = body[1];
  }
  source = source
    .replace(/<(script|style|noscript|svg|iframe|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<img\b[^>]*alt=["']([^"']+)["'][^>]*>/gi, " $1 ")
    .replace(/<\/(?:h[1-6]|p|li|div|section|article|tr|td|th|header|main|ul|ol)>/gi, "\n")
    .replace(/<(?:br|hr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const lines = decodeHtmlEntities(source)
    .replace(/\u00a0/g, " ")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const text = lines.join("\n");
  if (text.length < 40) throw new Error("The public page returned too little readable campaign content (possibly a JavaScript-only or blocked page).");
  return text.slice(0, MAX_PAGE_TEXT);
}

function canonicalDiscoverUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" ||
        (url.hostname !== "contentrewards.com" && !url.hostname.endsWith(".contentrewards.com")) ||
        (url.port && url.port !== "443") || url.username || url.password ||
        url.pathname.replace(/\/+$/, "").toLowerCase() !== "/c/discover") return "";
    url.pathname = "/c/discover";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch (_) {
    return "";
  }
}

function canonicalPublicCampaignDetailUrl(value) {
  const canonical = Feed.canonicalCampaignUrl(value);
  if (!canonical) return "";
  try {
    const url = new URL(canonical);
    const segments = url.pathname.split("/").filter(Boolean);
    return segments.length === 3 && segments[0] === "c" && segments[1] === "campaigns" && Boolean(segments[2])
      ? canonical
      : "";
  } catch (_) {
    return "";
  }
}

function extractDiscoverCampaigns(html) {
  const source = String(html || "").replace(/<!--[\s\S]*?-->/g, " ");
  const seen = new Set();
  const campaigns = [];
  const anchors = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match;
  while ((match = anchors.exec(source)) !== null) {
    const attributes = match[1] || "";
    const hrefMatch = /\bhref\s*=\s*(["'])(.*?)\1/i.exec(attributes);
    if (!hrefMatch) continue;
    let resolved;
    try {
      resolved = new URL(decodeHtmlEntities(hrefMatch[2]), OFFICIAL_DISCOVER_URL).href;
    } catch (_) {
      continue;
    }
    const officialUrl = canonicalPublicCampaignDetailUrl(resolved);
    if (!officialUrl || seen.has(officialUrl)) continue;
    seen.add(officialUrl);
    const titleAttribute = /\b(?:aria-label|title)\s*=\s*(["'])(.*?)\1/i.exec(attributes);
    const anchorBody = match[2] || "";
    const heading = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/i.exec(anchorBody);
    const headingText = heading
      ? decodeHtmlEntities(heading[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
      : "";
    const anchorText = decodeHtmlEntities(anchorBody
      .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<img\b[^>]*alt=["']([^"']+)["'][^>]*>/gi, " $1 ")
      .replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ").trim();
    const url = new URL(officialUrl);
    const id = url.pathname.split("/").filter(Boolean).pop() || officialUrl;
    const title = (headingText || (titleAttribute && decodeHtmlEntities(titleAttribute[2])) || anchorText || id).slice(0, 180);
    campaigns.push({
      id,
      title,
      brand: "",
      type: "",
      description: anchorText.slice(0, 1200),
      payouts: [],
      ageDays: 0,
      freshness: "recent",
      officialUrl,
      source: "Official Content Rewards public Discover page",
      sourceVerification: "official-public-page"
    });
    if (campaigns.length >= MAX_DETAIL_PAGES) break;
  }
  return campaigns;
}

function createRetryingFetcher(fetcher, options = {}) {
  if (typeof fetcher !== "function") throw new Error("Public Content Rewards page fetching is not available in this runtime.");
  const delays = Array.isArray(options.retryDelaysMs)
    ? options.retryDelaysMs.map((value) => Math.max(0, Math.min(5000, Number(value) || 0))).slice(0, 5)
    : DEFAULT_FEED_RETRY_DELAYS_MS;
  const onAttempt = typeof options.onAttempt === "function" ? options.onAttempt : null;
  let attempts = 0;
  const fetchImpl = async (...args) => {
    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      attempts += 1;
      if (onAttempt) onAttempt(attempts);
      try {
        const response = await fetcher(...args);
        if (!response || !TRANSIENT_FEED_STATUSES.has(Number(response.status)) || attempt >= delays.length) return response;
      } catch (error) {
        if (error && error.name === "AbortError") throw error;
        if (attempt >= delays.length) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
    throw new Error("Public Content Rewards request failed after all retry attempts.");
  };
  return { fetchImpl, getAttempts: () => attempts };
}

async function fetchApprovedHtmlPage(value, canonicalize, options = {}) {
  const url = canonicalize(value);
  if (!url) throw new Error("Only approved public HTTPS Content Rewards pages are supported.");
  const fetcher = options.fetchImpl || globalThis.fetch;
  const retry = createRetryingFetcher(fetcher, {
    retryDelaysMs: options.retryDelaysMs,
    onAttempt: options.onAttempt
  });
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), options.timeoutMs || 12000) : null;
  try {
    let currentUrl = url;
    let response = null;
    const visitedUrls = new Set();
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      if (visitedUrls.has(currentUrl)) throw new Error("The public campaign page returned a redirect loop.");
      visitedUrls.add(currentUrl);
      response = await retry.fetchImpl(currentUrl, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "ClipReward-PublicPageAnalyzer/1.0"
        },
        signal: controller ? controller.signal : undefined
      });
      if (!response) throw new Error("Public Content Rewards page returned no response.");
      if (!REDIRECT_STATUSES.has(response.status)) break;
      const location = response.headers && response.headers.get ? response.headers.get("location") : "";
      if (!location) throw new Error("The public campaign page returned a redirect without a Location header.");
      if (redirectCount >= MAX_REDIRECTS) throw new Error("The public campaign page exceeded the safe redirect limit.");
      let redirectUrl;
      try {
        redirectUrl = new URL(location, currentUrl).href;
      } catch (_) {
        throw new Error("The public campaign page returned an invalid redirect URL.");
      }
      const safeRedirect = canonicalize(redirectUrl);
      if (!safeRedirect) throw new Error("The public campaign page attempted to redirect outside its approved Content Rewards path.");
      currentUrl = safeRedirect;
    }
    if (!response || !response.ok) throw new Error("Public Content Rewards page returned HTTP " + (response ? response.status : "no response") + ".");
    const finalUrl = canonicalize(response.url || currentUrl);
    if (!finalUrl || finalUrl !== currentUrl) {
      throw new Error("The public Content Rewards page response URL did not match the validated destination.");
    }
    const contentType = response.headers && response.headers.get ? response.headers.get("content-type") || "" : "";
    if (contentType && !/(?:text\/html|application\/xhtml\+xml)/i.test(contentType)) {
      throw new Error("The public Content Rewards URL did not return an HTML page.");
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_PAGE_BYTES) throw new Error("The public Content Rewards page is larger than the 1.5 MB safety limit.");
    return {
      url,
      finalUrl,
      html: raw,
      htmlBytes: Buffer.byteLength(raw, "utf8"),
      contentType,
      status: response.status || 200,
      requestAttempts: retry.getAttempts()
    };
  } catch (error) {
    if (error && error.name === "AbortError") throw new Error("Public Content Rewards page request timed out.");
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function fetchPublicDiscoverCampaigns(options = {}) {
  const page = await fetchApprovedHtmlPage(OFFICIAL_DISCOVER_URL, canonicalDiscoverUrl, options);
  const campaigns = extractDiscoverCampaigns(page.html);
  if (!campaigns.length) {
    throw new Error("The official Discover page did not expose any public campaign detail links. Its page structure may have changed or require client-side rendering.");
  }
  return {
    campaigns,
    totalReceived: campaigns.length,
    fetchedAt: new Date(options.now == null ? Date.now() : options.now).toISOString(),
    sourceUrl: OFFICIAL_DISCOVER_URL,
    sourceLabel: "Official Content Rewards public Discover page",
    requestAttempts: page.requestAttempts
  };
}

function enrichOfficialCampaignRows(campaigns, details, now) {
  const byUrl = new Map((Array.isArray(details) ? details : [])
    .map((detail) => [canonicalPublicCampaignDetailUrl(detail && detail.url), detail])
    .filter(([url]) => Boolean(url)));
  return (Array.isArray(campaigns) ? campaigns : []).map((row) => {
    const detail = byUrl.get(Feed.canonicalCampaignUrl(row && row.officialUrl));
    if (!detail || !detail.pageText || !["ok", "stale"].includes(detail.status)) {
      return Discovery.enrich({ ...row, sourceVerification: "official-public-page" }, now);
    }
    let parsed;
    try {
      parsed = Scout.parseCampaignBrief({ url: row.officialUrl, requestedPlatform: "", text: detail.pageText });
    } catch (_) {
      return Discovery.enrich({ ...row, sourceVerification: "official-public-page" }, now);
    }
    const rateRows = parsed.platformRates && parsed.platformRates.length
      ? parsed.platformRates
      : parsed.rate && parsed.platforms.length
        ? parsed.platforms.map((platform) => ({ platform, ...parsed.rate }))
        : [];
    const payouts = rateRows.map((rate) => {
      const cap = (parsed.platformCaps || []).find((item) => item.platform === rate.platform);
      const minimum = (parsed.platformMinimumViews || []).find((item) => item.platform === rate.platform);
      const maximum = (parsed.platformMaximumViews || []).find((item) => item.platform === rate.platform);
      return {
        platform: rate.platform,
        ratePerKViews: rate.model === "CPM" && rate.amount ? rate.amount.value : null,
        flatAmount: rate.model === "Per post" && rate.amount ? rate.amount.value : null,
        rateLabel: rate.label || "",
        payoutModel: rate.model || "",
        minViewsRequired: minimum ? minimum.value : parsed.minimumViews,
        maxViewsAllowed: maximum ? maximum.value : parsed.maximumViews,
        maxPayoutPerSubmission: cap && cap.amount ? cap.amount.value : parsed.capPerClip ? parsed.capPerClip.value : null
      };
    });
    const fetchedAt = Date.parse(detail.fetchedAt || "");
    const ageDays = Number.isFinite(fetchedAt) ? Math.max(0, Math.floor(((now == null ? Date.now() : now) - fetchedAt) / 86400000)) : null;
    const budget = parsed.budget || {};
    return Discovery.enrich({
      ...row,
      title: parsed.title || detail.pageTitle || row.title,
      type: parsed.campaignType || row.type,
      description: (parsed.rawText || detail.pageText).slice(0, 1200),
      payouts,
      budgetUsd: budget.total ? budget.total.value : row.budgetUsd,
      spentUsd: budget.spent ? budget.spent.value : row.spentUsd,
      remainingUsd: budget.remaining ? budget.remaining.value : row.remainingUsd,
      snapshotDate: detail.fetchedAt ? detail.fetchedAt.slice(0, 10) : row.snapshotDate || "",
      ageDays,
      freshness: detail.status === "ok" ? "recent" : "stale",
      campaignStatus: parsed.campaignStatus,
      campaignAccessMode: parsed.entryMode,
      deadline: parsed.deadline,
      minimumViews: parsed.minimumViews,
      maximumViews: parsed.maximumViews,
      minimumFollowers: parsed.minimumFollowers,
      hiddenRequirements: parsed.hiddenRequirements,
      source: "Official Content Rewards public Discover page",
      sourceVerification: "official-public-page",
      pageFetchStatus: detail.status
    }, now);
  });
}

async function fetchPublicCampaignPage(value, options = {}) {
  const url = canonicalPublicCampaignDetailUrl(value);
  if (!url) throw new Error("Only public HTTPS Content Rewards campaign URLs using /c/campaigns/{id} are supported.");
  const page = await fetchApprovedHtmlPage(url, canonicalPublicCampaignDetailUrl, options);
  let pageText;
  try {
    pageText = extractVisibleText(page.html);
  } catch (error) {
    const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(page.html);
    const responseTitle = titleMatch
      ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 120)
      : "";
    const detail = [
      "HTTP " + page.status,
      "content-type " + (page.contentType || "unknown"),
      (page.htmlBytes || 0) + " HTML bytes",
      responseTitle ? "title " + responseTitle : "no HTML title"
    ].join(", ");
    const diagnosticError = new Error((error && error.message ? error.message : "The public page returned no readable text.") + " (" + detail + ").");
    diagnosticError.httpStatus = page.status;
    diagnosticError.contentType = page.contentType;
    diagnosticError.htmlBytes = page.htmlBytes;
    throw diagnosticError;
  }
  const parsed = Scout.parseCampaignBrief({ url, requestedPlatform: "", text: pageText });
  return {
    url,
    finalUrl: page.finalUrl,
    status: "ok",
    fetchedAt: new Date(options.now == null ? Date.now() : options.now).toISOString(),
    httpStatus: page.status,
    contentType: page.contentType,
    htmlBytes: page.htmlBytes,
    requestAttempts: page.requestAttempts,
    pageTitle: parsed.title || "",
    pageText,
    textLength: pageText.length,
    detected: {
      campaignType: parsed.campaignType,
      campaignStatus: parsed.campaignStatus,
      entryMode: parsed.entryMode,
      platformMatch: parsed.platformMatch,
      platforms: parsed.platforms,
      rate: parsed.rate,
      platformRates: parsed.platformRates,
      budget: parsed.budget,
      deadline: parsed.deadline,
      minimumViews: parsed.minimumViews,
      maximumViews: parsed.maximumViews,
      minimumFollowers: parsed.minimumFollowers,
      duration: parsed.duration,
      creativeFormat: parsed.creativeFormat,
      hashtags: parsed.hashtags,
      mentions: parsed.mentions,
      hiddenRequirements: parsed.hiddenRequirements,
      coverageScore: parsed.coverageScore,
      missing: parsed.missing
    }
  };
}

async function fetchCampaignDetails(campaigns, options = {}) {
  const previous = Array.isArray(options.previous) ? options.previous : [];
  const oldByUrl = new Map(previous.map((row) => [canonicalPublicCampaignDetailUrl(row.url), row]).filter(([url]) => Boolean(url)));
  const targets = [...new Set((Array.isArray(campaigns) ? campaigns : [])
    .map((row) => canonicalPublicCampaignDetailUrl(row && row.officialUrl))
    .filter(Boolean))].slice(0, Number.isInteger(options.limit) ? Math.max(0, Math.min(MAX_DETAIL_PAGES, options.limit)) : MAX_DETAIL_PAGES);
  const targetSet = new Set(targets);
  const records = new Map();
  for (const [url, row] of oldByUrl.entries()) {
    records.set(url, targetSet.has(url) ? row : {
      ...row,
      status: "stale",
      notInLatestFeed: true,
      lastError: "This campaign URL was not present in the latest public lead feed snapshot; verify its current status on Content Rewards."
    });
  }
  let cursor = 0;
  let totalRequestAttempts = 0;
  const concurrency = Math.max(1, Math.min(6, Number(options.concurrency) || DETAIL_CONCURRENCY));
  const worker = async () => {
    while (cursor < targets.length) {
      const url = targets[cursor++];
      try {
        const detail = await fetchPublicCampaignPage(url, {
          fetchImpl: options.fetchImpl, now: options.now, timeoutMs: options.timeoutMs,
          retryDelaysMs: options.retryDelaysMs,
          onAttempt: () => { totalRequestAttempts += 1; }
        });
        totalRequestAttempts = Math.max(totalRequestAttempts, detail.requestAttempts || 0);
        records.delete(url);
        records.set(url, { ...detail, notInLatestFeed: false });
      } catch (error) {
        const previousDetail = oldByUrl.get(url);
        records.delete(url);
        records.set(url, previousDetail && previousDetail.pageText
          ? { ...previousDetail, status: "stale", lastAttemptAt: new Date(options.now == null ? Date.now() : options.now).toISOString(), lastError: error.message }
          : { ...(previousDetail || {}), url, status: "unavailable", fetchedAt: previousDetail && previousDetail.fetchedAt || "", lastAttemptAt: new Date(options.now == null ? Date.now() : options.now).toISOString(), lastError: error.message, httpStatus: error.httpStatus || 0, contentType: error.contentType || "", htmlBytes: error.htmlBytes || 0, pageTitle: previousDetail && previousDetail.pageTitle || "", pageText: previousDetail && previousDetail.pageText || "", textLength: previousDetail && previousDetail.textLength || 0, detected: previousDetail && previousDetail.detected || null });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return {
    details: [...records.values()].slice(-MAX_DETAIL_PAGES),
    attempted: targets.length,
    requestAttempts: totalRequestAttempts,
    available: targets.filter((url) => records.get(url) && records.get(url).status === "ok").length,
    failed: targets.filter((url) => !records.get(url) || records.get(url).status !== "ok").length
  };
}

async function fetchFeedWithRetry(feed, options = {}) {
  if (!feed || typeof feed.fetchCampaigns !== "function") {
    throw new Error("The campaign feed adapter is not configured.");
  }
  const fetcher = options.fetchImpl || globalThis.fetch;
  if (typeof fetcher !== "function") {
    return { result: await feed.fetchCampaigns(options), attempts: 0 };
  }
  const delays = Array.isArray(options.retryDelaysMs)
    ? options.retryDelaysMs.map((value) => Math.max(0, Math.min(5000, Number(value) || 0))).slice(0, 5)
    : DEFAULT_FEED_RETRY_DELAYS_MS;
  const onAttempt = typeof options.onAttempt === "function" ? options.onAttempt : null;
  const feedOptions = { ...options };
  delete feedOptions.retryDelaysMs;
  delete feedOptions.onAttempt;
  let attempts = 0;
  const retryingFetch = async (...args) => {
    let lastError = null;
    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      attempts += 1;
      if (onAttempt) onAttempt(attempts);
      try {
        const response = await fetcher(...args);
        if (!response || !TRANSIENT_FEED_STATUSES.has(Number(response.status)) || attempt >= delays.length) {
          return response;
        }
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      } catch (error) {
        if (error && error.name === "AbortError") throw error;
        lastError = error;
        if (attempt >= delays.length) throw error;
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
    }
    throw lastError || new Error("Campaign feed request failed after all retries.");
  };
  const result = await feed.fetchCampaigns({ ...feedOptions, fetchImpl: retryingFetch });
  return { result, attempts };
}

async function runScheduledScan(options = {}) {
  const filePath = path.resolve(options.filePath || DEFAULT_FILE);
  const feed = options.feed || Feed;
  const now = typeof options.now === "function" ? options.now() : options.now == null ? Date.now() : options.now;
  const startedAt = new Date(now).toISOString();
  let previous;
  let discoverRequestAttempts = 0;
  let feedRequestAttempts = 0;
  let sourceVerification = "official-public-page";
  let fallbackReason = "";
  let result;
  try {
    previous = await readSnapshot(filePath);
  } catch (error) {
    return { ok: false, error: "Existing discovery snapshot could not be read: " + error.message };
  }

  try {
    try {
      const official = await fetchPublicDiscoverCampaigns({
        fetchImpl: options.fetchDiscoverImpl || options.fetchImpl || globalThis.fetch,
        now,
        timeoutMs: options.discoverTimeoutMs,
        retryDelaysMs: options.discoverRetryDelaysMs,
        onAttempt: () => { discoverRequestAttempts += 1; }
      });
      discoverRequestAttempts = Math.max(discoverRequestAttempts, official.requestAttempts || 0);
      result = {
        campaigns: official.campaigns,
        totalReceived: official.totalReceived,
        fetchedAt: official.fetchedAt,
        sourceUrl: official.sourceUrl,
        sourceLabel: official.sourceLabel
      };
    } catch (officialError) {
      fallbackReason = officialError && officialError.message ? officialError.message : "Official Discover page could not be read.";
      const feedResponse = await fetchFeedWithRetry(feed, {
        platform: "",
        search: "",
        fetchImpl: options.fetchImpl,
        now,
        retryDelaysMs: options.feedRetryDelaysMs,
        onAttempt: () => { feedRequestAttempts += 1; }
      });
      feedRequestAttempts = Math.max(feedRequestAttempts, feedResponse.attempts);
      result = {
        ...feedResponse.result,
        sourceLabel: (feedResponse.result.sourceLabel || "Third-party public snapshot") + " · fallback after official Discover page unavailable"
      };
      sourceVerification = "third-party";
    }

    const priorCampaigns = (previous.campaigns || []).filter((row) => {
      const cameFromOfficialDiscover = row && (row.sourceVerification === "official-public-page" || row.source === "Official Content Rewards public Discover page");
      return !cameFromOfficialDiscover || Boolean(canonicalPublicCampaignDetailUrl(row.officialUrl));
    });
    const merged = Discovery.mergeHistory(priorCampaigns, result.campaigns, now);
    const pageDetails = await fetchCampaignDetails(result.campaigns, {
      previous: previous.campaignDetails || [],
      fetchImpl: options.fetchPageImpl || globalThis.fetch,
      now,
      limit: options.detailLimit,
      concurrency: options.detailConcurrency,
      timeoutMs: options.detailTimeoutMs,
      retryDelaysMs: options.detailRetryDelaysMs
    });
    const campaigns = sourceVerification === "official-public-page"
      ? enrichOfficialCampaignRows(merged.campaigns, pageDetails.details, now)
      : merged.campaigns;
    const record = {
      at: result.fetchedAt || startedAt,
      completedAt: new Date(now).toISOString(),
      status: "success",
      checkedCount: merged.checkedCount,
      newCount: merged.newCount,
      totalReceived: result.totalReceived,
      discoverRequestAttempts,
      feedRequestAttempts,
      detailPagesAttempted: pageDetails.attempted,
      detailPagesAvailable: pageDetails.available,
      detailPagesFailed: pageDetails.failed,
      detailRequestAttempts: pageDetails.requestAttempts,
      source: result.sourceLabel || "Official Content Rewards public Discover page",
      sourceUrl: result.sourceUrl || OFFICIAL_DISCOVER_URL,
      sourceVerification,
      fallbackReason,
      summary: {
        saved: campaigns.length,
        high: campaigns.filter((row) => row.opportunity && row.opportunity.tier === "high").length,
        medium: campaigns.filter((row) => row.opportunity && row.opportunity.tier === "medium").length,
        low: campaigns.filter((row) => row.opportunity && row.opportunity.tier === "low").length
      }
    };
    const snapshot = {
      schemaVersion: 1,
      generatedAt: record.completedAt,
      source: {
        id: sourceVerification === "official-public-page" ? "contentrewards-official-discover" : "contentrewards-snapshot",
        verification: sourceVerification,
        url: result.sourceUrl || OFFICIAL_DISCOVER_URL,
        label: result.sourceLabel || "Official Content Rewards public Discover page"
      },
      totalReceived: result.totalReceived || campaigns.length,
      campaigns,
      campaignDetails: pageDetails.details,
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
      discoverRequestAttempts,
      feedRequestAttempts,
      checkedCount: 0,
      newCount: 0,
      source: "Official Content Rewards Discover with third-party fallback",
      error: message
    };
    const snapshot = {
      schemaVersion: 1,
      generatedAt: record.completedAt,
      source: previous.source || { id: "contentrewards-official-discover", verification: "official-public-page", url: OFFICIAL_DISCOVER_URL, label: "Official Content Rewards public Discover page" },
      totalReceived: previous.totalReceived || 0,
      campaigns: previous.campaigns || [],
      campaignDetails: previous.campaignDetails || [],
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
      const attempts = result.snapshot && result.snapshot.lastScan ? result.snapshot.lastScan.feedRequestAttempts || 0 : 0;
      process.stderr.write("Scheduled discovery failed after " + attempts + " feed request(s): " + result.error + "\n");
      process.exitCode = 1;
      return;
    }
    const scan = result.snapshot.lastScan;
    process.stdout.write("Scheduled discovery complete: " + scan.checkedCount + " checked, " + scan.newCount + " new, " + result.snapshot.campaigns.length + " saved; " + scan.detailPagesAttempted + " campaign pages attempted, " + scan.detailPagesAvailable + " read, " + scan.detailPagesFailed + " failed.\n");
  }).catch((error) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  });
}

module.exports = { DEFAULT_FILE, OFFICIAL_DISCOVER_URL, MAX_DETAIL_PAGES, MAX_PAGE_BYTES, MAX_PAGE_TEXT, MAX_REDIRECTS, TRANSIENT_FEED_STATUSES, DEFAULT_FEED_RETRY_DELAYS_MS, readSnapshot, writeSnapshot, decodeHtmlEntities, extractVisibleText, canonicalDiscoverUrl, canonicalPublicCampaignDetailUrl, extractDiscoverCampaigns, createRetryingFetcher, fetchApprovedHtmlPage, fetchPublicDiscoverCampaigns, enrichOfficialCampaignRows, fetchPublicCampaignPage, fetchCampaignDetails, fetchFeedWithRetry, runScheduledScan };
