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

  function inferBriefRequirements(brief) {
    const raw = clean(brief && brief.rawExcerpt, 1400) + "\n" +
      (Array.isArray(brief && brief.requirementLines) ? brief.requirementLines.map((item) => clean(item, 500)).join("\n") : "");
    const checks = [];
    const add = (key, label, detail) => checks.push({ key, label, detail, status: "must-check" });
    if (/\boriginal\b|\bown footage\b|\bcreated by you\b/i.test(raw)) {
      add("originality", "Originality", "The brief mentions original content. Use footage and creative work you own or are licensed to use; do not rely on minor edits to another creator's work.");
    }
    if (/\bdisclos|#ad\b|#sponsored\b|paid partnership/i.test(raw)) {
      add("disclosure", "Disclosure", "A sponsorship or paid-partnership disclosure is mentioned. Follow the exact placement, wording and platform label in the official brief.");
    }
    const duration = /\b(?:minimum|min\.?|at least)\s*(\d{1,3})\s*(?:seconds?|secs?|s)\b/i.exec(raw);
    if (duration) add("duration", "Minimum duration", "The copied text states at least " + duration[1] + " seconds. Verify the final edited clip duration against the live brief.");
    const tags = [...new Set((raw.match(/#[a-z0-9_]+/gi) || []).map((tag) => tag.toLowerCase()))].slice(0, 12);
    if (tags.length) add("hashtags", "Required / mentioned hashtags", tags.join(" "));
    const mentions = [...new Set((raw.match(/@[a-z0-9._]{2,}/gi) || []).map((tag) => tag.toLowerCase()))].slice(0, 8);
    if (mentions.length) add("mentions", "Partner / account mentions", mentions.join(", "));
    if (/pre.?approval|approve.*draft|draft.*approval/i.test(raw)) {
      add("preapproval", "Pre-approval", "The brief appears to require draft approval before publication. Do not publish until the campaign team approves the draft.");
    }
    if (/watermark|repost|re.?upload|cross.?post|duplicate/i.test(raw)) {
      add("reuse", "Reuse / watermark restrictions", "The brief mentions reposting, duplicate content, cross-posting or watermarks. Confirm exactly what is prohibited before editing.");
    }
    if (/30\s*(?:-|to)?\s*minute|within\s+30\s+minutes/i.test(raw)) {
      add("submission-window", "Submission window", "A 30-minute submission window appears in the copied text. Verify the official post and link-submission timestamps.");
    }
    return checks;
  }

  function payoutGuidance(rate) {
    if (!rate) return { model: "Not stated", formula: "No payout estimate. The brief does not contain a recognised payout model or rate.", amountKnown: false };
    if (rate.model === "CPM") return {
      model: "CPM",
      formula: "Campaign gross = stated CPM × eligible qualified views ÷ 1,000. Apply the campaign's per-clip cap and remaining budget; approval and any fees still affect settlement.",
      amountKnown: Boolean(rate.amount)
    };
    if (rate.model === "Per post") return {
      model: "Per post",
      formula: "Use the stated fixed amount only after the clip is approved and any minimum-view / campaign conditions are met.",
      amountKnown: Boolean(rate.amount)
    };
    if (rate.model === "Retainer") return {
      model: "Retainer",
      formula: "Payment depends on agreed deliverables and the cycle. Confirm the amount and acceptance terms in the official agreement.",
      amountKnown: false
    };
    if (rate.model === "Pool") return {
      model: "Shared pool",
      formula: "A shared pool is not a fixed CPM or guaranteed per-creator amount. Confirm the allocation formula, eligible views and remaining budget on the official campaign page.",
      amountKnown: false
    };
    return { model: clean(rate.model, 40), formula: "Confirm the official payout formula, caps, fees, approval conditions and settlement schedule.", amountKnown: false };
  }

  function assessCampaign(input) {
    const source = input && typeof input === "object" ? input : {};
    const brief = source.brief && typeof source.brief === "object" ? source.brief : {};
    const platform = INDIA_POSTING_PLATFORMS.includes(source.platform) ? source.platform : "";
    const today = clean(source.today, 10) || new Date().toISOString().slice(0, 10);
    const accepted = Array.isArray(brief.platforms) ? brief.platforms : [];
    const unsupported = Array.isArray(brief.unsupportedPlatforms) ? brief.unsupportedPlatforms : [];
    const reasons = [];
    let state = "verify";
    if (!platform) {
      state = "blocked";
      reasons.push("Select Instagram, Facebook, YouTube or X before assessing platform fit.");
    } else if (unsupported.includes(platform) || platform === "TikTok") {
      state = "blocked";
      reasons.push(platform + " is not an India posting destination in this workspace.");
    } else if (brief.platformMatch === "mismatch") {
      state = "blocked";
      reasons.push(platform + " is not listed as accepted in the copied campaign brief.");
    } else if (brief.deadline && brief.deadline < today) {
      state = "blocked";
      reasons.push("The copied campaign deadline is in the past. Confirm whether the campaign is still open before spending time on it.");
    } else {
      if (brief.platformMatch !== "match") reasons.push("Platform acceptance is not confirmed from the copied text.");
      if (!brief.rate) reasons.push("Payout model or rate is missing.");
      if (!brief.budget || !brief.budget.remaining) reasons.push("Remaining campaign budget is not known.");
      if (!brief.deadline) reasons.push("Campaign deadline is not recognised.");
      if (!brief.entryMode) reasons.push("Open-join versus application / invitation route is not known.");
      reasons.push("Account eligibility, campaign approval and live campaign availability must be checked on Content Rewards.");
    }
    if (state !== "blocked") {
      state = brief.platformMatch === "match" && brief.rate && brief.deadline && brief.entryMode ? "promising" : "verify";
    }
    const payout = payoutGuidance(brief.rate);
    const requirements = inferBriefRequirements(brief);
    const checks = [
      {
        label: "Selected platform",
        status: brief.platformMatch === "match" && platform ? "pass" : brief.platformMatch === "mismatch" ? "fail" : "unknown",
        detail: brief.platformMatch === "match" ? platform + " appears in the accepted platforms copied from the brief." :
          brief.platformMatch === "mismatch" ? platform + " is not listed in the copied brief." :
            "The pasted text does not prove that " + (platform || "your selected platform") + " is accepted."
      },
      { label: "Payout model", status: brief.rate ? "pass" : "unknown", detail: payout.model + (brief.rate && brief.rate.label ? " · " + brief.rate.label : " · not detected") },
      {
        label: "Budget remaining",
        status: brief.budget && brief.budget.remaining ? "pass" : "unknown",
        detail: brief.budget && brief.budget.remaining ? "Detected remaining budget: " + brief.budget.remaining.currency + " " + brief.budget.remaining.value : "Remaining budget was not confirmed by the copied text."
      },
      {
        label: "Deadline",
        status: brief.deadline ? (brief.deadline < today ? "fail" : "pass") : "unknown",
        detail: brief.deadline ? "Detected deadline: " + brief.deadline : "No recognised deadline; check the live campaign."
      },
      {
        label: "Creator account / campaign approval",
        status: "unknown",
        detail: "No Content Rewards account API is connected. Confirm the exact social account, eligibility and Join / Applied / Invited state in Content Rewards."
      }
    ];
    return {
      state,
      stateLabel: state === "blocked" ? "Blocked / do not proceed yet" : state === "promising" ? "Promising brief · verify before applying" : "More evidence required",
      reasons, platform, acceptedPlatforms: accepted, payout, requirements, checks,
      nextStep: state === "blocked"
        ? "Resolve the listed blocker or skip this campaign. Do not publish against an unconfirmed brief."
        : "Open the official campaign, confirm the exact account is connected, check every requirement and remaining budget, then apply / join in Content Rewards. Publish and submit there only after approval or joining.",
      earningsNote: "This is a campaign-rule analysis, not an earnings forecast. No qualified views, per-clip cap, payout approval, fee or received amount is assumed."
    };
  }

  function assessAll(input) {
    const source = input && typeof input === "object" ? input : {};
    return {
      campaign: assessCampaign(source),
      nativePrograms: NATIVE_PROGRAMS.map((item) => ({ ...item, status: "unknown", statusLabel: "Live eligibility not connected", checks: item.checks.slice() })),
      apiStatus: "not-connected",
      platformSet: INDIA_POSTING_PLATFORMS.slice()
    };
  }

  return Object.freeze({ INDIA_POSTING_PLATFORMS, NATIVE_PROGRAMS, inferBriefRequirements, payoutGuidance, assessCampaign, assessAll });
});
