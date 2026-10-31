"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const Feed = require("../content-rewards-assistant/campaign-feed.js");
const Discovery = require("../content-rewards-assistant/discovery-engine.js");
const Scout = require("../content-rewards-assistant/campaign-scout.js");

const MAX_DETAIL_PAGES = 60;
const MAX_PAGE_BYTES = 1_500_000;
const MAX_PAGE_TEXT = 20_000;
const DETAIL_CONCURRENCY = 3;

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

async function fetchPublicCampaignPage(value, options = {}) {
  const url = Feed.canonicalCampaignUrl(value);
  if (!url) throw new Error("Only public HTTPS Content Rewards campaign URLs are supported.");
  const fetcher = options.fetchImpl || globalThis.fetch;
  if (typeof fetcher !== "function") throw new Error("This runtime does not support public campaign page fetching.");
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), options.timeoutMs || 12000) : null;
  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "follow",
      credentials: "omit",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "ClipReward-PublicPageAnalyzer/1.0"
      },
      signal: controller ? controller.signal : undefined
    });
    if (!response || !response.ok) throw new Error("Public campaign page returned HTTP " + (response ? response.status : "no response") + ".");
    const finalUrl = Feed.canonicalCampaignUrl(response.url || url);
    if (!finalUrl || new URL(finalUrl).host !== new URL(url).host) {
      throw new Error("The campaign URL redirected outside the public Content Rewards campaign page.");
    }
    const contentType = response.headers && response.headers.get ? response.headers.get("content-type") || "" : "";
    if (contentType && !/(?:text\/html|application\/xhtml\+xml)/i.test(contentType)) {
      throw new Error("The campaign URL did not return an HTML page.");
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_PAGE_BYTES) throw new Error("The campaign page is larger than the 1.5 MB safety limit.");
    const pageText = extractVisibleText(raw);
    const parsed = Scout.parseCampaignBrief({ url, requestedPlatform: "", text: pageText });
    return {
      url,
      status: "ok",
      fetchedAt: new Date(options.now == null ? Date.now() : options.now).toISOString(),
      httpStatus: response.status || 200,
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
  } catch (error) {
    if (error && error.name === "AbortError") throw new Error("Public campaign page request timed out.");
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function fetchCampaignDetails(campaigns, options = {}) {
  const previous = Array.isArray(options.previous) ? options.previous : [];
  const oldByUrl = new Map(previous.map((row) => [Feed.canonicalCampaignUrl(row.url), row]).filter(([url]) => Boolean(url)));
  const targets = [...new Set((Array.isArray(campaigns) ? campaigns : [])
    .map((row) => Feed.canonicalCampaignUrl(row && row.officialUrl))
    .filter(Boolean))].slice(0, Number.isInteger(options.limit) ? Math.max(0, Math.min(MAX_DETAIL_PAGES, options.limit)) : MAX_DETAIL_PAGES);
  const records = new Map(oldByUrl);
  let cursor = 0;
  const concurrency = Math.max(1, Math.min(6, Number(options.concurrency) || DETAIL_CONCURRENCY));
  const worker = async () => {
    while (cursor < targets.length) {
      const url = targets[cursor++];
      try {
        const detail = await fetchPublicCampaignPage(url, { fetchImpl: options.fetchImpl, now: options.now, timeoutMs: options.timeoutMs });
        records.set(url, detail);
      } catch (error) {
        const previousDetail = oldByUrl.get(url);
        records.set(url, previousDetail
          ? { ...previousDetail, status: "stale", lastAttemptAt: new Date(options.now == null ? Date.now() : options.now).toISOString(), lastError: error.message }
          : { url, status: "unavailable", fetchedAt: "", lastAttemptAt: new Date(options.now == null ? Date.now() : options.now).toISOString(), lastError: error.message, pageTitle: "", pageText: "", textLength: 0, detected: null });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return {
    details: [...records.values()].slice(-MAX_DETAIL_PAGES),
    attempted: targets.length,
    available: targets.filter((url) => records.get(url) && records.get(url).status === "ok").length,
    failed: targets.filter((url) => !records.get(url) || records.get(url).status !== "ok").length
  };
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
    const pageDetails = await fetchCampaignDetails(merged.campaigns, {
      previous: previous.campaignDetails || [],
      fetchImpl: options.fetchPageImpl || globalThis.fetch,
      now,
      limit: options.detailLimit,
      concurrency: options.detailConcurrency,
      timeoutMs: options.detailTimeoutMs
    });
    const record = {
      at: result.fetchedAt || startedAt,
      completedAt: new Date(now).toISOString(),
      status: "success",
      checkedCount: merged.checkedCount,
      newCount: merged.newCount,
      totalReceived: result.totalReceived,
      detailPagesAttempted: pageDetails.attempted,
      detailPagesAvailable: pageDetails.available,
      detailPagesFailed: pageDetails.failed,
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

module.exports = { DEFAULT_FILE, MAX_DETAIL_PAGES, MAX_PAGE_BYTES, MAX_PAGE_TEXT, readSnapshot, writeSnapshot, decodeHtmlEntities, extractVisibleText, fetchPublicCampaignPage, fetchCampaignDetails, runScheduledScan };
