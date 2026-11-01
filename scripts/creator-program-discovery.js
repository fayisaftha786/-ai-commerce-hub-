"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ALLOWED_SOURCE_HOSTS = new Set(["support.google.com", "about.fb.com"]);
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 12000;

const SOURCE_REGISTRY = Object.freeze([
  {
    id: "youtube-ypp",
    platform: "YouTube",
    program: "YouTube Partner Program (YPP)",
    programType: "native-monetization",
    sourceUrl: "https://support.google.com/youtube/answer/72851?hl=en-IN",
    sourceLabel: "YouTube official YPP eligibility guide",
    accountCheck: "YouTube Studio → Earn",
    indiaNote: "Use the India-specific help page, then confirm country, channel and feature eligibility in the channel's own Earn tab.",
    limitation: "A public help page cannot inspect this channel's eligibility, policy status, thresholds or payout setup."
  },
  {
    id: "facebook-content-monetization",
    platform: "Facebook",
    program: "Facebook Content Monetization",
    programType: "native-monetization",
    sourceUrl: "https://about.fb.com/news/2026/03/creator-fast-track-grow-your-audience-earn-money-on-facebook/",
    sourceLabel: "Meta official 2026 creator monetization update",
    accountCheck: "Facebook Professional dashboard → Monetization",
    indiaNote: "Check the exact account and country in Professional dashboard. Meta describes access as invite-based; public announcements do not establish this account's availability.",
    limitation: "A reachable announcement does not mean this profile or Page has an invitation, is eligible in India, or has an approved payout account."
  },
  {
    id: "instagram-creator-marketplace",
    platform: "Instagram",
    program: "Instagram Creator Marketplace",
    programType: "brand-partnerships",
    sourceUrl: "https://about.fb.com/news/2024/02/creator-marketplace-for-brands-and-creators-to-collaborate-on-instagram/",
    sourceLabel: "Meta official Creator Marketplace expansion announcement",
    accountCheck: "Instagram Professional dashboard → Creator Marketplace",
    indiaNote: "Meta's announcement included India in the planned creator-marketplace rollout. Confirm present access and eligibility in this professional account.",
    limitation: "Public documentation does not reveal account invitations, available projects, negotiated rates or creator eligibility."
  }
]);

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      const number = Number(code);
      return Number.isInteger(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const number = Number.parseInt(code, 16);
      return Number.isInteger(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : "";
    });
}

function cleanText(value, max = 500) {
  return decodeEntities(String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()).slice(0, max);
}

function isApprovedSourceUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" &&
      ALLOWED_SOURCE_HOSTS.has(url.hostname.toLowerCase()) &&
      !url.username && !url.password && (!url.port || url.port === "443");
  } catch {
    return false;
  }
}

function readMetaContent(html, name) {
  const target = String(name || "").toLowerCase();
  for (const match of String(html || "").matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = {};
    for (const attr of match[0].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attributes[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4] ?? "";
    }
    if (String(attributes.name || attributes.property || "").toLowerCase() === target) {
      return cleanText(attributes.content, 500);
    }
  }
  return "";
}

function extractPageMetadata(html) {
  const source = String(html || "");
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(source);
  return {
    pageTitle: titleMatch ? cleanText(titleMatch[1], 180) : "",
    pageDescription: readMetaContent(source, "description") || readMetaContent(source, "og:description")
  };
}

