(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClipRewardScout = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PLATFORM_NAMES = [
    ["TikTok", /\btiktok\b/i],
    ["Instagram", /\binstagram\b|\bIG\b/i],
    ["YouTube", /\byoutube\b|\bYT\b/i],
    ["X", /(?:^|\W)X(?:$|\W)|\btwitter\b/i],
    ["Facebook", /\bfacebook\b|\bFB\b/i]
  ];
  const CATEGORY_NAMES = [
    "Finance", "Gaming", "Entertainment", "Technology", "Health & Wellness",
    "Music", "Podcasts", "Lifestyle", "Education", "Apps", "Sports", "Beauty"
  ];

  function clean(value, max = 500) {
    return String(value == null ? "" : value).replace(/\r/g, "").trim().slice(0, max);
  }

  function parseAmount(raw) {
    const match = /([$€£₹]|USD|EUR|GBP|INR)\s*([\d,]+(?:\.\d+)?)\s*([kKmM]?)/i.exec(raw || "");
    if (!match) return null;
    let value = Number(match[2].replace(/,/g, ""));
    const suffix = match[3].toLowerCase();
    if (suffix === "k") value *= 1000;
    if (suffix === "m") value *= 1000000;
    const symbol = match[1].toUpperCase();
    const currency = ({ "$": "USD", "€": "EUR", "£": "GBP", "₹": "INR", USD: "USD", EUR: "EUR", GBP: "GBP", INR: "INR" })[symbol];
    return Number.isFinite(value) ? { value, currency, raw: match[0].trim() } : null;
  }

  function formatAmount(amount) {
    if (!amount) return "Not stated";
    const symbol = ({ USD: "$", EUR: "€", GBP: "£", INR: "₹" })[amount.currency] || amount.currency + " ";
    return symbol + new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(amount.value);
  }

  function parseBudget(text) {
    const pair = /([$€£₹]\s*[\d,]+(?:\.\d+)?\s*[kKmM]?)\s*\/\s*([$€£₹]\s*[\d,]+(?:\.\d+)?\s*[kKmM]?)/.exec(text);
    if (pair) {
      const spent = parseAmount(pair[1]);
      const total = parseAmount(pair[2]);
      if (spent && total && spent.currency === total.currency && total.value >= spent.value) {
        return { spent, total, remaining: { value: total.value - spent.value, currency: total.currency } };
      }
    }
    const labelled = /(?:total\s+budget|campaign\s+budget|budget|pool|budget\s+size)\s*[:=-]?\s*([$€£₹]\s*[\d,]+(?:\.\d+)?\s*[kKmM]?)/i.exec(text);
    const total = labelled ? parseAmount(labelled[1]) : null;
    return total ? { spent: null, total, remaining: null } : null;
  }

  function parseRate(text) {
    const cpm = /([$€£₹]\s*[\d,]+(?:\.\d+)?)\s*(?:\/\s*(?:1\s*,?\s*000|1k)|per\s*1\s*,?\s*000(?:\s+views?)?|cpm\b)/i.exec(text);
    if (cpm) {
      const amount = parseAmount(cpm[1]);
      return amount ? { model: "CPM", amount, label: formatAmount(amount) + " per 1,000 views" } : null;
    }
    const perPost = /([$€£₹]\s*[\d,]+(?:\.\d+)?\s*[kKmM]?)\s*(?:per\s+(?:post|video|clip)|\/\s*(?:post|video|clip))/i.exec(text);
    if (perPost) {
      const amount = parseAmount(perPost[1]);
      return amount ? { model: "Per post", amount, label: formatAmount(amount) + " per post" } : null;
    }
    if (/\bretainer\b/i.test(text)) return { model: "Retainer", amount: null, label: "Retainer (amount not parsed)" };
    return null;
  }

  function findTitle(lines) {
    const explicit = lines.find((line) => /^(?:campaign|title|name)\s*:/i.test(line));
    if (explicit) return clean(explicit.replace(/^(?:campaign|title|name)\s*:/i, ""), 120);
    const candidate = lines.find((line) => {
      if (line.length < 4 || line.length > 120) return false;
      if (/^(discover|all campaigns|campaign details|brief|overview|requirements|platforms?|budget|rate)\b/i.test(line)) return false;
      if (/^https?:\/\//i.test(line)) return false;
      return true;
    });
    return clean(candidate || "", 120);
  }

  function parseDeadline(text) {
    const iso = /(?:deadline|ends?|end date|expires?)\s*[:=-]?\s*(20\d{2}-\d{2}-\d{2})/i.exec(text);
    if (iso) {
      const date = new Date(iso[1] + "T00:00:00Z");
      if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso[1]) return iso[1];
    }
    return "";
  }

  function parseCampaignBrief(input) {
    const source = input && typeof input === "object" ? input : {};
    const rawText = clean(source.text, 20000);
    if (rawText.length < 12) throw new Error("Paste the public campaign card or brief text first.");
    const lines = rawText.split("\n").map((line) => clean(line, 500)).filter(Boolean);
    const title = findTitle(lines);
    const rate = parseRate(rawText);
    const budget = parseBudget(rawText);
    const platforms = PLATFORM_NAMES.filter(([, pattern]) => pattern.test(rawText)).map(([name]) => name);
    const category = CATEGORY_NAMES.find((name) => new RegExp("\\b" + name.replace(/[.*+?^|]/g, "\\$&") + "\\b", "i").test(rawText)) || "";
    const requirementLines = lines.filter((line) =>
      /require|must\b|minimum|min\b|maximum|max\b|eligible|eligib|original|disclos|language|country|region|follower|views?|tag|hashtag|watermark|no\s+repost|no\s+collab|deadline|apply|approval/i.test(line)
    ).slice(0, 8);
    const deadline = parseDeadline(rawText);
    const entryMode = /\bapply\b|\bapplication\b/i.test(rawText)
      ? "Application / brand review"
      : /join\s+campaign|join\s+now/i.test(rawText)
        ? "Open campaign / direct join"
        : "";
    const url = clean(source.url, 500);
    let sourceUrl = "";
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password &&
          (parsed.hostname === "contentrewards.com" || parsed.hostname.endsWith(".contentrewards.com"))) {
        sourceUrl = parsed.href;
      }
    } catch (_) {}

    const findings = [];
    if (title) findings.push({ kind: "found", label: "Campaign name", value: title });
    if (rate) findings.push({ kind: "found", label: "Payout model", value: rate.label });
    if (budget) findings.push({ kind: "found", label: "Campaign budget", value: budget.spent
      ? formatAmount(budget.spent) + " used / " + formatAmount(budget.total) + " total" +
        (budget.remaining ? " / " + formatAmount(budget.remaining) + " remaining" : "")
      : formatAmount(budget.total) + " total" });
    if (platforms.length) findings.push({ kind: "found", label: "Platforms", value: platforms.join(", ") });
    if (category) findings.push({ kind: "found", label: "Category", value: category });
    if (deadline) findings.push({ kind: "found", label: "Deadline", value: deadline });
    if (entryMode) findings.push({ kind: "found", label: "Joining method", value: entryMode });
    if (requirementLines.length) findings.push({ kind: "found", label: "Brief requirements", value: requirementLines.length + " requirement line(s) detected" });

    const missing = [];
    if (!rate) missing.push("Payout rate/model not found");
    if (!budget) missing.push("Campaign budget not found");
    if (!platforms.length) missing.push("Accepted platform not found");
    if (!requirementLines.length) missing.push("Eligibility/brief requirements not found");
    if (!deadline) missing.push("Deadline not stated or not recognised");
    if (!sourceUrl) missing.push("Official Content Rewards campaign URL not supplied");
    const extractedCount = findings.length;
    const confidence = extractedCount >= 5 ? "Good extraction" : extractedCount >= 3 ? "Partial extraction" : "Limited extraction";

    return {
      title,
      sourceUrl,
      deadline,
      entryMode,
      rate,
      budget,
      platforms,
      category,
      requirementLines,
      findings,
      missing,
      confidence,
      rawExcerpt: rawText.slice(0, 1400)
    };
  }

  function buildTrackerNotes(result) {
    const lines = [
      "Imported from Content Rewards public brief — verify against the official campaign page.",
      "Detected payout: " + (result.rate ? result.rate.label : "Not found"),
      "Detected budget: " + (result.budget ? (result.budget.spent ? formatAmount(result.budget.spent) + " used / " : "") + formatAmount(result.budget.total) + " total" + (result.budget.remaining ? " / " + formatAmount(result.budget.remaining) + " remaining" : "") : "Not found"),
      "Joining method: " + (result.entryMode || "Not stated — check the official campaign page"),
      "Detected platforms: " + (result.platforms.length ? result.platforms.join(", ") : "Not found"),
      "Detected category: " + (result.category || "Not found"),
      "Deadline: " + (result.deadline || "Not found")
    ];
    if (result.requirementLines.length) {
      lines.push("Brief requirements (review the full official brief):");
      result.requirementLines.forEach((line) => lines.push("- " + line));
    }
    lines.push("Source excerpt: " + result.rawExcerpt.replace(/\s+/g, " ").slice(0, 500));
    return lines.join("\n").slice(0, 2000);
  }

  return Object.freeze({ parseCampaignBrief, buildTrackerNotes, formatAmount });
});
