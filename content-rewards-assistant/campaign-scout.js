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
  const INDIA_UNAVAILABLE_PLATFORMS = Object.freeze(["TikTok"]);
  const CATEGORY_NAMES = [
    "Finance", "Gaming", "Entertainment", "Technology", "Health & Wellness",
    "Music", "Podcasts", "Lifestyle", "Education", "Apps", "Sports", "Beauty"
  ];
  const GENERIC_TITLES = /^(discover|all campaigns|campaign details|brief|overview|requirements|platforms?|budget|rate|creator campaign|creator brief|campaign|open campaign|apply now|join campaign|new campaign)$/i;

  function clean(value, max = 500) {
    return String(value == null ? "" : value).replace(/\r/g, "").trim().slice(0, max);
  }

  function parseCount(raw) {
    const match = /([\d,]+(?:\.\d+)?)\s*([kKmM]?)(?=\s|$|[,.;:/])/.exec(String(raw || ""));
    if (!match) return null;
    let value = Number(match[1].replace(/,/g, ""));
    const suffix = match[2].toLowerCase();
    if (suffix === "k") value *= 1000;
    if (suffix === "m") value *= 1000000;
    return Number.isSafeInteger(Math.round(value)) && Number.isFinite(value) ? Math.round(value) : null;
  }

  function parseAmount(raw, fallbackCurrency = "") {
    const match = /([$€£₹]|USD|EUR|GBP|INR)[ \t]*([\d,]+(?:\.\d+)?)[ \t]*([kKmM]?)(?=[ \t]|$|[,.;:/]|\r?\n)/i.exec(raw || "");
    if (match) {
      let value = Number(match[2].replace(/,/g, ""));
      const suffix = match[3].toLowerCase();
      if (suffix === "k") value *= 1000;
      if (suffix === "m") value *= 1000000;
      const symbol = match[1].toUpperCase();
      const currency = ({ "$": "USD", "€": "EUR", "£": "GBP", "₹": "INR", USD: "USD", EUR: "EUR", GBP: "GBP", INR: "INR" })[symbol];
      return Number.isFinite(value) ? { value, currency, raw: match[0].trim() } : null;
    }
    const suffix = /\b([\d,]+(?:\.\d+)?)[ \t]*([kKmM]?)(?=[ \t]*(?:USD|EUR|GBP|INR)\b)[ \t]*(USD|EUR|GBP|INR)\b/i.exec(raw || "");
    if (suffix) {
      let value = Number(suffix[1].replace(/,/g, ""));
      if (suffix[2].toLowerCase() === "k") value *= 1000;
      if (suffix[2].toLowerCase() === "m") value *= 1000000;
      return Number.isFinite(value) ? { value, currency: suffix[3].toUpperCase(), raw: suffix[0].trim() } : null;
    }
    const bare = /([\d,]+(?:\.\d+)?)[ \t]*([kKmM]?)(?=[ \t]|$|[,.;:/]|\r?\n)/.exec(raw || "");
    if (!bare || !fallbackCurrency) return null;
    let value = Number(bare[1].replace(/,/g, ""));
    if (bare[2].toLowerCase() === "k") value *= 1000;
    if (bare[2].toLowerCase() === "m") value *= 1000000;
    return Number.isFinite(value) ? { value, currency: fallbackCurrency, raw: bare[0].trim() } : null;
  }

  function formatAmount(amount) {
    if (!amount) return "Not stated";
    const symbol = ({ USD: "$", EUR: "€", GBP: "£", INR: "₹" })[amount.currency] || amount.currency + " ";
    return symbol + new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(amount.value);
  }

  function parseBudget(text) {
    const raw = String(text || "");
    const pair = /((?:[$€£₹][ \t]*)?[\d,]+(?:\.\d+)?[ \t]*[kKmM]?)[ \t]*\/[ \t]*([$€£₹][ \t]*[\d,]+(?:\.\d+)?[ \t]*[kKmM]?)/.exec(raw);
    if (pair) {
      const total = parseAmount(pair[2]);
      const spent = parseAmount(pair[1], total && total.currency);
      if (spent && total && spent.currency === total.currency && total.value >= spent.value) {
        return {
          spent,
          total,
          remaining: { value: total.value - spent.value, currency: total.currency },
          source: "spent / total"
        };
      }
    }

    const remainingMatch = /(?:remaining\s+budget|budget\s*(?:left|remaining)|left\s+(?:in\s+)?(?:the\s+)?budget|budget\s+available)\s*[:=-]?\s*([$€£₹]\s*[\d,]+(?:\.\d+)?\s*[kKmM]?|(?:USD|EUR|GBP|INR)\s*[\d,]+(?:\.\d+)?\s*[kKmM]?)/i.exec(raw);
    const totalMatch = /(?:total\s+budget|campaign\s+budget|funded\s+budget|budget\s+size|total\s+funding|budget)\s*[:=-]?\s*([$€£₹]\s*[\d,]+(?:\.\d+)?\s*[kKmM]?|(?:USD|EUR|GBP|INR)\s*[\d,]+(?:\.\d+)?\s*[kKmM]?)/i.exec(raw);
    const spentMatch = /(?:budget\s+used|spent|used)\s*[:=-]?\s*([$€£₹]\s*[\d,]+(?:\.\d+)?\s*[kKmM]?|(?:USD|EUR|GBP|INR)\s*[\d,]+(?:\.\d+)?\s*[kKmM]?)/i.exec(raw);
    const remaining = remainingMatch ? parseAmount(remainingMatch[1]) : null;
    const total = totalMatch ? parseAmount(totalMatch[1]) : null;
    const spent = spentMatch ? parseAmount(spentMatch[1]) : null;

    if (remaining || total || spent) {
      const currency = (remaining || total || spent).currency;
      if ((remaining && remaining.currency !== currency) || (total && total.currency !== currency) || (spent && spent.currency !== currency)) {
        return { spent: null, total: null, remaining: null, source: "currency conflict", currencyConflict: true };
      }
      const derivedRemaining = remaining || (total && spent && total.value >= spent.value
        ? { value: total.value - spent.value, currency }
        : null);
      return { spent, total, remaining: derivedRemaining, source: remaining ? "remaining" : total && spent ? "spent / total" : total ? "total" : "spent" };
    }
    return null;
  }

  function parseRate(text) {
    const raw = String(text || "");
    const money = "([$€£₹]\\s*[\\d,]+(?:\\.\\d+)?\\s*[kKmM]?(?=\\s|$|[,.;:/+])|(?:USD|EUR|GBP|INR)\\s*[\\d,]+(?:\\.\\d+)?\\s*[kKmM]?(?=\\s|$|[,.;:/+])|[\\d,]+(?:\\.\\d+)?\\s*[kKmM]?(?=\\s|$|[,.;:/+])\\s*(?:USD|EUR|GBP|INR))";
    let match = new RegExp(money + "\\s*(?:\\/\\s*(?:1\\s*,?\\s*000|1k)|per\\s*1\\s*,?\\s*000(?:\\s+views?)?|\\bCPM\\b)", "i").exec(raw);
    if (!match) {
      match = new RegExp("\\b(?:per\\s*1\\s*,?\\s*000|per\\s*1k)\\s+views?\\s*[:=-]?\\s*" + money, "i").exec(raw);
      if (match) {
        const amount = parseAmount(match[1]);
        if (amount) return { model: "CPM", amount, label: formatAmount(amount) + " per 1,000 views" };
      }
      match = new RegExp("\\bCPM\\b\\s*[:=-]?\\s*" + money, "i").exec(raw);
      if (match) {
        const amount = parseAmount(match[0].replace(/^\s*CPM\s*[:=-]?\s*/i, ""));
        if (amount) return { model: "CPM", amount, label: formatAmount(amount) + " per 1,000 views" };
      }
    }
    if (match) {
      const amount = parseAmount(match[1]);
      if (amount) return { model: "CPM", amount, label: formatAmount(amount) + " per 1,000 views" };
    }

    match = new RegExp(money + "\\s*(?:per\\s+(?:approved\\s+)?(?:post|video|clip)|\\/\\s*(?:post|video|clip))", "i").exec(raw);
    if (!match) {
      match = new RegExp("(?:per\\s+(?:approved\\s+)?(?:post|video|clip)|flat\\s+fee)\\s*[:=-]?\\s*" + money, "i").exec(raw);
      if (match) {
        const amount = parseAmount(match[0].replace(/^(?:per\\s+(?:approved\\s+)?(?:post|video|clip)|flat\\s+fee)\\s*[:=-]?\\s*/i, ""));
        if (amount) return { model: "Per post", amount, label: formatAmount(amount) + " per post" };
      }
    }
    if (match) {
      const amount = parseAmount(match[1]);
      if (amount) return { model: "Per post", amount, label: formatAmount(amount) + " per post" };
    }

    const retainer = new RegExp("\\bretainer\\b(?:\\s*(?:amount|rate|payment))?\\s*[:=-]?\\s*" + money, "i").exec(raw);
    if (retainer) {
      const amount = parseAmount(retainer[1]);
      return { model: "Retainer", amount, label: amount ? formatAmount(amount) + " retainer" : "Retainer (amount not parsed)" };
    }
    if (/\bretainer\b/i.test(raw)) return { model: "Retainer", amount: null, label: "Retainer (amount not parsed)" };

    if (/\b(?:payout|reward|payment)\s*(?:model|type)?\s*[:=-]?\s*pool\b|\bpool[- ]based\s+(?:payout|reward)\b|\bpool\s+campaign\b|\bprize\s+pool\b/i.test(raw)) {
      return { model: "Pool", amount: null, label: "Pool — variable allocation depends on the campaign's pool rules and eligible views" };
    }
    return null;
  }

  function findTitle(lines) {
    const explicit = lines.find((line) => /^(?:campaign|title|name)\s*:/i.test(line));
    if (explicit) {
      const value = clean(explicit.replace(/^(?:campaign|title|name)\s*:/i, ""), 120);
      if (value && !GENERIC_TITLES.test(value)) return value;
    }
    const candidates = lines.filter((line) => {
      if (line.length < 4 || line.length > 120) return false;
      if (GENERIC_TITLES.test(line) || /^(discover|all campaigns|campaign details|brief|overview|requirements|platforms?|budget|rate|creator campaign|creator brief)\b/i.test(line)) return false;
      if (/^https?:\/\//i.test(line) || /^[$€£₹\d]/.test(line)) return false;
      if (/^(?:campaign|title|name)\s*:/i.test(line)) return false;
      if (/^(?:join|apply|application|deadline|ends?|expires?|minimum|maximum|budget|rate|platforms?|accepting|launched)\b/i.test(line)) return false;
      if (/^(?:tiktok|instagram|facebook|youtube|twitter|x|music|clipping|logo|ugc|cpm|top clippers|views|budget|reference materials|creator requirements)$/i.test(line)) return false;
      return true;
    });
    const candidate = candidates.find((line) => (/[|–—]/.test(line) || line.includes(" - ")) && line.length >= 16) ||
      candidates.find((line) => line.length >= 18) || candidates[0];
    return clean(candidate || "", 120);
  }

  function parseDeadline(text) {
    const monthMap = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    const iso = /(?:deadline|ends?|end date|expires?|application closes?)\s*[:=-]?\s*(20\d{2}-\d{2}-\d{2})/i.exec(text);
    if (iso) {
      const date = new Date(iso[1] + "T00:00:00Z");
      if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso[1]) return iso[1];
    }
    const monthFirst = /(?:deadline|ends?|end date|expires?|application closes?)\s*[:=-]?\s*([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(20\d{2})/i.exec(text);
    const dayFirst = /(?:deadline|ends?|end date|expires?|application closes?)\s*[:=-]?\s*(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})/i.exec(text);
    const named = monthFirst || dayFirst;
    if (named) {
      const month = monthMap[(monthFirst ? named[1] : named[2]).slice(0, 3).toLowerCase()];
      const day = Number(monthFirst ? named[2] : named[1]);
      const year = Number(named[3]);
      if (month && day >= 1 && day <= 31) {
        const normalized = year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
        const date = new Date(normalized + "T00:00:00Z");
        if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === normalized) return normalized;
      }
    }
    return "";
  }

  function findCampaignUrl(inputUrl, rawText) {
    const candidates = [clean(inputUrl, 500)];
    const embedded = /https:\/\/(?:www\.)?(?:[a-z0-9-]+\.)*contentrewards\.com\/c\/[^\s<>"')\]]+/ig;
    let match;
    while ((match = embedded.exec(rawText)) !== null) candidates.push(match[0].replace(/[.,;!?]+$/, ""));
    for (const candidate of candidates) {
      try {
        const parsed = new URL(candidate);
        if (parsed.protocol === "https:" && !parsed.username && !parsed.password &&
            (parsed.hostname === "contentrewards.com" || parsed.hostname.endsWith(".contentrewards.com")) &&
            /^\/c\//.test(parsed.pathname)) return parsed.href;
      } catch (_) {}
    }
    return "";
  }

  function platformMentionsForLine(line) {
    return PLATFORM_NAMES.filter(([name, pattern]) => {
      if (!pattern.test(line)) return false;
      if (name !== "X") return true;
      return /\\btwitter\\b/i.test(line) ||
        /^\\s*(?:platform\\s*[:=-]?\\s*)?x\\s*$/i.test(line) ||
        /\\b(?:platforms?|accepted|supported|available|eligible)\\b/i.test(line) ||
        /\\b(?:post|publish|upload|share)\\b.{0,40}\\bx\\b/i.test(line) ||
        /\\bon\\s+x\\b/i.test(line);
    }).map(([name]) => name);
  }

  function isPlatformDeclarationLine(line, mentions) {
    if (!mentions.length) return false;
    if (mentions.length > 1) return true;
    const name = mentions[0].toLowerCase();
    if (line.trim().toLowerCase() === name || new RegExp("^\\\\s*platform\\\\s*[:=-]?\\\\s*" + name + "\\\\s*$", "i").test(line)) return true;
    if (/\\b(?:platforms?|accepted|supported|available|eligible)\\b/i.test(line)) return true;
    if (/\\b(?:publish|post|upload|share)\\b.{0,40}\\b(?:on|to)\\b/i.test(line)) return true;
    return false;
  }

  function extractPlatforms(lines) {
    const accepted = new Set();
    const excluded = new Set();
    const negative = /\\b(?:not\\s+(?:accepted|supported|allowed|available|eligible)|no|exclude[sd]?|unsupported|unavailable|do\\s+not|don't|must\\s+not|cannot|can't|prohibited|except)\\b/i;
    for (const line of lines) {
      const mentions = platformMentionsForLine(line);
      if (!isPlatformDeclarationLine(line, mentions)) continue;
      for (const name of mentions) {
        if (negative.test(line)) excluded.add(name);
        else accepted.add(name);
      }
    }
    for (const name of excluded) accepted.delete(name);
    return {
      accepted: PLATFORM_NAMES.filter(([name]) => accepted.has(name)).map(([name]) => name),
      excluded: PLATFORM_NAMES.filter(([name]) => excluded.has(name)).map(([name]) => name)
    };
  }

  function findMoneyNear(text, patterns) {
    const money = "([$€£₹]\\s*[\\d,]+(?:\\.\\d+)?\\s*[kKmM]?(?=\\s|$|[,.;:/+])|(?:USD|EUR|GBP|INR)\\s*[\\d,]+(?:\\.\\d+)?\\s*[kKmM]?(?=\\s|$|[,.;:/+])|[\\d,]+(?:\\.\\d+)?\\s*[kKmM]?(?=\\s|$|[,.;:/+])\\s*(?:USD|EUR|GBP|INR))";
    for (const pattern of patterns) {
      const before = new RegExp(pattern + "\\s*[:=-]?\\s*" + money, "i").exec(text);
      if (before) return parseAmount(before[1]);
      const after = new RegExp(money + "\\s*" + pattern, "i").exec(text);
      if (after) return parseAmount(after[1]);
    }
    return null;
  }

  function extractCap(text) {
    const amount = findMoneyNear(text, [
      "(?:maximum|max)\\s*(?:payout\\s*)?(?:per\\s+(?:clip|video|post)|per\\s+creator|cap)",
      "(?:per\\s+(?:clip|video|post)|clip\\s+cap)\\s*(?:maximum|max|cap)?",
      "(?:maximum|max)\\s+per\\s+clip",
      "(?:maximum|max)\\s+payout\\b"
    ]);
    return amount;
  }

  function extractPayoutBound(text, kind) {
    const label = kind === "minimum" ? "(?:minimum|min\\.?)\\s+payout\\b" : "(?:maximum|max\\.?)\\s+payout\\b";
    const lines = String(text || "").split("\n");
    let found = null;
    for (let index = 0; index < lines.length; index += 1) {
      const sample = [lines[index], lines[index + 1] || ""].join(" ");
      const amount = findMoneyNear(sample, [label]);
      if (amount) found = amount;
    }
    return found;
  }

  function detectLockedRequirements(text) {
    const raw = String(text || "");
    const match = /join\s+to\s+unlock\s+(\d+)\s+requirements?/i.exec(raw);
    const fileMatch = /reference\s+materials\s+(\d+)\s+files?/i.exec(raw);
    return {
      locked: /visible once you join|join to unlock/i.test(raw),
      count: match ? Number(match[1]) : null,
      referenceFiles: fileMatch ? Number(fileMatch[1]) : null
    };
  }

  function extractMinimumViews(text) {
    const match = /(?:minimum|min\.?)\s*(?:qualified\s*)?(?:views?|view count)\s*[:=-]?\s*([\d,]+(?:\.\d+)?\s*[kKmM]?)|(?:minimum|min\.?)\s*(?:qualified\s*)?([\d,]+(?:\.\d+)?\s*[kKmM]?)\s*(?:views?|view count)|([\d,]+(?:\.\d+)?\s*[kKmM]?)\s*(?:minimum|min\.?)\s+views?/i.exec(String(text || ""));
    const value = match && (match[1] || match[2] || match[3]);
    return value ? parseCount(value) : null;
  }

  function extractMaximumViews(text) {
    const match = /(?:maximum|max\.?)\s*(?:qualified\s*)?(?:views?|view count)\s*[:=-]?\s*([\d,]+(?:\.\d+)?\s*[kKmM]?)|(?:maximum|max\.?)\s*(?:qualified\s*)?([\d,]+(?:\.\d+)?\s*[kKmM]?)\s*(?:views?|view count)|([\d,]+(?:\.\d+)?\s*[kKmM]?)\s*(?:maximum|max\.?)\s+views?/i.exec(String(text || ""));
    const value = match && (match[1] || match[2] || match[3]);
    return value ? parseCount(value) : null;
  }

  function extractFollowers(text) {
    const match = /(?:minimum|min\.?|at\s+least)\s*([\d,]+(?:\.\d+)?\s*[kKmM]?)\s*(?:followers?|subscribers?)|([\d,]+(?:\.\d+)?\s*[kKmM]?)\s*(?:followers?|subscribers?)\s*(?:minimum|min\.?)/i.exec(text);
    const value = match && (match[1] || match[2]);
    return value ? parseCount(value) : null;
  }

  function extractDuration(text) {
    const range = /(?:video\s*)?(?:length|duration|between)?\s*[:=-]?\s*(\d{1,3})\s*(?:-|to)\s*(\d{1,3})\s*(?:seconds?|secs?|s)\b/i.exec(text);
    const min = /(?:minimum|min\.?|at\s+least)\s*(\d{1,3})\s*(?:seconds?|secs?|s)\b/i.exec(text);
    const max = /(?:maximum|max\.?|no\s+more\s+than|up\s+to)\s*(\d{1,3})\s*(?:seconds?|secs?|s)\b/i.exec(text);
    const minSeconds = range ? Number(range[1]) : min ? Number(min[1]) : null;
    const maxSeconds = range ? Number(range[2]) : max ? Number(max[1]) : null;
    return minSeconds != null || maxSeconds != null ? { minSeconds, maxSeconds } : null;
  }

  function extractCampaignType(text) {
    const match = /(?:campaign\s+type|content\s+type|type)\s*[:=-]\s*(clipping|music|logo|ugc)\b|\b(clipping|music|logo|ugc)\s+campaign\b/i.exec(text);
    const value = match && (match[1] || match[2]);
    if (value) return value.toUpperCase();
    const standalone = String(text || "").split("\n").find((line) => /^(clipping|music|logo|ugc)$/i.test(line.trim()));
    return standalone ? standalone.trim().toUpperCase() : "";
  }

  function extractAccessMode(text) {
    if (/\b(?:private|invitation[- ]only|invite[- ]only|invite only)\b/i.test(text)) return "Private / invitation-only";
    if (/\bapplication(?:s)?[- ]only\b|\bapply\s+to\s+join\b|\bapply\s+now\b|\bapplication\s+campaign\b/i.test(text)) return "Application / brand review";
    if (/\bopen\s+campaign\b|\bopen\s+to\s+all\b|\bjoin\s+campaign\b|\bjoin\s+now\b|\baccepting\s+clips\b/i.test(text)) return "Open campaign / direct join";
    return "";
  }

  function extractCampaignStatus(text) {
    if (/\b(?:paused|on\s+hold)\b/i.test(text)) return "Paused";
    if (/\b(?:ended|closed|expired|no\s+longer\s+accepting)\b/i.test(text)) return "Ended / closed";
    if (/\b(?:out\s+of\s+budget|budget\s+exhausted|no\s+budget\s+left)\b/i.test(text)) return "Out of budget";
    if (/\b(?:live|active|accepting\s+(?:creators|applications|clips|submissions)|open\s+campaign)\b/i.test(text)) return "Appears live in copied text";
    return "Not stated";
  }

  function extractPlatformTerms(lines) {
    const result = { rates: [], caps: [], minimumViews: [], maximumViews: [] };
    let activePlatform = "";
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const sample = [line, lines[index + 1] || "", lines[index + 2] || ""].join(" ");
      const mentions = platformMentionsForLine(line);
      if (mentions.length > 1 && isPlatformDeclarationLine(line, mentions)) {
        activePlatform = "";
        continue;
      }
      if (mentions.length === 1 && isPlatformDeclarationLine(line, mentions)) activePlatform = mentions[0];
      if (!activePlatform) continue;
      const rate = parseRate(line) || parseRate(sample);
      const hasMaximumPayoutLabel = /(?:maximum|max\\.?)\\s+payout\\b/i.test(line);
      const hasExplicitClipCapLabel = /(?:maximum|max\\.?)\\s*(?:per\\s+(?:clip|video|post)|clip\\s+cap)|(?:per\\s+(?:clip|video|post)|clip\\s+cap)\\s*(?:maximum|max\\.?|cap)?/i.test(line);
      const cap = hasMaximumPayoutLabel
        ? extractPayoutBound([line, lines[index + 1] || ""].join("\\n"), "maximum")
        : hasExplicitClipCapLabel
          ? extractCap([line, lines[index + 1] || ""].join(" "))
          : null;
      const minimumViews = extractMinimumViews(line) ?? extractMinimumViews(sample);
      const maximumViews = extractMaximumViews(line) ?? extractMaximumViews(sample);
      if (rate) result.rates.push({ platform: activePlatform, ...rate, evidence: clean(sample, 300) });
      if (cap) result.caps.push({ platform: activePlatform, amount: cap, evidence: clean([line, lines[index + 1] || ""].join(" "), 300) });
      if (minimumViews != null) result.minimumViews.push({ platform: activePlatform, value: minimumViews, evidence: clean(sample, 300) });
      if (maximumViews != null) result.maximumViews.push({ platform: activePlatform, value: maximumViews, evidence: clean(sample, 300) });
    }
    for (const key of Object.keys(result)) {
      result[key] = result[key].filter((item, index) => result[key].findIndex((other) => other.platform === item.platform) === index);
    }
    return result;
  }
  function extractPlatformRates(lines) {
    return extractPlatformTerms(lines).rates;
  }

  function extractRules(lines) {
    const rulePattern = /require|must\b|minimum|min\.?\b|maximum|max\.?\b|eligible|eligib|original|disclos|language|country|region|follower|\bviews?\b|\btag\b|hashtags?|watermark|repost|collab|deadline|apply|approval|duration|seconds?|format|vertical|ratio|caption|mention|music|audio|logo|asset|footage|source material|copyright|license|licensed|no\s+|don't|do\s+not|prohibit|avoid|forbidden|only\b|public\b|private\b/i;
    return lines.filter((line) => rulePattern.test(line)).slice(0, 60);
  }

  function extractRuleGroups(lines) {
    const groups = { eligibility: [], required: [], prohibited: [], creative: [], submission: [] };
    for (const line of lines) {
      if (/followers?|subscribers?|country|region|age|eligible|eligibility|account type|connected account/i.test(line)) groups.eligibility.push(line);
      if (/must\b|required|include|add\b|mention|hashtag|disclos|tag\b|post\b|publish|upload|submit/i.test(line)) groups.required.push(line);
      if (/\bno\b|don't|do not|must not|cannot|can't|prohibit|avoid|forbidden|watermark|repost|copyright|unlicensed/i.test(line)) groups.prohibited.push(line);
      if (/duration|seconds?|format|vertical|ratio|resolution|caption|hook|language|audio|music|logo|footage|asset|original|edit/i.test(line)) groups.creative.push(line);
      if (/deadline|within|before|after|approval|pre.?approval|submit|submission|public|post age|minutes?/i.test(line)) groups.submission.push(line);
    }
    for (const key of Object.keys(groups)) groups[key] = [...new Set(groups[key])].slice(0, 30);
    return groups;
  }

  function parseCampaignBrief(input) {
    const source = input && typeof input === "object" ? input : {};
    const requestedPlatform = ["Instagram", "Facebook", "YouTube", "X"].includes(source.requestedPlatform) ? source.requestedPlatform : "";
    const rawText = clean(source.text, 20000);
    if (rawText.length < 12) throw new Error("Paste the public campaign card or full brief text first.");
    const lines = rawText.split("\n").map((line) => clean(line, 700)).filter(Boolean);
    const title = findTitle(lines);
    const rate = parseRate(rawText);
    const budget = parseBudget(rawText);
    const platformData = extractPlatforms(lines);
    const platforms = platformData.accepted;
    const excludedPlatforms = platformData.excluded;
    const unsupportedPlatforms = platforms.filter((name) => INDIA_UNAVAILABLE_PLATFORMS.includes(name));
    const platformMatch = !requestedPlatform ? "not-selected" :
      excludedPlatforms.includes(requestedPlatform) ? "mismatch" :
      platforms.includes(requestedPlatform) ? "match" : platforms.length ? "mismatch" : "unknown";
    const category = CATEGORY_NAMES.find((name) => new RegExp("\\b" + name.replace(/[.*+?^|]/g, "\\$&") + "\\b", "i").test(rawText)) || "";
    const requirementLines = extractRules(lines);
    const deadline = parseDeadline(rawText);
    const entryMode = extractAccessMode(rawText);
    const sourceUrl = findCampaignUrl(source.url, rawText);
    const minimumPayout = extractPayoutBound(rawText, "minimum");
    const maximumPayout = extractPayoutBound(rawText, "maximum");
    const capPerClip = maximumPayout || extractCap(rawText);
    const hiddenRequirements = detectLockedRequirements(rawText);
    const minimumViews = extractMinimumViews(rawText);
    const maximumViews = extractMaximumViews(rawText);
    const minimumFollowers = extractFollowers(rawText);
    const duration = extractDuration(rawText);
    const platformTerms = extractPlatformTerms(lines);
    const platformRates = platformTerms.rates;
    const platformCaps = platformTerms.caps;
    const platformMinimumViews = platformTerms.minimumViews;
    const platformMaximumViews = platformTerms.maximumViews;
    const campaignType = extractCampaignType(rawText);
    const campaignStatus = extractCampaignStatus(rawText) === "Not stated" && budget && budget.remaining && budget.remaining.value === 0
      ? "Out of budget"
      : extractCampaignStatus(rawText);
    const hashtags = [...new Set((rawText.match(/#[a-z0-9_]+/gi) || []).map((tag) => tag.toLowerCase()))].slice(0, 30);
    const mentions = [...new Set((rawText.match(/@[a-z0-9._]{2,}/gi) || []).map((tag) => tag.toLowerCase()))].slice(0, 20);
    const languages = [];
    const languageMatch = /languages?\s*[:=-]\s*([^\n.;]{2,120})/i.exec(rawText);
    if (languageMatch) languages.push(clean(languageMatch[1], 120));
    const formatMatch = /(?:format|aspect\s+ratio|video\s+format)\s*[:=-]\s*([^\n.;]{2,100})/i.exec(rawText);
    const aspectRatio = /(?:9\s*:\s*16|16\s*:\s*9|1\s*:\s*1|4\s*:\s*5)/.exec(rawText);
    const resolution = /(\d{3,4}\s*[x×]\s*\d{3,4})/i.exec(rawText);
    const creativeFormat = formatMatch ? clean(formatMatch[1], 100) :
      aspectRatio ? aspectRatio[0].replace(/\s/g, "") + (resolution ? " · " + resolution[1].replace(/\s/g, "") : "") :
      resolution ? resolution[1].replace(/\s/g, "") : "";

    const findings = [];
    const addFinding = (kind, label, value) => findings.push({ kind, label, value: clean(value, 500) });
    if (title) addFinding("found", "Campaign name", title);
    if (campaignType) addFinding("found", "Campaign type", campaignType);
    if (rate) addFinding("found", "Payout model", rate.label);
    if (platformRates.length) addFinding("found", "Platform-specific rates", platformRates.map((item) => item.platform + ": " + item.label).join(" · "));
    if (platformCaps.length) addFinding("found", "Platform-specific maximums", platformCaps.map((item) => item.platform + ": " + formatAmount(item.amount)).join(" · "));
    if (platformMinimumViews.length) addFinding("found", "Platform-specific minimum views", platformMinimumViews.map((item) => item.platform + ": " + new Intl.NumberFormat("en").format(item.value)).join(" · "));
    if (capPerClip) addFinding("found", "Maximum payout / per-clip cap", formatAmount(capPerClip));
    if (minimumPayout) addFinding("found", "Minimum payout before settlement", formatAmount(minimumPayout));
    if (maximumPayout && (!capPerClip || maximumPayout.value !== capPerClip.value || maximumPayout.currency !== capPerClip.currency)) {
      addFinding("found", "Maximum payout shown on campaign page", formatAmount(maximumPayout));
    }
    if (hiddenRequirements.locked) {
      addFinding("warning", "Creator requirements locked", hiddenRequirements.count == null
        ? "The page says requirements are visible only after joining. This analysis cannot inspect the locked rules."
        : hiddenRequirements.count + " requirement(s) are locked until you join. Do not assume the visible description is the full brief.");
    }
    if (minimumViews != null) addFinding("found", "Minimum views", new Intl.NumberFormat("en").format(minimumViews));
    if (maximumViews != null) addFinding("found", "Maximum views", new Intl.NumberFormat("en").format(maximumViews));
    if (minimumFollowers != null) addFinding("found", "Minimum followers / subscribers", new Intl.NumberFormat("en").format(minimumFollowers));
    if (budget) {
      const budgetParts = [];
      if (budget.spent) budgetParts.push(formatAmount(budget.spent) + " spent");
      if (budget.total) budgetParts.push(formatAmount(budget.total) + " total");
      if (budget.remaining) budgetParts.push(formatAmount(budget.remaining) + " remaining");
      if (budgetParts.length) addFinding("found", "Campaign budget", budgetParts.join(" · "));
    }
    if (platforms.length) addFinding("found", "Accepted platforms in brief", platforms.join(", "));
    if (excludedPlatforms.length) addFinding("warning", "Excluded platforms", excludedPlatforms.join(", "));
    if (unsupportedPlatforms.length) addFinding("warning", "Not available in India", unsupportedPlatforms.join(", ") + " — do not use as an India posting destination");
    if (requestedPlatform) addFinding(platformMatch === "match" ? "found" : platformMatch === "mismatch" ? "warning" : "unknown",
      requestedPlatform + " filter", platformMatch === "match" ? "Listed as accepted" :
        platformMatch === "mismatch" ? "Not listed as accepted or explicitly excluded — do not treat as eligible" :
          "Not stated in copied text — verify on official campaign page");
    if (category) addFinding("found", "Category", category);
    if (deadline) addFinding("found", "Deadline", deadline);
    if (entryMode) addFinding("found", "Access type", entryMode);
    if (campaignStatus !== "Not stated") addFinding("found", "Campaign status", campaignStatus);
    if (duration) addFinding("found", "Video duration", (duration.minSeconds != null ? duration.minSeconds + "s minimum" : "") +
      (duration.minSeconds != null && duration.maxSeconds != null ? " · " : "") +
      (duration.maxSeconds != null ? duration.maxSeconds + "s maximum" : ""));
    if (creativeFormat) addFinding("found", "Video format", creativeFormat);
    if (languages.length) addFinding("found", "Language", languages.join(", "));
    if (hashtags.length) addFinding("found", "Hashtags found", hashtags.join(" "));
    if (mentions.length) addFinding("found", "Mentions found", mentions.join(", "));
    if (requirementLines.length) addFinding("found", "Rule lines detected", requirementLines.length + " rule line(s) captured from the full copied text");

    const missing = [];
    if (!title) missing.push("Campaign title not reliably identified — check the heading on the official page");
    if (!rate) missing.push("Payout model / rate not recognised");
    if (!budget || !budget.remaining) missing.push("Remaining campaign budget not recognised — check the live campaign card");
    if (!platforms.length) missing.push("Accepted platform not recognised — verify the campaign configuration");
    if (platformMatch === "mismatch") missing.push(requestedPlatform + " is not listed as accepted or is explicitly excluded");
    if (platformMatch === "unknown") missing.push(requestedPlatform + " acceptance is not stated in the copied text");
    if (!entryMode) missing.push("Open / application / private access type not recognised");
    if (!deadline) missing.push("Campaign deadline not stated or not recognised");
    if (rate && rate.model === "CPM" && !capPerClip) missing.push("CPM maximum payout per clip not recognised — check the selected platform's campaign page");
    if (hiddenRequirements.locked) missing.push("Creator requirements are locked until Join Campaign; review them after joining before creating or publishing content.");
    if (rate && rate.model === "CPM" && minimumViews == null) missing.push("CPM minimum views not recognised — check the campaign page");
    if (unsupportedPlatforms.length) missing.push(unsupportedPlatforms.join(", ") + " is not available in the India workflow; do not select it as a posting destination");
    if (campaignStatus === "Paused" || campaignStatus === "Ended / closed" || campaignStatus === "Out of budget") {
      missing.push("Campaign status appears to be " + campaignStatus + " — do not assume new clips are being accepted");
    }
    if (!sourceUrl) missing.push("Official Content Rewards campaign URL not supplied");
    const coreFields = [Boolean(title), Boolean(rate), Boolean(budget && budget.remaining), platforms.length > 0, Boolean(entryMode), Boolean(deadline)];
    const coverageScore = Math.round(coreFields.filter(Boolean).length / coreFields.length * 100);
    const confidence = coverageScore >= 85 ? "Strong field coverage" : coverageScore >= 55 ? "Partial field coverage" : "Limited field coverage";

    return {
      title, sourceUrl, requestedPlatform, platformMatch, deadline, entryMode, rate, budget,
      platforms, excludedPlatforms, unsupportedPlatforms, category, requirementLines, findings, missing,
      confidence, coverageScore, campaignType, campaignStatus, capPerClip, minimumViews, maximumViews,
      minimumFollowers, duration, creativeFormat, languages, hashtags, mentions, platformRates,
      platformCaps, platformMinimumViews, platformMaximumViews, minimumPayout, maximumPayout, hiddenRequirements,
      ruleGroups: extractRuleGroups(lines),
      rawText,
      rawExcerpt: rawText.slice(0, 1400)
    };
  }

  function buildTrackerNotes(result) {
    const budget = result.budget;
    const budgetParts = [];
    if (budget && budget.spent) budgetParts.push(formatAmount(budget.spent) + " spent");
    if (budget && budget.total) budgetParts.push(formatAmount(budget.total) + " total");
    if (budget && budget.remaining) budgetParts.push(formatAmount(budget.remaining) + " remaining");
    const lines = [
      "Imported from copied Content Rewards campaign text — verify against the official campaign page; compare with the live campaign page.",
      "Campaign type: " + (result.campaignType || "Not recognised"),
      "Payout: " + (result.rate ? result.rate.label : "Not recognised"),
      "Platform rates: " + (result.platformRates.length ? result.platformRates.map((item) => item.platform + " " + item.label).join("; ") : "Not separately recognised"),
      "Platform-specific caps: " + (result.platformCaps.length ? result.platformCaps.map((item) => item.platform + " " + formatAmount(item.amount)).join("; ") : "Not separately recognised"),
      "Platform-specific minimum views: " + (result.platformMinimumViews.length ? result.platformMinimumViews.map((item) => item.platform + " " + item.value).join("; ") : "Not separately recognised"),
      "Minimum payout before settlement: " + formatAmount(result.minimumPayout),
      "Maximum payout shown: " + formatAmount(result.maximumPayout),
      "Locked creator requirements: " + (result.hiddenRequirements.locked ? "Yes" + (result.hiddenRequirements.count == null ? "" : " · " + result.hiddenRequirements.count + " requirement(s)") : "None detected"),
      "Reference files: " + (result.hiddenRequirements.referenceFiles == null ? "Not recognised" : result.hiddenRequirements.referenceFiles),
      "Per-clip cap: " + formatAmount(result.capPerClip),
      "Minimum views: " + (result.minimumViews == null ? "Not recognised" : result.minimumViews),
      "Maximum views: " + (result.maximumViews == null ? "Not recognised" : result.maximumViews),
      "Minimum followers/subscribers: " + (result.minimumFollowers == null ? "Not recognised" : result.minimumFollowers),
      "Budget: " + (budgetParts.length ? budgetParts.join(" · ") : "Not recognised"),
      "Access type: " + (result.entryMode || "Not recognised"),
      "Joining method: " + (result.entryMode || "Not stated — check the official campaign page"),
      "Campaign status: " + result.campaignStatus,
      "Accepted platforms: " + (result.platforms.length ? result.platforms.join(", ") : "Not recognised"),
      "Excluded platforms: " + (result.excludedPlatforms.length ? result.excludedPlatforms.join(", ") : "None detected"),
      "Platforms unavailable in the India workflow: " + (result.unsupportedPlatforms.length ? result.unsupportedPlatforms.join(", ") : "None detected"),
      "Deadline: " + (result.deadline || "Not recognised"),
      "Video duration: " + (result.duration ? JSON.stringify(result.duration) : "Not recognised"),
      "Video format: " + (result.creativeFormat || "Not recognised"),
      "Languages: " + (result.languages.length ? result.languages.join(", ") : "Not recognised"),
      "Hashtags: " + (result.hashtags.length ? result.hashtags.join(" ") : "Not recognised"),
      "Mentions: " + (result.mentions.length ? result.mentions.join(", ") : "Not recognised"),
      "Rule lines: " + result.requirementLines.length
    ];
    if (result.requirementLines.length) {
      lines.push("Captured rules (review all lines on the official page):");
      result.requirementLines.slice(0, 18).forEach((line) => lines.push("- " + line));
    }
    lines.push("Source excerpt: " + result.rawExcerpt.replace(/\s+/g, " ").slice(0, 350));
    return lines.join("\n").slice(0, 2000);
  }

  return Object.freeze({
    parseCampaignBrief, buildTrackerNotes, formatAmount, parseAmount, parseBudget, parseRate, parseCount,
    extractPlatforms, extractCap, extractMinimumViews, extractMaximumViews, extractFollowers, extractDuration,
    extractPlatformTerms, extractPayoutBound, detectLockedRequirements
  });
});
