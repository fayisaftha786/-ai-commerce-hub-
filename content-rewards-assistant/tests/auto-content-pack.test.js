"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Pack = require("../auto-content-pack.js");

function row(overrides = {}) {
  return {
    id: "campaign-1",
    url: "https://contentrewards.com/c/campaigns/abc123",
    title: "Creator camera workflow",
    brand: "Sample Brand",
    platform: "Instagram",
    state: "promising",
    pageStatus: "ok",
    notSeenInLatestScan: false,
    brief: {
      title: "Creator camera workflow",
      sourceUrl: "https://contentrewards.com/c/campaigns/abc123",
      platformMatch: "match",
      platforms: ["Instagram", "Facebook", "YouTube"],
      duration: { minSeconds: 20, maxSeconds: 45 },
      creativeFormat: "9:16 · 1080x1920",
      languages: ["English or Malayalam"],
      hashtags: ["#SampleCampaign", "#CreatorTips"],
      mentions: ["@samplebrand"],
      requirementLines: [
        "Use original footage only.",
        "Include #SampleCampaign and @samplebrand in the caption.",
        "Add a paid partnership disclosure.",
        "No third-party watermark."
      ],
      hiddenRequirements: { locked: false },
      campaignStatus: "Appears live in copied text",
      rawText: "Campaign: Creator camera workflow\nInstagram Facebook YouTube\nAccepting clips\nOriginal footage only\n#SampleCampaign"
    },
    ...overrides
  };
}

test("builds a fresh bilingual content pack for every supported accepted platform", () => {
  const pack = Pack.create(row(), { now: new Date("2026-11-06T08:00:00.000Z") });
  assert.equal(pack.ok, true);
  assert.deepEqual(pack.campaign.acceptedPlatforms, ["Instagram", "Facebook", "YouTube"]);
  assert.deepEqual(pack.platformVariants.map((item) => item.format), [
    "Instagram Reels", "Facebook Reels", "YouTube Shorts"
  ]);
  assert.equal(pack.production.duration, "20–45 seconds");
  assert.equal(pack.production.format, "9:16 · 1080x1920");
  assert.equal(pack.production.scenes.length, 5);
  assert.match(pack.production.scenes[0].voiceoverMl, /പരിചയം/);
  assert.match(pack.platformVariants[2].captionEn, /Creator camera workflow/);
});

test("uses only tags and mentions explicitly found in the public brief", () => {
  const pack = Pack.create(row());
  assert.deepEqual(pack.hashtagsFound, ["#SampleCampaign", "#CreatorTips"]);
  assert.deepEqual(pack.mentionsFound, ["@samplebrand"]);
  const noTags = Pack.create(row({
    brief: { ...row().brief, hashtags: [], mentions: [], requirementLines: [] }
  }));
  assert.deepEqual(noTags.hashtagsFound, []);
  assert.deepEqual(noTags.mentionsFound, []);
  assert.match(Pack.toText(noTags), /None detected/);
});

test("keeps detected campaign rules and disclosure restrictions in the output", () => {
  const pack = Pack.create(row());
  assert.ok(pack.publicRules.includes("Use original footage only."));
  assert.deepEqual(pack.disclosureRules, ["Add a paid partnership disclosure."]);
  assert.ok(pack.prohibitionRules.some((line) => /No third-party watermark/i.test(line)));
  const text = Pack.toText(pack);
  assert.match(text, /Use original footage only/);
  assert.match(text, /paid partnership disclosure/);
});

test("prepares a clearly labelled preliminary script from a current, platform-matched Join-locked public brief", () => {
  const lockedRow = row({
    state: "verify",
    brief: {
      ...row().brief,
      hiddenRequirements: { locked: true, count: 1, referenceFiles: 3 },
      platformMatch: "match",
      campaignStatus: "Appears live in copied text",
      entryMode: "Open campaign / direct join"
    }
  });
  const pack = Pack.create(lockedRow, { allowPreliminary: true });
  assert.equal(pack.ok, true);
  assert.equal(pack.mode, "preliminary");
  assert.equal(pack.preliminaryOnly, true);
  assert.equal(pack.production.renderable, false);
  assert.equal(pack.sourceEvidence.briefCompleteness, "partial-public-brief");
  assert.equal(pack.sourceEvidence.hiddenRequirementsLocked, true);
  assert.equal(pack.sourceEvidence.hiddenRequirementCount, 1);
  assert.equal(pack.sourceEvidence.hiddenReferenceFileCount, 3);
  assert.ok(pack.safetyNotes.some((line) => /PRELIMINARY SCRIPT ONLY/i.test(line)));
  assert.match(Pack.toText(pack), /PRELIMINARY SCRIPT ONLY/);
  assert.match(Pack.toText(pack), /Do not create a final video/);
});

test("preliminary mode still refuses stale, historical, blocked or platform-unknown campaigns", () => {
  const locked = {
    ...row(),
    state: "verify",
    brief: {
      ...row().brief,
      hiddenRequirements: { locked: true, count: 1 },
      platformMatch: "match",
      campaignStatus: "Appears live in copied text"
    }
  };
  assert.match(Pack.create({ ...locked, pageStatus: "stale" }, { allowPreliminary: true }).error, /stale/);
  assert.match(Pack.create({ ...locked, notSeenInLatestScan: true }, { allowPreliminary: true }).error, /stale/);
  assert.match(Pack.create({ ...locked, state: "blocked" }, { allowPreliminary: true }).error, /fresh Promising/);
  assert.match(Pack.create({
    ...locked,
    brief: { ...locked.brief, platformMatch: "unknown" }
  }, { allowPreliminary: true }).error, /fresh Promising/);
  assert.match(Pack.create({
    ...locked,
    brief: { ...locked.brief, campaignStatus: "Paused" }
  }, { allowPreliminary: true }).error, /fresh Promising/);
});

