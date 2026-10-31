(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClipRewardCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = 1;
  const STATUSES = Object.freeze(["idea", "applied", "joined", "editing", "ready", "submitted", "approved", "rejected"]);
  const PLATFORMS = Object.freeze(["Content Rewards", "Whop", "TikTok campaign", "Instagram campaign", "YouTube campaign", "Other"]);
  const MAX_CAMPAIGNS = 500;
  const MAX_TIMESTAMPS = 1000;
  const MAX_SOCIAL_ACCOUNTS = 20;
  const MAX_TEXT = 2000;
  const SOCIAL_PLATFORMS = Object.freeze(["TikTok", "Instagram", "YouTube", "Facebook", "X", "Other"]);
  const MAX_SUBMISSION_WINDOW_MS = 30 * 60 * 1000;
  const FUTURE_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;
  const ACCOUNT_CHECKS = Object.freeze(["ageEligible", "loggedIn", "socialVerified", "campaignReady", "postPublished", "submissionSent"]);

  function text(value, maxLength) {
    return String(value == null ? "" : value).trim().slice(0, maxLength || MAX_TEXT);
  }

  function validDate(value) {
    if (!value) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(value + "T00:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }

  function safeUrl(value) {
    const input = text(value, 500);
    if (!input) return "";
    try {
      const parsed = new URL(input);
      if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) return null;
      return parsed.href;
    } catch (_) {
      return null;
    }
  }

  function validateTimestamp(value) {
    const input = text(value, 20);
    const match = /^(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)$/.exec(input);
    if (!match) return { ok: false, seconds: null, normalized: "", error: "Use mm:ss or hh:mm:ss (for example 01:24 or 00:01:24)." };
    const hours = match[1] == null ? 0 : Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    if (match[1] == null && minutes > 59) {
      return { ok: false, seconds: null, normalized: "", error: "Minutes must be between 00 and 59 in hh:mm:ss format." };
    }
    const total = hours * 3600 + minutes * 60 + seconds;
    const normalized = total >= 3600
      ? [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60].map((n) => String(n).padStart(2, "0")).join(":")
      : [Math.floor(total / 60), total % 60].map((n) => String(n).padStart(2, "0")).join(":");
    return { ok: true, seconds: total, normalized, error: "" };
  }

  function postUrlMatchesPlatform(value, platform) {
    const normalized = safeUrl(value);
    if (!normalized) return false;
    if (platform === "Other") return true;
    const host = new URL(normalized).hostname.toLowerCase();
    const domains = {
      TikTok: ["tiktok.com"],
      Instagram: ["instagram.com"],
      YouTube: ["youtube.com", "youtu.be"],
      Facebook: ["facebook.com", "fb.watch"],
      X: ["x.com", "twitter.com", "t.co"]
    }[platform];
    return Boolean(domains && domains.some((domain) => host === domain || host.endsWith("." + domain)));
  }

  function validateSubmissionRecord(input, now) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    if (source.platform !== "Content Rewards" || source.status !== "submitted") {
      return { valid: true, error: "" };
    }
    if (!safeUrl(source.postUrl)) {
      return { valid: false, error: "For a Content Rewards submission, add the public post URL before marking it submitted." };
    }
    const postPlatform = text(source.postPlatform, 30);
    if (!SOCIAL_PLATFORMS.includes(postPlatform) || postPlatform === "Other") {
      return { valid: false, error: "Choose the actual supported social platform where you published the clip." };
    }
    if (!postUrlMatchesPlatform(source.postUrl, postPlatform)) {
      return { valid: false, error: "The public post URL does not match the selected social platform." };
    }
    const postedAtRaw = text(source.postedAt, 40);
    const submittedAtRaw = text(source.submittedAt, 40);
    const postedAt = postedAtRaw ? new Date(postedAtRaw) : null;
    const submittedAt = submittedAtRaw ? new Date(submittedAtRaw) : null;
    if (!postedAt || Number.isNaN(postedAt.getTime())) {
      return { valid: false, error: "Record the time the public post went live." };
    }
    if (!submittedAt || Number.isNaN(submittedAt.getTime())) {
      return { valid: false, error: "Record the time you actually submitted the post link inside Content Rewards." };
    }
    const postedMs = postedAt.getTime();
    const submittedMs = submittedAt.getTime();
    if (submittedMs < postedMs) {
      return { valid: false, error: "The Content Rewards submission time cannot be earlier than the post time." };
    }
    if (submittedMs - postedMs >= MAX_SUBMISSION_WINDOW_MS) {
      return { valid: false, error: "The official 30-minute submission window has passed. This local app cannot extend it." };
    }
    const nowMs = typeof now === "number" ? now : new Date(now || Date.now()).getTime();
    if (!Number.isFinite(nowMs) || submittedMs > nowMs + FUTURE_CLOCK_TOLERANCE_MS) {
      return { valid: false, error: "The recorded Content Rewards submission time is in the future. Check your device clock and time zone." };
    }
    return { valid: true, error: "" };
  }

  function normalizeCampaign(input, now) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const name = text(source.name, 120);
    const platform = PLATFORMS.includes(source.platform) ? source.platform : "Other";
    const status = STATUSES.includes(source.status) ? source.status : "idea";
    const campaignUrl = safeUrl(source.url);
    const postUrl = safeUrl(source.postUrl);
    const postedAtRaw = text(source.postedAt, 40);
    const submittedAtRaw = text(source.submittedAt, 40);
    const postedAtDate = postedAtRaw ? new Date(postedAtRaw) : null;
    const submittedAtDate = submittedAtRaw ? new Date(submittedAtRaw) : null;
    if (postedAtRaw && (!postedAtDate || Number.isNaN(postedAtDate.getTime()))) throw new Error("Post time must be a valid date and time.");
    if (submittedAtRaw && (!submittedAtDate || Number.isNaN(submittedAtDate.getTime()))) throw new Error("Submission time must be a valid date and time.");
    const postedAt = postedAtDate ? postedAtDate.toISOString() : "";
    const submittedAt = submittedAtDate ? submittedAtDate.toISOString() : "";
    const postPlatform = SOCIAL_PLATFORMS.includes(source.postPlatform) ? source.postPlatform : "Other";
    if (!name) throw new Error("Campaign name is required.");
    if (campaignUrl === null) throw new Error("Campaign URL must be a valid HTTPS link.");
    if (postUrl === null) throw new Error("Post URL must be a valid HTTPS link.");
    const deadline = text(source.deadline, 10);
    if (!validDate(deadline)) throw new Error("Deadline must be a real calendar date.");
    const stamp = now || new Date().toISOString();
    return {
      id: text(source.id, 80) || makeId(),
      name,
      platform,
      url: campaignUrl,
      deadline,
      payoutTerms: text(source.payoutTerms, 180),
      budgetTerms: text(source.budgetTerms, 180),
      rules: text(source.rules, MAX_TEXT),
      status,
      postUrl,
      postPlatform,
      postedAt,
      submittedAt,
      createdAt: text(source.createdAt, 40) || stamp,
      updatedAt: text(source.updatedAt, 40) || stamp
    };
  }

  function makeId() {
    return "cmp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  }

  function normalizeTimestamp(input, now) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const result = validateTimestamp(source.timestamp);
    const note = text(source.note, 140);
    if (!result.ok) throw new Error(result.error);
    if (!note) throw new Error("Timestamp note is required.");
    return {
      id: text(source.id, 80) || "ts-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      timestamp: result.normalized,
      seconds: result.seconds,
      note,
      createdAt: text(source.createdAt, 40) || (now || new Date().toISOString())
    };
  }

  function normalizeAccount(input, now) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const rawSocial = Array.isArray(source.socialAccounts) ? source.socialAccounts : [];
    if (rawSocial.length > MAX_SOCIAL_ACCOUNTS) throw new Error("Too many social accounts in this workspace.");
    const seenIds = new Set();
    const seenAccounts = new Set();
    const socialAccounts = rawSocial.map((item) => {
      const row = item && typeof item === "object" && !Array.isArray(item) ? item : {};
      const platform = SOCIAL_PLATFORMS.includes(row.platform) ? row.platform : "Other";
      const handle = text(row.handle, 100);
      if (!handle) throw new Error("Each saved social account needs a handle or channel name.");
      const id = text(row.id, 80) || "social-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
      if (seenIds.has(id)) throw new Error("Duplicate social account IDs are not allowed.");
      seenIds.add(id);
      const identity = platform.toLowerCase() + ":" + handle.toLowerCase();
      if (seenAccounts.has(identity)) throw new Error("That platform and handle are already saved.");
      seenAccounts.add(identity);
      return {
        id,
        platform,
        handle,
        confirmedConnected: row.confirmedConnected === true,
        updatedAt: text(row.updatedAt, 40) || (now || new Date().toISOString())
      };
    });
    const rawChecks = source.checklist && typeof source.checklist === "object" ? source.checklist : {};
    const checklist = {};
    ACCOUNT_CHECKS.forEach((key) => { checklist[key] = rawChecks[key] === true; });
    return {
      displayName: text(source.displayName, 100),
      socialAccounts,
      checklist,
      updatedAt: text(source.updatedAt, 40) || (now || new Date().toISOString())
    };
  }

  function stats(campaigns) {
    const safe = Array.isArray(campaigns) ? campaigns : [];
    return {
      total: safe.length,
      progress: safe.filter((item) => ["applied", "joined", "editing", "ready"].includes(item.status)).length,
      review: safe.filter((item) => item.status === "submitted").length,
      approved: safe.filter((item) => item.status === "approved").length
    };
  }

  function makeDraft(input) {
    const source = input && typeof input === "object" ? input : {};
    const topic = text(source.topic, 180);
    const benefit = text(source.benefit, 500);
    const language = ["en", "ml", "both"].includes(source.language) ? source.language : "en";
    const platform = ["TikTok", "Instagram Reels", "YouTube Shorts", "Other"].includes(source.platform) ? source.platform : "Other";
    if (!topic) throw new Error("Add a video topic first.");

    const English = [
      "HOOK\n" + topic + " — here's the key idea.",
      "BODY\n" + (benefit || "Share one useful, specific takeaway. Add only details you can verify."),
      "CTA\nSave this for later and share your experience in the comments.",
      "DISCLOSURE\n" + (source.disclosure || "Include the campaign-required creator/affiliate disclosure when applicable."),
      "CHECK BEFORE POSTING\nConfirm content rights, campaign rules, claims, music permissions and disclosure."
    ].join("\n\n");
    const Malayalam = [
      "ആരംഭം\n" + topic + " — ശ്രദ്ധിക്കേണ്ട പ്രധാന കാര്യം ഇതാണ്.",
      "വിശദീകരണം\n" + (benefit || "പരിശോധിച്ചുറപ്പിച്ച ഒരു പ്രയോജനകരമായ കാര്യം ലളിതമായി വിശദീകരിക്കുക."),
      "പ്രതികരണം\nഈ വിവരം ഉപകാരപ്പെട്ടെങ്കിൽ സേവ് ചെയ്യൂ; നിങ്ങളുടെ അഭിപ്രായം പങ്കുവെക്കൂ.",
      "വെളിപ്പെടുത്തൽ\nക്യാമ്പെയ്ൻ ആവശ്യപ്പെടുന്ന പരസ്യ/അഫിലിയേറ്റ് വെളിപ്പെടുത്തൽ ബാധകമായിടത്ത് ചേർക്കുക.",
      "പോസ്റ്റ് ചെയ്യുന്നതിന് മുമ്പ്\nഉള്ളടക്കാവകാശം, ക്യാമ്പെയ്ൻ നിയമങ്ങൾ, അവകാശവാദങ്ങൾ, സംഗീതാനുമതി എന്നിവ പരിശോധിക്കുക."
    ].join("\n\n");
    const header = "PLATFORM: " + platform + "\n";
    return header + (language === "ml" ? Malayalam : language === "both" ? English + "\n\n────────────\n\n" + Malayalam : English);
  }

  function createBackup(state, now) {
    const source = state && typeof state === "object" ? state : {};
    return {
      app: "ClipReward Studio",
      version: VERSION,
      exportedAt: now || new Date().toISOString(),
      campaigns: (Array.isArray(source.campaigns) ? source.campaigns : []).slice(0, MAX_CAMPAIGNS).map((c) => normalizeCampaign(c)),
      timestamps: (Array.isArray(source.timestamps) ? source.timestamps : []).slice(0, MAX_TIMESTAMPS).map((t) => normalizeTimestamp(t)),
      account: normalizeAccount(source.account, now)
    };
  }

  function parseBackup(raw) {
    let data;
    try { data = typeof raw === "string" ? JSON.parse(raw) : raw; }
    catch (_) { throw new Error("Backup is not valid JSON."); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Backup must be a JSON object.");
    if (data.app !== "ClipReward Studio" || data.version !== VERSION) throw new Error("This backup format is not supported.");
    if (!Array.isArray(data.campaigns) || !Array.isArray(data.timestamps)) throw new Error("Backup is missing campaigns or timestamps.");
    if (data.campaigns.length > MAX_CAMPAIGNS || data.timestamps.length > MAX_TIMESTAMPS) throw new Error("Backup exceeds the supported record limit.");
    const ids = new Set();
    const campaigns = data.campaigns.map((item) => {
      const normalized = normalizeCampaign(item);
      if (ids.has(normalized.id)) throw new Error("Backup contains duplicate campaign IDs.");
      if (normalized.platform === "Content Rewards" && normalized.status === "submitted" && normalized.submittedAt) {
        const validation = validateSubmissionRecord(normalized);
        if (!validation.valid) throw new Error("Backup contains an invalid Content Rewards submission record: " + validation.error);
      }
      ids.add(normalized.id);
      return normalized;
    });
    const timestampIds = new Set();
    const timestamps = data.timestamps.map((item) => {
      const normalized = normalizeTimestamp(item);
      if (timestampIds.has(normalized.id)) throw new Error("Backup contains duplicate timestamp IDs.");
      timestampIds.add(normalized.id);
      return normalized;
    });
    const account = normalizeAccount(data.account);
    return { campaigns, timestamps, account };
  }

  return Object.freeze({
    VERSION, STATUSES, PLATFORMS, MAX_CAMPAIGNS, MAX_TIMESTAMPS, MAX_SOCIAL_ACCOUNTS, SOCIAL_PLATFORMS, ACCOUNT_CHECKS,
    MAX_SUBMISSION_WINDOW_MS, validDate, safeUrl, postUrlMatchesPlatform, validateTimestamp, validateSubmissionRecord, normalizeCampaign, normalizeTimestamp, normalizeAccount,
    stats, makeDraft, createBackup, parseBackup
  });
});
