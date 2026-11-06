(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClipRewardAutoContentPack = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PLATFORM_INFO = Object.freeze({
    Instagram: {
      format: "Instagram Reels",
      captionEn: (title) => "Quick look at " + title + ". Add one genuine, verified takeaway from your own experience before publishing.",
      captionMl: (title) => title + " നെക്കുറിച്ചുള്ള ചെറിയ പരിചയം. നിങ്ങൾ നേരിട്ട് പരിശോധിച്ച ഒരു കാര്യം ചേർത്ത് മാത്രം പോസ്റ്റ് ചെയ്യുക."
    },
    Facebook: {
      format: "Facebook Reels",
      captionEn: (title) => "A short, honest look at " + title + ". Include only details you can verify and visuals you have permission to share.",
      captionMl: (title) => title + " നെക്കുറിച്ചുള്ള ലളിതമായ വിശദീകരണം. ഉറപ്പുള്ള വിവരങ്ങളും അനുമതിയുള്ള visuals-ഉം മാത്രം ഉപയോഗിക്കുക."
    },
    YouTube: {
      format: "YouTube Shorts",
      captionEn: (title) => "Short guide: " + title + ". Add a fact you personally checked; do not promise results.",
      captionMl: (title) => "Shorts-ൽ " + title + " നെ ചുരുക്കമായി പരിചയപ്പെടുത്തുന്നു. നിങ്ങൾ സ്വയം സ്ഥിരീകരിച്ച വിവരം മാത്രം ചേർക്കുക."
    }
  });
  const SUPPORTED = Object.freeze(Object.keys(PLATFORM_INFO));

  function clean(value, max = 500) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  }

  function uniqueClean(values, maxItems, maxLength) {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).map((value) => clean(value, maxLength))
      .filter((value) => {
        const key = value.toLowerCase();
        if (!value || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, maxItems);
  }

  function officialCampaignUrl(value) {
    try {
      const parsed = new URL(String(value || ""));
      const host = parsed.hostname.toLowerCase();
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "";
      if (host !== "contentrewards.com" && !host.endsWith(".contentrewards.com")) return "";
      if (!/^\/c\/campaigns\/[a-z0-9-]+\/?$/i.test(parsed.pathname)) return "";
      return parsed.origin + parsed.pathname.replace(/\/$/, "");
    } catch (_) {
      return "";
    }
  }

  function durationLabel(duration) {
    if (!duration || typeof duration !== "object") return "Not stated in the readable public brief";
    const min = Number.isFinite(duration.minSeconds) ? duration.minSeconds : null;
    const max = Number.isFinite(duration.maxSeconds) ? duration.maxSeconds : null;
    if (min == null && max == null) return "Not stated in the readable public brief";
    if (min != null && max != null) return min + "–" + max + " seconds";
    if (min != null) return "At least " + min + " seconds";
    return "Up to " + max + " seconds";
  }

  function formatLabel(brief) {
    const explicit = clean(brief && brief.creativeFormat, 120);
    return explicit || "Not stated — confirm the current brief before production";
  }

  function buildScenes(title) {
    return [
      {
        part: "0–10% · HOOK",
        purpose: "Earn attention without making a performance or income claim.",
        visual: "Use an original opening shot from your own footage. Do not show private account screens or unapproved brand material.",
        voiceoverEn: "Here is a quick introduction to " + title + ".",
        voiceoverMl: title + " നെക്കുറിച്ചുള്ള ഒരു ചെറിയ പരിചയം."
      },
      {
        part: "10–25% · CONTEXT",
        purpose: "Explain what the viewer is about to see.",
        visual: "Show the relevant subject or an approved campaign asset. Keep the source and usage rights clear.",
        voiceoverEn: "I will focus on the details that can be checked from the source.",
        voiceoverMl: "ഉറവിടത്തിൽ നിന്ന് പരിശോധിക്കാവുന്ന കാര്യങ്ങളിലാണ് ഞാൻ ശ്രദ്ധിക്കുന്നത്."
      },
      {
        part: "25–65% · MAIN POINT",
        purpose: "Show one useful point using evidence you personally verified.",
        visual: "Demonstrate the product, topic or process with your own footage or explicitly permitted assets.",
        voiceoverEn: "The point I personally checked is: [insert your verified observation].",
        voiceoverMl: "ഞാൻ നേരിട്ട് പരിശോധിച്ച കാര്യം: [സ്ഥിരീകരിച്ച വിവരം ഇവിടെ ചേർക്കുക]."
      },
      {
        part: "65–90% · TAKEAWAY",
        purpose: "Summarise without adding unsupported benefits.",
        visual: "Show the result or relevant detail honestly. Do not use before/after claims unless the campaign permits and the evidence supports them.",
        voiceoverEn: "What I can confirm is: [insert only a fact you can substantiate].",
        voiceoverMl: "എനിക്ക് സ്ഥിരീകരിക്കാനാകുന്നത്: [തെളിവുള്ള യഥാർത്ഥ വിവരം മാത്രം ചേർക്കുക]."
      },
      {
        part: "90–100% · CTA",
        purpose: "Give a neutral next step.",
        visual: "Finish with a clean end card. Add any required tags, mentions and disclosure before export.",
        voiceoverEn: "Check the official details and decide whether it is right for you.",
        voiceoverMl: "ഔദ്യോഗിക വിവരങ്ങൾ പരിശോധിച്ച് നിങ്ങൾക്ക് അനുയോജ്യമാണോ എന്ന് തീരുമാനിക്കുക."
      }
    ];
  }

  function create(row, options) {
    const source = row && typeof row === "object" ? row : {};
    const brief = source.brief && typeof source.brief === "object" ? source.brief : {};
    const opts = options && typeof options === "object" ? options : {};
    const fail = (message) => ({ ok: false, error: message });

    if (clean(brief.rawText, 20000).length < 12) return fail("The readable public campaign brief is incomplete. A safe content pack cannot be prepared.");

    const locked = Boolean(brief.hiddenRequirements && brief.hiddenRequirements.locked === true);
    const closed = ["Paused", "Ended / closed", "Out of budget"].includes(brief.campaignStatus);
    const preliminary = opts.allowPreliminary === true &&
      source.state === "verify" &&
      source.pageStatus === "ok" &&
      source.notSeenInLatestScan === false &&
      locked &&
      brief.platformMatch === "match" &&
      !closed;
    if (source.pageStatus !== "ok" || source.notSeenInLatestScan !== false) {
      return fail("The public campaign detail is stale or not confirmed in the latest scan. Refresh and verify it first.");
    }
    if (locked && !preliminary) {
      return fail("The brief hides creator requirements until Join. Only a preliminary script can be prepared from the visible public description.");
    }
    if (source.state !== "promising" && !preliminary) {
      return fail("A full content pack requires a fresh Promising campaign. A preliminary draft is available only for a current, readable Join-locked campaign with an explicit supported-platform match.");
    }
    if (closed) {
      return fail("The public brief indicates that this campaign is not currently suitable for a new content pack.");
    }

    const sourceUrl = officialCampaignUrl(source.url || brief.sourceUrl);
    if (!sourceUrl) return fail("A verified public Content Rewards campaign URL is required.");
    const title = clean(source.title || brief.title, 160);
    if (title.length < 3) return fail("The campaign title is not clear enough to prepare a content pack.");

    let platforms = uniqueClean(brief.platforms, 3, 30).filter((platform) => SUPPORTED.includes(platform));
    if (!platforms.length && SUPPORTED.includes(source.platform) && brief.platformMatch === "match") {
      platforms = [source.platform];
    }
    if (!platforms.length) return fail("The readable public brief does not confirm an accepted Instagram, Facebook or YouTube destination.");
    
    const hashtags = uniqueClean(brief.hashtags, 30, 60).filter((tag) => /^#[a-z0-9_]+$/i.test(tag));
    const mentions = uniqueClean(brief.mentions, 20, 80).filter((tag) => /^@[a-z0-9._]{2,}$/i.test(tag));
    const requirements = uniqueClean(brief.requirementLines, 24, 240);
    const disclosureRules = requirements.filter((line) => /\b(disclos|sponsor|paid partnership|affiliate|ad\b|advertis)/i.test(line));
    const prohibitionRules = requirements.filter((line) => /\b(no\b|do not|don't|must not|cannot|can't|prohibit|avoid|forbidden|watermark|repost|unlicensed|copyright)/i.test(line));
    const createdAt = opts.now instanceof Date && !Number.isNaN(opts.now.getTime())
      ? opts.now.toISOString()
      : new Date().toISOString();
    const scenes = buildScenes(title);
    const variants = platforms.map((platform) => ({
      platform,
      format: PLATFORM_INFO[platform].format,
      captionEn: PLATFORM_INFO[platform].captionEn(title),
      captionMl: PLATFORM_INFO[platform].captionMl(title),
      hookEn: scenes[0].voiceoverEn,
      hookMl: scenes[0].voiceoverMl,
      ctaEn: scenes[4].voiceoverEn,
      ctaMl: scenes[4].voiceoverMl
    }));

    return {
      ok: true,
      version: 1,
      generatedBy: "ClipReward Studio local template engine",
      createdAt,
      mode: preliminary ? "preliminary" : "complete",
      preliminaryOnly: preliminary,
      campaign: {
        title,
        brand: clean(source.brand, 120) || "Not stated",
        url: sourceUrl,
        deadline: clean(brief.deadline, 20) || "Not stated",
        campaignType: clean(brief.campaignType, 40) || "Not stated",
        acceptedPlatforms: platforms
      },
      sourceEvidence: {
        pageStatus: clean(source.pageStatus, 40) || "unknown",
        pageFetchedAt: clean(source.pageFetchedAt, 64),
        seenInLatestScan: source.notSeenInLatestScan === false,
        briefCompleteness: preliminary ? "partial-public-brief" : "readable-public-brief",
        hiddenRequirementsLocked: locked,
        hiddenRequirementCount: brief.hiddenRequirements && Number.isFinite(brief.hiddenRequirements.count) ? brief.hiddenRequirements.count : null,
        hiddenReferenceFileCount: brief.hiddenRequirements && Number.isFinite(brief.hiddenRequirements.referenceFiles) ? brief.hiddenRequirements.referenceFiles : null,
        capturedAt: createdAt
      },
      production: {
        duration: durationLabel(brief.duration),
        format: formatLabel(brief),
        aspectRatio: "Not stated — do not assume a campaign requirement",
        renderable: !preliminary,
        languages: uniqueClean(brief.languages, 8, 80),
        scenes
      },
      platformVariants: variants,
      hashtagsFound: hashtags,
      mentionsFound: mentions,
      publicRules: requirements,
      disclosureRules,
      prohibitionRules,
      safetyNotes: preliminary ? [
        "PRELIMINARY SCRIPT ONLY: the campaign hides creator requirements until Join. Do not render, export subtitles, publish or submit using this draft.",
        "Only visible public campaign text was used. Hidden requirements, reference files, account eligibility, current availability and approval conditions remain unknown.",
        "Open the official campaign page, Join only if you choose to, and read every unlocked requirement and reference file before production.",
        "Re-analyse the complete brief before creating a final video or campaign ZIP.",
        "This local template engine does not Join, Apply, publish, submit clips or verify payouts.",
        "Do not promise views, approval, eligibility, payout or earnings."
      ] : [
        "This is a local template pack, not an AI-generated or rendered video file.",
        "Only include product claims, benefits, results or personal experiences that you have independently verified.",
        "Do not promise views, approval, eligibility, payout or earnings.",
        "Use original footage or assets whose use is expressly permitted by the campaign and platform.",
        "Confirm the current live campaign brief, availability, deadline, format and every locked requirement before production."
      ]
    };
  }

  function toText(pack) {
    if (!pack || pack.ok !== true) throw new Error("A valid generated content pack is required.");
    const lines = [
      pack.preliminaryOnly ? "CLIPREWARD STUDIO · PRELIMINARY SCRIPT ONLY · NOT CLEARED FOR PRODUCTION" : "CLIPREWARD STUDIO · VIDEO-READY CONTENT PACK",
      "Generated: " + pack.createdAt,
      ...(pack.preliminaryOnly ? [
        "",
        "WARNING: Creator requirements and reference files are hidden until Join. This draft uses only visible public information.",
        "Do not create a final video, export subtitles, publish or submit until the full current brief is unlocked and re-analysed."
      ] : []),
      "Engine: " + pack.generatedBy,
      "",
      "CAMPAIGN",
      "Title: " + pack.campaign.title,
      "Brand: " + pack.campaign.brand,
      "Official page: " + pack.campaign.url,
      "Deadline: " + pack.campaign.deadline,
      "Campaign type: " + pack.campaign.campaignType,
      "Accepted platforms in readable brief: " + pack.campaign.acceptedPlatforms.join(", "),
      "",
      "PRODUCTION REQUIREMENTS",
      "Duration: " + pack.production.duration,
      "Format: " + pack.production.format,
      "Aspect ratio: " + pack.production.aspectRatio,
      "Languages found: " + (pack.production.languages.length ? pack.production.languages.join(", ") : "Not stated"),
      "",
      "SCENE-BY-SCENE STORYBOARD"
    ];
    pack.production.scenes.forEach((scene, index) => {
      lines.push(
        "",
        (index + 1) + ". " + scene.part,
        "Purpose: " + scene.purpose,
        "Visual: " + scene.visual,
        "English voiceover: " + scene.voiceoverEn,
        "Malayalam voiceover: " + scene.voiceoverMl
      );
    });
    pack.platformVariants.forEach((variant) => {
      lines.push(
        "",
        variant.platform.toUpperCase() + " · " + variant.format,
        "English caption: " + variant.captionEn,
        "Malayalam caption: " + variant.captionMl,
        "English hook: " + variant.hookEn,
        "Malayalam hook: " + variant.hookMl,
        "English CTA: " + variant.ctaEn,
        "Malayalam CTA: " + variant.ctaMl
      );
    });
    lines.push(
      "",
      "HASHTAGS FOUND IN THE PUBLIC BRIEF (CHECK WHETHER EACH IS REQUIRED)",
      pack.hashtagsFound.length ? pack.hashtagsFound.join(" ") : "None detected. Check the official brief for any required hashtags.",
      "",
      "MENTIONS FOUND IN THE PUBLIC BRIEF (CHECK WHETHER EACH IS REQUIRED)",
      pack.mentionsFound.length ? pack.mentionsFound.join(" ") : "None detected.",
      "",
      "DISCLOSURE RULES DETECTED",
      pack.disclosureRules.length ? pack.disclosureRules.map((line) => "- " + line).join("\n") : "No explicit disclosure line was recognised. Add a clear paid/sponsored/affiliate disclosure where required by the campaign or platform.",
      "",
      "RESTRICTIONS DETECTED",
      pack.prohibitionRules.length ? pack.prohibitionRules.map((line) => "- " + line).join("\n") : "No explicit prohibition line was recognised. Review all public campaign rules.",
      "",
      "PUBLIC BRIEF RULE LINES"
    );
    lines.push(...(pack.publicRules.length ? pack.publicRules.map((line) => "- " + line) : ["No explicit rule lines were recognised. Open and review the official campaign page."]));
    lines.push("", "SAFETY & VERIFICATION");
    pack.safetyNotes.forEach((line) => lines.push("- " + line));
    return lines.join("\n");
  }

  function toJson(pack) {
    if (!pack || pack.ok !== true) throw new Error("A valid generated content pack is required.");
    return JSON.stringify(pack, null, 2);
  }

  return Object.freeze({ SUPPORTED, officialCampaignUrl, durationLabel, create, toText, toJson });
});