test("rejects stale, historical, non-promising and join-locked campaigns", () => {
  assert.match(Pack.create(row({ state: "verify" })).error, /fresh Promising/);
  assert.match(Pack.create(row({ pageStatus: "stale" })).error, /stale/);
  assert.match(Pack.create(row({ notSeenInLatestScan: true })).error, /stale/);
  assert.match(Pack.create(row({
    brief: { ...row().brief, hiddenRequirements: { locked: true } }
  })).error, /hides creator requirements/);
});

test("rejects paused, ended and exhausted campaign briefs", () => {
  for (const campaignStatus of ["Paused", "Ended / closed", "Out of budget"]) {
    assert.match(Pack.create(row({
      brief: { ...row().brief, campaignStatus }
    })).error, /not currently suitable/);
  }
});

test("accepts only official public Content Rewards campaign URLs", () => {
  assert.equal(Pack.officialCampaignUrl("http://contentrewards.com/c/campaigns/abc123"), "");
  assert.equal(Pack.officialCampaignUrl("https://evil.example/c/campaigns/abc123"), "");
  assert.equal(Pack.officialCampaignUrl("https://contentrewards.com/c/campaigns/abc123?next=evil"), "https://contentrewards.com/c/campaigns/abc123");
  assert.equal(Pack.officialCampaignUrl("https://user:pass@contentrewards.com/c/campaigns/abc123"), "");
  assert.match(Pack.create(row({ url: "https://evil.example/c/campaigns/abc123" })).error, /verified public Content Rewards/);
});

test("does not create India-target content variants for TikTok or X", () => {
  const unsupportedOnly = row({
    platform: "TikTok",
    brief: { ...row().brief, platforms: ["TikTok", "X"], platformMatch: "match" }
  });
  assert.match(Pack.create(unsupportedOnly).error, /does not confirm an accepted/);
  const mixed = Pack.create(row({
    brief: { ...row().brief, platforms: ["TikTok", "X", "YouTube"] }
  }));
  assert.deepEqual(mixed.campaign.acceptedPlatforms, ["YouTube"]);
});

test("uses the analysing platform only when the parser explicitly confirmed a match", () => {
  const yes = Pack.create(row({
    platform: "Facebook",
    brief: { ...row().brief, platforms: [], platformMatch: "match" }
  }));
  assert.deepEqual(yes.campaign.acceptedPlatforms, ["Facebook"]);
  const no = Pack.create(row({
    platform: "Facebook",
    brief: { ...row().brief, platforms: [], platformMatch: "unknown" }
  }));
  assert.equal(no.ok, false);
});

test("leaves duration and creative format unknown instead of inventing campaign requirements", () => {
  const pack = Pack.create(row({
    brief: { ...row().brief, duration: null, creativeFormat: "" }
  }));
  assert.match(pack.production.duration, /Not stated/);
  assert.match(pack.production.format, /Not stated/);
  assert.match(pack.production.aspectRatio, /do not assume/);
});

test("exports safe plain text and JSON without reward guarantees", () => {
  const pack = Pack.create(row());
  const text = Pack.toText(pack);
  const json = Pack.toJson(pack);
  assert.match(text, /VIDEO-READY CONTENT PACK/);
  assert.match(text, /Malayalam voiceover/);
  assert.match(text, /Do not promise views, approval, eligibility, payout or earnings/);
  assert.doesNotMatch(text, /guaranteed payout/);
  assert.equal(JSON.parse(json).campaign.title, "Creator camera workflow");
  assert.throws(() => Pack.toText({ ok: false }), /valid generated content pack/);
});

test("refuses an incomplete public brief and missing title", () => {
  assert.match(Pack.create(row({
    brief: { ...row().brief, rawText: "" }
  })).error, /public campaign brief is incomplete/);
  assert.match(Pack.create(row({
    title: "",
    brief: { ...row().brief, title: "" }
  })).error, /title is not clear enough/);
});

test("retains public-page freshness metadata with generated campaign content", () => {
  const pack = Pack.create(row({
    pageFetchedAt: "2026-11-06T08:30:00.000Z",
    pageStatus: "ok",
    notSeenInLatestScan: false
  }));
  assert.deepEqual(pack.sourceEvidence, {
    pageStatus: "ok",
    pageFetchedAt: "2026-11-06T08:30:00.000Z",
    seenInLatestScan: true,
    briefCompleteness: "readable-public-brief",
    hiddenRequirementsLocked: false,
    hiddenRequirementCount: null,
    hiddenReferenceFileCount: null,
    capturedAt: pack.createdAt
  });
});

test("retains public-page freshness metadata with generated campaign content", () => {
  const pack = Pack.create(row({
    pageFetchedAt: "2026-11-06T08:30:00.000Z",
    pageStatus: "ok",
    notSeenInLatestScan: false
  }));
  assert.deepEqual(pack.sourceEvidence, {
    pageStatus: "ok",
    pageFetchedAt: "2026-11-06T08:30:00.000Z",
    seenInLatestScan: true,
    briefCompleteness: "readable-public-brief",
    hiddenRequirementsLocked: false,
    hiddenRequirementCount: null,
    hiddenReferenceFileCount: null,
    capturedAt: pack.createdAt
  });
});