async function checkSource(source, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now == null ? Date.now() : Number(options.now);
  const checkedAt = new Date(now).toISOString();

  const base = {
    ...source,
    status: "unavailable",
    checkedAt,
    httpStatus: null,
    finalUrl: "",
    pageTitle: "",
    pageDescription: "",
    error: ""
  };

  if (!isApprovedSourceUrl(source.sourceUrl)) {
    return { ...base, error: "Source URL is not in the approved HTTPS host list." };
  }
  if (typeof fetchImpl !== "function") {
    return { ...base, error: "Fetch is not available in this runtime." };
  }

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
    ? Math.min(options.timeoutMs, 30000)
    : DEFAULT_TIMEOUT_MS;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetchImpl(source.sourceUrl, {
      method: "GET",
      redirect: "follow",
      credentials: "omit",
      headers: { Accept: "text/html,application/xhtml+xml" },
      signal: controller ? controller.signal : undefined
    });
    const status = Number(response && response.status);
    const httpStatus = Number.isInteger(status) ? status : null;
    if (!response || !(response.ok === true || (httpStatus >= 200 && httpStatus < 300))) {
      return { ...base, httpStatus, error: "Official source returned HTTP " + (httpStatus || "no response") + "." };
    }

    const finalUrl = String(response.url || source.sourceUrl);
    if (!isApprovedSourceUrl(finalUrl)) {
      return { ...base, httpStatus, error: "Official source redirected outside the approved HTTPS host list." };
    }

    const contentType = response.headers && typeof response.headers.get === "function"
      ? String(response.headers.get("content-type") || "").toLowerCase()
      : "";
    if (contentType && !/(?:text\/html|application\/xhtml\+xml)/i.test(contentType)) {
      return { ...base, httpStatus, finalUrl, error: "Official source returned an unexpected content type." };
    }

    const contentLength = response.headers && typeof response.headers.get === "function"
      ? Number(response.headers.get("content-length"))
      : NaN;
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      return { ...base, httpStatus, finalUrl, error: "Official source page exceeded the 2 MB response limit." };
    }

    const html = await response.text();
    if (Buffer.byteLength(html, "utf8") > MAX_RESPONSE_BYTES) {
      return { ...base, httpStatus, finalUrl, error: "Official source page exceeded the 2 MB response limit." };
    }
    if (!/<(?:html|head|body|title)\b/i.test(html)) {
      return { ...base, httpStatus, finalUrl, error: "Official source response was not recognisable HTML." };
    }

    return {
      ...base,
      status: "available",
      httpStatus,
      finalUrl,
      ...extractPageMetadata(html)
    };
  } catch (error) {
    const message = error && error.name === "AbortError"
      ? "Official source check timed out."
      : cleanText(error && error.message, 240) || "Official source could not be reached.";
    return { ...base, error: message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function scanSources(options = {}) {
  const now = options.now == null ? Date.now() : Number(options.now);
  if (!Number.isFinite(now) || now < 0) throw new TypeError("now must be a non-negative timestamp.");
  const sources = await Promise.all(SOURCE_REGISTRY.map((source) => checkSource(source, { ...options, now })));
  const available = sources.filter((source) => source.status === "available").length;
  const failed = sources.length - available;
  const status = available === sources.length ? "success" : available > 0 ? "partial" : "failed";
  return {
    schemaVersion: 1,
    country: "IN",
    scope: "official-public-source-reachability-only",
    generatedAt: new Date(now).toISOString(),
    status,
    summary: {
      sourcesAttempted: sources.length,
      sourcesAvailable: available,
      sourcesUnavailable: failed,
      accountEligibilityChecksRequired: sources.length
    },
    limitations: [
      "This scan checks only whether allowlisted official public documentation pages can be fetched and reads their page title/description.",
      "It does not sign in, read private creator dashboards, discover private invitations, verify account eligibility, determine live campaign availability, or verify payouts.",
      "A reachable source page is not evidence that an account is eligible or that earnings are available."
    ],
    sources
  };
}

function writeSnapshot(snapshot, outputPath = path.join(__dirname, "..", "creator-programs-snapshot.json")) {
  const destination = path.resolve(outputPath);
  fs.writeFileSync(destination, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  return destination;
}

function appendSummary(snapshot, env = process.env) {
  if (!env.GITHUB_STEP_SUMMARY) return false;
  const lines = [
    "## Official creator-program source monitor",
    "",
    "- **Status:** " + snapshot.status,
    "- **Official pages:** " + snapshot.summary.sourcesAvailable + " reachable / " +
      snapshot.summary.sourcesAttempted + " attempted / " + snapshot.summary.sourcesUnavailable + " unavailable",
    "- **Account eligibility:** not checked; each account must be verified in its official dashboard.",
    "",
    "| Platform | Program | Public source check |",
    "|---|---|---|",
    ...snapshot.sources.map((source) => "| " + source.platform + " | " + source.program + " | " +
      (source.status === "available" ? "Reachable" : "Unavailable: " + (source.error || "unknown error")) + " |")
  ];
  fs.appendFileSync(env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  return true;
}

async function main() {
  const snapshot = await scanSources();
  const outputPath = writeSnapshot(snapshot);
  appendSummary(snapshot);
  process.stdout.write(
    "Creator-program source monitor: " + snapshot.status + " · " +
    snapshot.summary.sourcesAvailable + "/" + snapshot.summary.sourcesAttempted +
    " official public pages reachable · snapshot: " + outputPath + "\n"
  );
  if (snapshot.status !== "success") process.stdout.write("::warning::One or more official program pages could not be checked.\n");
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  });
}

module.exports = {
  ALLOWED_SOURCE_HOSTS,
  MAX_RESPONSE_BYTES,
  SOURCE_REGISTRY,
  isApprovedSourceUrl,
  extractPageMetadata,
  checkSource,
  scanSources,
  writeSnapshot,
  appendSummary
};
