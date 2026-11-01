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
    id: "youtube-expanded-ypp",
    platform: "YouTube",
    program: "Expanded YouTube Partner Program access",
    programType: "early-access-monetization-features",
    sourceUrl: "https://support.google.com/youtube/answer/13429240?hl=en-IN",
    sourceLabel: "YouTube official expanded YPP guide",
    accountCheck: "YouTube Studio → Earn",
    indiaNote: "The expanded YPP guide lists country-specific availability and earlier access to selected fan-funding/Shopping features. Check India availability and this channel's exact feature status in Studio.",
    limitation: "The lower expanded-YPP threshold is not the full ad-revenue threshold. A public guide cannot inspect this channel's country, policy status or feature access."
  },
  {
    id: "facebook-content-monetization",
    platform: "Facebook",
    program: "Creator Fast Track and Facebook Content Monetization",
    programType: "invitation-based-native-monetization",
    sourceUrl: "https://about.fb.com/news/2026/03/creator-fast-track-grow-your-audience-earn-money-on-facebook/",
    sourceLabel: "Meta official 2026 creator monetization update",
    accountCheck: "Facebook Professional dashboard → Monetization",
    indiaNote: "The 2026 Creator Fast Track announcement describes a distinct invitation-based route with follower-based tiers. It is not a general eligibility threshold for all Facebook monetization. Check the exact account in Professional dashboard.",
    limitation: "Public documentation does not reveal whether this profile/Page has an invitation, qualifies for Fast Track, has access to Content Monetization, or has an approved payout account."
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

function extractVisibleText(html) {
  return decodeEntities(String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, 60000);
}

function extractRuleEvidence(source, html) {
  const text = extractVisibleText(html);
  const rules = {
    "youtube-ypp": [
      {
        key: "standard-watch-hours",
        label: "Full YPP · long-form route",
        pattern: /1,000 subscribers.{0,240}?4,000 (?:(?:qualified|valid) )?(?:public )?watch hours?.{0,100}?(?:last|past) 12 months?/i,
        interpretation: "This is a public threshold route for the full YPP application; channel policy review and other account requirements still apply."
      },
      {
        key: "standard-shorts-views",
        label: "Full YPP · Shorts route",
        pattern: /1,000 subscribers.{0,240}?10 million (?:(?:qualified|valid) )?(?:public )?shorts views?.{0,100}?(?:last|past) 90 days?/i,
        interpretation: "This is an alternative public threshold route for the full YPP application; qualified views and channel review rules still apply."
      }
    ],
    "youtube-expanded-ypp": [
      {
        key: "expanded-ypp-watch-hours",
        label: "Expanded YPP · earlier access",
        pattern: /500 subscribers.{0,260}?3 valid public uploads?.{0,260}?3,000 (?:(?:qualified|valid) )?(?:public )?watch hours?.{0,100}?(?:last|past) 12 months?/i,
        interpretation: "This lower threshold is for earlier access to selected YPP features in eligible countries; it is not the full ad-revenue threshold."
      },
      {
        key: "expanded-ypp-shorts-views",
        label: "Expanded YPP · Shorts route",
        pattern: /500 subscribers.{0,260}?3 valid public uploads?.{0,260}?3 million (?:(?:qualified|valid) )?(?:public )?shorts views?.{0,100}?(?:last|past) 90 days?/i,
        interpretation: "This lower threshold is for earlier access to selected YPP features in eligible countries; it is not the full ad-revenue threshold."
      }
    ],
    "facebook-content-monetization": [
      {
        key: "facebook-invite-only",
        label: "Content Monetization access",
        pattern: /content monetization.{0,180}?invite-only/i,
        interpretation: "Meta describes Content Monetization as invite-only in this announcement. An interest form is not an invitation, approval or earnings confirmation. Check the account's Professional Dashboard for its real status."
      },
      {
        key: "facebook-interest-form",
        label: "Express interest",
        pattern: /professional dashboard.{0,220}?interest form/i,
        interpretation: "The public announcement describes an in-product interest route. Sending interest is not an invitation, approval or earnings confirmation."
      },
      {
        key: "creator-fast-track-100k",
        label: "Creator Fast Track · 100K tier",
        pattern: /\$1,000 per month.{0,180}?100,000 followers/i,
        interpretation: "This amount is described for the separate Creator Fast Track route and a stated follower tier; it is not a general Facebook monetization rate or a promise to this account."
      },
      {
        key: "creator-fast-track-1m",
        label: "Creator Fast Track · 1M tier",
        pattern: /\$3,000 per month.{0,180}?one million followers/i,
        interpretation: "This amount is described for the separate Creator Fast Track route and a stated follower tier; it is not a general Facebook monetization rate or a promise to this account."
      }
    ],
    "instagram-creator-marketplace": [
      {
        key: "instagram-india-rollout",
        label: "India rollout reference",
        pattern: /invite creators and brands based in[^.]{0,240}?India/i,
        interpretation: "Meta's 2024 announcement named India in its planned Creator Marketplace expansion. This historical rollout reference does not prove current access for a specific account."
      },
      {
        key: "instagram-professional-dashboard",
        label: "Creator entry point",
        pattern: /creators join from their professional dashboard/i,
        interpretation: "The public guide describes the Instagram Professional Dashboard as the creator entry point. Check whether Creator Marketplace appears in this account."
      },
      {
        key: "instagram-partnership-messages",
        label: "Brand partnership workflow",
        pattern: /partnership messages folder/i,
        interpretation: "The guide describes a dedicated partnership message route. Rates and project availability depend on the individual brand agreement."
      }
    ]
  };
  const definitions = rules[source && source.id] || [];
  const evidence = [];
  for (const rule of definitions) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    const start = Math.max(0, match.index - 70);
    const end = Math.min(text.length, match.index + match[0].length + 90);
    evidence.push({
      key: rule.key,
      label: rule.label,
      excerpt: cleanText(text.slice(start, end), 360),
      interpretation: rule.interpretation
    });
  }
  return evidence;
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
    ruleEvidence: [],
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
      ...extractPageMetadata(html),
      ruleEvidence: extractRuleEvidence(source, html)
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
    scope: "official-public-source-reachability-and-limited-rule-extraction",
    generatedAt: new Date(now).toISOString(),
    status,
    summary: {
      sourcesAttempted: sources.length,
      sourcesAvailable: available,
      sourcesUnavailable: failed,
      sourcesWithRuleEvidence: sources.filter((source) => source.ruleEvidence.length > 0).length,
      ruleEvidenceCount: sources.reduce((total, source) => total + source.ruleEvidence.length, 0),
      accountEligibilityChecksRequired: sources.length
    },
    limitations: [
      "This scan fetches allowlisted official public pages and extracts only selected rule snippets; extraction is a helper, not a complete or account-specific policy interpretation.",
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
    "- **Public rule signals extracted:** " + snapshot.summary.ruleEvidenceCount + " across " + snapshot.summary.sourcesWithRuleEvidence + " sources.",
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

function isPublishableSnapshot(snapshot) {
  return Boolean(snapshot && (snapshot.status === "success" || snapshot.status === "partial"));
}

async function main(options = {}) {
  const snapshot = await scanSources(options);
  const outputPath = writeSnapshot(snapshot, options.outputPath);
  appendSummary(snapshot, options.env || process.env);
  process.stdout.write(
    "Creator-program source monitor: " + snapshot.status + " · " +
    snapshot.summary.sourcesAvailable + "/" + snapshot.summary.sourcesAttempted +
    " official public pages reachable · snapshot: " + outputPath + "\n"
  );
  if (snapshot.status !== "success") process.stdout.write("::warning::One or more official program pages could not be checked.\n");
  return snapshot;
}

if (require.main === module) {
  main().then((snapshot) => {
    if (!isPublishableSnapshot(snapshot)) {
      process.stderr.write("::error::All official creator-program pages were unavailable; do not replace the last known-good published snapshot.\n");
      process.exitCode = 1;
    }
  }).catch((error) => {
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
  extractVisibleText,
  extractRuleEvidence,
  checkSource,
  scanSources,
  isPublishableSnapshot,
  main,
  writeSnapshot,
  appendSummary
};
