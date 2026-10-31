(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClipRewardIntelligence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const INDIA_POSTING_PLATFORMS = Object.freeze(["Instagram", "Facebook", "YouTube", "X"]);
  const NATIVE_PROGRAMS = Object.freeze([
    {
      platform: "YouTube", title: "YouTube Partner Program", route: "YouTube Studio → Earn",
      summary: "Check YPP access and each separate earning feature in the channel's Earn tab. Thresholds, country availability and feature requirements can differ.",
      checks: [
        "Check the channel's current YPP eligibility and available feature thresholds in Studio → Earn.",
        "Confirm channel country/region, active Community Guidelines strikes and channel monetization policy status.",
        "Confirm Google Account 2-Step Verification and advanced-features access.",
        "Confirm an active AdSense for YouTube account is linked when applying.",
        "Review originality, reused-content and inauthentic-content rules across the channel."
      ],
      source: "https://support.google.com/youtube/answer/72851?hl=en-IN",
      sourceLabel: "YouTube official YPP eligibility"
    },
    {
      platform: "Facebook", title: "Facebook Content Monetization", route: "Facebook → Professional dashboard → Monetization",
      summary: "Check whether Content Monetization is available or an interest/invitation step is shown. Meta controls access, qualifying views and earnings.",
      checks: [
        "Open the Professional dashboard → Monetization → Content Monetization and check the exact account status.",
        "Complete any official interest, invitation, onboarding or payout steps shown in-product.",
        "Check Partner Monetization and Content Monetization policy status.",
        "Publish original content with meaningful creator value; avoid copied clips and low-value edits.",
        "Review qualified views, earnings-rate and non-qualified-view reasons in the dashboard when available."
      ],
      source: "https://about.fb.com/news/2026/03/creator-fast-track-grow-your-audience-earn-money-on-facebook/",
      sourceLabel: "Meta official creator monetization update"
    },
    {
      platform: "Instagram", title: "Instagram creator earnings", route: "Instagram → Professional dashboard → Monetization / Creator Marketplace",
      summary: "Check feature availability for this exact professional account and region. Brand partnerships and platform monetization are separate routes.",
      checks: [
        "Use a professional account and check Account Status / Professional dashboard for this account's available monetization tools.",
        "Check eligibility and availability separately for Gifts, Subscriptions and any other monetization feature shown.",
        "Check Creator Marketplace and partnership messages for brand opportunities.",
        "For a paid or gifted brand exchange, use the required paid-partnership label and partner tagging/disclosure rules.",
        "Confirm branded-content policy status and any product/category restrictions before publishing."
      ],
      source: "https://about.fb.com/news/2024/02/creator-marketplace-for-brands-and-creators-to-collaborate-on-instagram/",
      sourceLabel: "Meta official Instagram Creator Marketplace guide"
    }
  ]);

  function clean(value, max) {
    return String(value == null ? "" : value).replace(/\r/g, "").trim().slice(0, max || 2000);
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function inferBriefRequirements(brief) {
    const source = brief && typeof brief === "object" ? brief : {};
    const raw = clean(source.rawText || source.rawExcerpt, 20000) + "\n" +
      (Array.isArray(source.requirementLines) ? source.requirementLines.map((item) => clean(item, 700)).join("\n") : "");
    const checks = [];
    const add = (key, label, detail) => {
      if (!checks.some((item) => item.key === key)) checks.push({ key, label, detail, status: "must-check" });
    };

    if (/\boriginal\b|\bown footage\b|\bcreated by you\b|\bunique content\b/i.test(raw)) {
      add("originality", "Originality", "The brief mentions original content. Use footage and creative work you own or are licensed to use; a minor edit to somebody else's clip may not satisfy the rule.");
    }
    if (/\bdisclos|#ad\b|#sponsored\b|paid partnership|branded content label/i.test(raw)) {
      add("disclosure", "Disclosure", "A sponsorship or paid-partnership disclosure is mentioned. Follow the exact wording, placement and platform label in the official brief.");
    }
    const duration = source.duration && (source.duration.minSeconds != null || source.duration.maxSeconds != null)
      ? source.duration
      : null;
    if (duration) {
      const detail = (duration.minSeconds != null ? "At least " + duration.minSeconds + " seconds" : "") +
        (duration.minSeconds != null && duration.maxSeconds != null ? "; " : "") +
        (duration.maxSeconds != null ? "no more than " + duration.maxSeconds + " seconds" : "");
      add("duration", "Video duration", detail + ". Check the exported clip's actual duration.");
    } else if (/\b(?:minimum|min\.?|at least)\s*\d{1,3}\s*(?:seconds?|secs?|s)\b/i.test(raw)) {
      const match = /\b(?:minimum|min\.?|at least)\s*(\d{1,3})\s*(?:seconds?|secs?|s)\b/i.exec(raw);
      add("duration", "Minimum duration", "The brief states at least " + match[1] + " seconds. Verify the final edited clip duration.");
    }
    if (source.minimumViews != null) add("minimum-views", "Minimum views", "The campaign text states at least " + Number(source.minimumViews).toLocaleString("en") + " views. Check whether this threshold is per clip and whether views are qualified.");
    if (source.maximumViews != null) add("maximum-views", "Maximum views", "The copied brief mentions a maximum of " + Number(source.maximumViews).toLocaleString("en") + " views. Confirm how the campaign counts and caps them.");
    if (source.minimumFollowers != null) add("minimum-followers", "Audience threshold", "The brief mentions at least " + Number(source.minimumFollowers).toLocaleString("en") + " followers/subscribers. Verify the required platform and account.");
    const format = clean(source.creativeFormat, 120);
    if (format || /\b9\s*:\s*16\b|\bvertical\b|1080\s*[x×]\s*1920/i.test(raw)) {
      add("format", "Video format", format ? "Detected format: " + format + ". Match the required aspect ratio, orientation and resolution." : "The brief mentions a vertical or aspect-ratio requirement. Verify the exact export dimensions.");
    }
    const languages = Array.isArray(source.languages) ? source.languages : [];
    if (languages.length || /\blanguage(?:s)?\s*[:=-]/i.test(raw)) {
      add("language", "Language", "Language requirement detected: " + (languages.join(", ") || "review the language line in the full copied brief") + ".");
    }
    const tags = unique([
      ...(Array.isArray(source.hashtags) ? source.hashtags : []),
      ...((raw.match(/#[a-z0-9_]+/gi) || []).map((tag) => tag.toLowerCase()))
    ]).slice(0, 30);
    if (tags.length) add("hashtags", "Required / mentioned hashtags", tags.join(" "));
    const mentions = unique([
      ...(Array.isArray(source.mentions) ? source.mentions : []),
      ...((raw.match(/@[a-z0-9._]{2,}/gi) || []).map((tag) => tag.toLowerCase()))
    ]).slice(0, 20);
    if (mentions.length) add("mentions", "Partner / account mentions", mentions.join(", "));
    if (/pre.?approval|approve.*draft|draft.*approval|review.*before\s+(?:posting|publishing)/i.test(raw)) {
      add("preapproval", "Pre-approval", "The brief appears to require draft approval before publication. Upload the draft and wait for the campaign team before posting.");
    }
    if (/watermark|repost|re.?upload|cross.?post|duplicate|reused content/i.test(raw)) {
      add("reuse", "Reuse / watermark restrictions", "The brief mentions reposting, duplicate content, cross-posting or watermarks. Confirm precisely what is prohibited before editing.");
    }
    if (/copyright|licensed music|unlicensed\\s+(?:music|audio|footage|assets?)|music rights|commercial use|royalty[- ]free|permission/i.test(raw)) {
      add("rights", "Audio / footage rights", "The brief mentions copyright, licensing or permissions. Confirm commercial rights for every music, clip, image, logo and source asset.");
    }
    if (/30\s*(?:-|to)?\s*minute|within\s+30\s+minutes/i.test(raw)) {
      add("submission-window", "Submission window", "A 30-minute submission window appears in the copied text. Record the actual public-post and Content Rewards submission times.");
    }
    if (source.entryMode === "Private / invitation-only" || /\bprivate campaign\b|\binvitation[- ]only\b|\binvite[- ]only\b/i.test(raw)) {
      add("private-access", "Private campaign access", "This appears to be an invitation-only campaign. Use the official invite route; it will not be discoverable through the public campaign list.");
    }
    if (source.hiddenRequirements && source.hiddenRequirements.locked) {
      const count = source.hiddenRequirements.count;
      const files = source.hiddenRequirements.referenceFiles;
      add("locked-requirements", "Creator requirements not yet visible",
        (count == null ? "The official page hides its requirements until you join." : count + " requirement(s) are hidden until you join.") +
        (files == null ? "" : " " + files + " reference file(s) are also locked.") +
        " The visible campaign description is not the complete brief; open and analyse the rules after joining, before creating or publishing.");
    }
    const groups = source.ruleGroups && typeof source.ruleGroups === "object" ? source.ruleGroups : {};
    const prohibited = Array.isArray(groups.prohibited) && groups.prohibited.length
      ? groups.prohibited
      : raw.split("\n").filter((line) => /\bno\b|don't|do not|must not|cannot|can't|prohibit|avoid|forbidden|watermark|repost|unlicensed/i.test(line));
    if (prohibited.length) add("prohibited-actions", "Do-not-do rules", unique(prohibited).slice(0, 12).join(" · "));
    if (/AI[- ]generated|synthetic voice|AI voice|voice cloning|AI tools/i.test(raw)) {
      add("ai-usage", "AI-generated media rules", "The brief mentions AI-generated media or voice. Confirm whether these tools are permitted and disclose them when required; do not assume permission.");
    }
    const eligibility = Array.isArray(groups.eligibility) ? groups.eligibility : [];
    if (eligibility.length) add("eligibility-rules", "Creator eligibility rules", unique(eligibility).slice(0, 12).join(" · "));
    const submission = Array.isArray(groups.submission) ? groups.submission : [];
    if (submission.length) add("submission-rules", "Posting / submission rules", unique(submission).slice(0, 12).join(" · "));
    return checks;
  }

  function creatorFee(rate, budget) {
    const source = "https://contentrewards.com/terms";
    if (!rate) return { percent: null, label: "Unknown until the payout model and campaign terms are confirmed", source };
    if (rate.model === "CPM" || rate.model === "Pool") {
      return { percent: 10, label: "The current creator terms list a 10% creator fee for CPM and Pool payouts; check the individual campaign terms for any applicable variation.", source };
    }
    if (rate.model === "Per post" || rate.model === "Retainer") {
      if (!budget || !budget.total) return { percent: null, label: "Per-post / retainer fee depends on the total campaign budget; confirm the campaign terms.", source };
      if (budget.total.currency !== "USD") return { percent: null, label: "The fee threshold is stated in US dollars; this campaign budget uses another currency, so confirm the fee shown in its official terms.", source };
      if (budget.total.value >= 5000 && budget.total.currency === "USD") {
        return { percent: 0, label: "Current terms list 0% creator fee for per-post / retainer campaigns with a total budget of at least US$5,000; verify the campaign's displayed terms.", source };
      }
      return { percent: 10, label: "Current terms list 10% for per-post / retainer campaigns with a total budget below US$5,000; verify the campaign's displayed terms.", source };
    }
    return { percent: null, label: "Creator fee is not recognised; confirm the official campaign terms.", source };
  }

  function payoutGuidance(rate, budget, capPerClip, minimumPayout) {
    const fee = creatorFee(rate, budget);
    if (!rate) return {
      model: "Not stated",
      formula: "No payout estimate. The copied brief does not contain a recognised payout model or rate.",
      amountKnown: false, creatorFee: fee
    };
    if (rate.model === "CPM") return {
      model: "CPM",
      formula: "Gross clip earnings = CPM rate × eligible qualified views counted by Content Rewards ÷ 1,000, limited by the per-platform maximum per clip and remaining campaign budget. A minimum payout threshold may apply before settlement. The creator fee is then deducted; views and approval are determined by Content Rewards and the campaign team.",
      amountKnown: Boolean(rate.amount),
      capPerClip: capPerClip || null,
      minimumPayout: minimumPayout || null,
      creatorFee: fee
    };
    if (rate.model === "Per post") return {
      model: "Per post",
      formula: "The stated fixed amount is payable only after the clip is approved and its minimum-view / deliverable conditions are met. Apply the creator fee stated by the campaign terms.",
      amountKnown: Boolean(rate.amount),
      creatorFee: fee
    };
    if (rate.model === "Retainer") return {
      model: "Retainer",
      formula: "Payment depends on agreed deliverables and the cycle. Confirm the amount, cycle and acceptance terms in the official agreement; the creator fee depends on campaign budget and terms.",
      amountKnown: Boolean(rate.amount),
      creatorFee: fee
    };
    if (rate.model === "Pool") return {
      model: "Pool",
      formula: "A Pool campaign allocates a funded amount among eligible creators using the campaign's stated rules (including counted views where specified). It is not a fixed CPM or guaranteed per-creator amount; the creator fee applies.",
      amountKnown: false,
      creatorFee: fee
    };
    return {
      model: clean(rate.model, 40),
      formula: "Confirm the official payout formula, caps, fees, approval conditions and settlement schedule.",
      amountKnown: false, creatorFee: fee
    };
  }

  function assessCampaign(input) {
    const source = input && typeof input === "object" ? input : {};
    const brief = source.brief && typeof source.brief === "object" ? source.brief : {};
    const platform = INDIA_POSTING_PLATFORMS.includes(source.platform) ? source.platform : "";
    const today = clean(source.today, 10) || new Date().toISOString().slice(0, 10);
    const accepted = Array.isArray(brief.platforms) ? brief.platforms : [];
    const excluded = Array.isArray(brief.excludedPlatforms) ? brief.excludedPlatforms : [];
    const unsupported = Array.isArray(brief.unsupportedPlatforms) ? brief.unsupportedPlatforms : [];
    const reasons = [];
    const missing = Array.isArray(brief.missing) ? brief.missing.slice() : [];
    let state = "verify";

    if (!platform) {
      state = "blocked";
      reasons.push("Select Instagram, Facebook, YouTube or X before assessing platform fit.");
    } else if (unsupported.includes(platform) || platform === "TikTok") {
      state = "blocked";
      reasons.push(platform + " is not an India posting destination in this workspace.");
    } else if (excluded.includes(platform) || brief.platformMatch === "mismatch") {
      state = "blocked";
      reasons.push(platform + " is not listed as accepted or is explicitly excluded in the copied brief.");
    } else if (brief.deadline && brief.deadline < today) {
      state = "blocked";
      reasons.push("The copied campaign deadline is in the past. Confirm whether the campaign is still open before spending time on it.");
    } else if (["Paused", "Ended / closed", "Out of budget"].includes(brief.campaignStatus)) {
      state = "blocked";
      reasons.push("The copied brief indicates campaign status: " + brief.campaignStatus + ".");
    }

    const platformRates = Array.isArray(brief.platformRates) ? brief.platformRates : [];
    const selectedRate = platformRates.find((item) => item.platform === platform) || null;
    const rate = selectedRate || (platformRates.length ? null : brief.rate || null);
    const platformCaps = Array.isArray(brief.platformCaps) ? brief.platformCaps : [];
    const platformMinimumViews = Array.isArray(brief.platformMinimumViews) ? brief.platformMinimumViews : [];
    const platformMaximumViews = Array.isArray(brief.platformMaximumViews) ? brief.platformMaximumViews : [];
    const selectedCap = platformCaps.find((item) => item.platform === platform) || null;
    const selectedMinimum = platformMinimumViews.find((item) => item.platform === platform) || null;
    const selectedMaximum = platformMaximumViews.find((item) => item.platform === platform) || null;
    const capPerClip = (selectedCap && selectedCap.amount) ||
      (platformCaps.length ? null : brief.capPerClip || null);
    const minimumViews = selectedMinimum ? selectedMinimum.value :
      (platformMinimumViews.length ? null : brief.minimumViews);
    const maximumViews = selectedMaximum ? selectedMaximum.value :
      (platformMaximumViews.length ? null : brief.maximumViews);
    const minimumPayout = brief.minimumPayout || null;
    const payout = payoutGuidance(rate, brief.budget, capPerClip, minimumPayout);
    const requirements = inferBriefRequirements(brief);

    if (state !== "blocked") {
      if (brief.platformMatch !== "match") reasons.push("Platform acceptance is not confirmed from the copied text.");
      if (!rate) reasons.push("Payout model or platform rate is missing.");
      if (!brief.budget || !brief.budget.remaining) reasons.push("Remaining campaign budget is not known.");
      if (!brief.deadline) reasons.push("Campaign deadline is not recognised.");
      if (!brief.entryMode) reasons.push("Open / application / private access route is not known.");
      if (rate && rate.model === "CPM" && !capPerClip) reasons.push("CPM maximum per clip is not recognised.");
      if (rate && rate.model === "CPM" && minimumViews == null) reasons.push("CPM minimum views are not recognised.");
      if (brief.minimumFollowers != null) reasons.push("Confirm that your selected posting account meets the stated follower threshold.");
      if (brief.hiddenRequirements && brief.hiddenRequirements.locked) reasons.push("The full creator requirements are still hidden until you join; this visible-page analysis cannot clear those rules.");
      reasons.push("Creator-account eligibility and campaign approval must still be confirmed on Content Rewards.");
      const coreComplete = brief.platformMatch === "match" && Boolean(rate) &&
        Boolean(brief.budget && brief.budget.remaining) && Boolean(brief.deadline) && Boolean(brief.entryMode) &&
        !(brief.hiddenRequirements && brief.hiddenRequirements.locked) &&
        (rate.model !== "CPM" || (Boolean(capPerClip) && minimumViews != null));
      state = coreComplete ? "promising" : "verify";
    }

    const checks = [
      {
        label: "Selected platform",
        status: brief.platformMatch === "match" && platform ? "pass" : excluded.includes(platform) || brief.platformMatch === "mismatch" ? "fail" : "unknown",
        detail: brief.platformMatch === "match" ? platform + " appears in the accepted platforms copied from the brief." :
          excluded.includes(platform) ? platform + " is explicitly excluded in the copied text." :
            brief.platformMatch === "mismatch" ? platform + " is not listed among accepted platforms." :
              "The copied text does not prove that " + (platform || "your selected platform") + " is accepted."
      },
      {
        label: "Platform payout rate",
        status: rate ? "pass" : "unknown",
        detail: rate ? platform + (selectedRate ? " rate: " : " rate not separately listed; general rate: ") + (rate.label || rate.model) :
          "No recognised rate for " + platform + "."
      },
      {
        label: "Per-clip maximum",
        status: capPerClip ? "pass" : rate && rate.model === "CPM" ? "unknown" : "not-applicable",
        detail: capPerClip ? "Detected maximum: " + capPerClip.currency + " " + capPerClip.value :
          rate && rate.model === "CPM" ? "CPM campaigns have a maximum per clip; it was not recognised in the copied brief." :
            "A CPM-style clip cap was not detected for this payout model."
      },
      {
        label: "Minimum views",
        status: minimumViews != null ? "pass" : rate && rate.model === "CPM" ? "unknown" : "not-applicable",
        detail: minimumViews != null ? "Detected minimum: " + Number(minimumViews).toLocaleString("en") + " views." :
          rate && rate.model === "CPM" ? "Minimum views were not recognised. Confirm the threshold on the campaign page." :
            "No minimum-view threshold was recognised in the copied text."
      },
      {
        label: "Minimum payout threshold",
        status: minimumPayout ? "pass" : "unknown",
        detail: minimumPayout ? "Detected minimum amount before payout: " + minimumPayout.currency + " " + minimumPayout.value :
          "Minimum payout threshold was not visible in the copied page."
      },
      {
        label: "Full creator requirements",
        status: brief.hiddenRequirements && brief.hiddenRequirements.locked ? "unknown" : "unknown",
        detail: brief.hiddenRequirements && brief.hiddenRequirements.locked
          ? "Locked until you join. " + (brief.hiddenRequirements.count == null ? "" : brief.hiddenRequirements.count + " requirement(s) hidden. ") + "Review all rules and files inside Content Rewards before creating content."
          : "The app can analyse only the text you copied. Confirm the complete Requirements section on the official campaign page."
      },
      {
        label: "Maximum views",
        status: maximumViews != null ? "pass" : "not-applicable",
        detail: maximumViews != null ? "Detected maximum: " + Number(maximumViews).toLocaleString("en") + " views." : "No maximum-view threshold was recognised."
      },
      {
        label: "Minimum followers / subscribers",
        status: brief.minimumFollowers != null ? "unknown" : "not-applicable",
        detail: brief.minimumFollowers != null
          ? "The copied brief requires " + Number(brief.minimumFollowers).toLocaleString("en") + " followers/subscribers. The app cannot verify your live account count."
          : "No minimum follower threshold was recognised."
      },
      {
        label: "Budget remaining",
        status: brief.budget && brief.budget.remaining ? "pass" : "unknown",
        detail: brief.budget && brief.budget.remaining ?
          "Detected remaining budget: " + brief.budget.remaining.currency + " " + brief.budget.remaining.value :
          "Remaining campaign budget was not confirmed by the copied text."
      },
      {
        label: "Deadline",
        status: brief.deadline ? (brief.deadline < today ? "fail" : "pass") : "unknown",
        detail: brief.deadline ? "Detected deadline: " + brief.deadline : "No recognised deadline; check the live campaign."
      },
      {
        label: "Access type",
        status: brief.entryMode ? "pass" : "unknown",
        detail: brief.entryMode || "Open, application-only or private access was not recognised."
      },
      {
        label: "Creator account / campaign approval",
        status: "unknown",
        detail: "No Content Rewards account API is connected. Confirm the exact social account is verified and that you have joined, been invited or received application approval."
      }
    ];

    const nextStep = state === "blocked"
      ? "Do not spend time producing this clip yet. Resolve the blocker or choose another campaign."
      : brief.entryMode === "Private / invitation-only"
        ? "Use the official invitation link or account notification, confirm the exact account you will post from is connected, and read the full brief before creating the draft."
        : brief.entryMode === "Application / brand review"
          ? "Open the official campaign, select the account you will post from and confirm the exact account is connected, complete the application, and wait for brand approval before publishing."
          : "Open the official campaign, confirm the exact account you will post from is connected, check the full requirements and remaining budget, then Join Campaign. Publish and submit only after joining.";
    return {
      state,
      stateLabel: state === "blocked" ? "Blocked / do not proceed yet" :
        state === "promising" ? "Promising copied brief · verify before joining" : "More evidence required",
      reasons, missing, platform, acceptedPlatforms: accepted, excludedPlatforms: excluded, rate, payout, requirements, checks,
      capPerClip, minimumPayout, minimumViews, maximumViews, creatorFee: payout.creatorFee,
      nextStep,
      earningsNote: "This is a rule and evidence assessment, not an earnings forecast. No views, campaign approval, actual payout or paid balance is assumed."
    };
  }

  function assessAll(input) {
    const source = input && typeof input === "object" ? input : {};
    return {
      campaign: assessCampaign(source),
      nativePrograms: NATIVE_PROGRAMS.map((item) => ({
        ...item, status: "unknown", statusLabel: "Live eligibility not connected", checks: item.checks.slice()
      })),
      apiStatus: "not-connected",
      platformSet: INDIA_POSTING_PLATFORMS.slice()
    };
  }

  return Object.freeze({
    INDIA_POSTING_PLATFORMS, NATIVE_PROGRAMS, inferBriefRequirements, creatorFee,
    payoutGuidance, assessCampaign, assessAll
  });
});
