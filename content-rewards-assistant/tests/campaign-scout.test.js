"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Scout = require("../campaign-scout.js");
const fs = require("node:fs");
const path = require("node:path");

test("campaign brief parser extracts title, CPM, used and total budget, platforms, category, deadline and requirements", () => {
  const result = Scout.parseCampaignBrief({
    url: "https://contentrewards.com/c/campaign/example",
    text: [
      "Campaign: Seasonal Gaming Clips",
      "Creator campaign",
      "$2.50/1K views",
      "$1.2K/$5K",
      "Join Campaign",
      "Platforms: TikTok, YouTube and Instagram",
      "Category: Gaming",
      "Deadline: 2026-12-01",
      "Requirements:",
      "Must post original clips only.",
      "Minimum 30 seconds, include #sponsored disclosure."
    ].join("\n")
  });
  assert.equal(result.title, "Seasonal Gaming Clips");
  assert.equal(result.rate.model, "CPM");
  assert.equal(result.rate.amount.value, 2.5);
  assert.equal(result.budget.spent.value, 1200);
  assert.equal(result.budget.total.value, 5000);
  assert.equal(result.budget.remaining.value, 3800);
  const compactBudget = Scout.parseCampaignBrief({ text: "Campaign: Compact pool\\n$2/1K views\\n0/$1.3K\\nInstagram" });
  assert.equal(compactBudget.budget.spent.value, 0);
  assert.equal(compactBudget.budget.total.value, 1300);
  assert.equal(compactBudget.budget.remaining.value, 1300);
  assert.equal(result.entryMode, "Open campaign / direct join");
  assert.deepEqual(result.platforms, ["TikTok", "Instagram", "YouTube"]);
  assert.equal(result.category, "Gaming");
  assert.equal(result.deadline, "2026-12-01");
  assert.equal(result.requirementLines.length >= 2, true);
  assert.equal(result.sourceUrl, "https://contentrewards.com/c/campaign/example");
  assert.equal(result.confidence, "Strong field coverage");
  assert.equal(result.coverageScore, 100);
});

test("campaign brief parser recognises per-post and retainer models without inventing a CPM", () => {
  const perPost = Scout.parseCampaignBrief({
    text: ["Title: Product demo", "$250 per post", "Platform: Instagram", "Budget: $2K", "Apply now"].join("\n")
  });
  assert.equal(perPost.rate.model, "Per post");
  assert.equal(perPost.rate.amount.value, 250);
  assert.equal(perPost.budget.total.value, 2000);
  assert.equal(perPost.entryMode, "Application / brand review");

  const retainer = Scout.parseCampaignBrief({
    text: "Campaign: Monthly clips\nRetainer partnership\nYouTube"
  });
  assert.equal(retainer.rate.model, "Retainer");
  assert.equal(retainer.rate.amount, null);
});

test("campaign parser leaves unsupported and unavailable fields unknown", () => {
  const result = Scout.parseCampaignBrief({
    url: "http://contentrewards.com/c/private",
    text: "Campaign: Mystery project\nA short creative brief with no price."
  });
  assert.equal(result.rate, null);
  assert.equal(result.budget, null);
  assert.deepEqual(result.platforms, []);
  assert.equal(result.sourceUrl, "");
  assert.ok(result.missing.some((item) => /budget/i.test(item)));
  assert.ok(result.missing.some((item) => /Official Content Rewards campaign URL/i.test(item)));
});

test("campaign source link rejects credentials and non-Content Rewards hosts", () => {
  const result = Scout.parseCampaignBrief({
    url: "https://contentrewards.com.evil.test/campaign",
    text: "Campaign: Test title\nInstagram"
  });
  assert.equal(result.sourceUrl, "");
});

test("campaign parser detects embedded Content Rewards URL and named-month deadlines", () => {
  const result = Scout.parseCampaignBrief({
    requestedPlatform: "Facebook",
    text: [
      "Campaign: Creator Launch",
      "https://contentrewards.com/c/campaign/creator-launch",
      "$2/1K views",
      "Platforms: Facebook, Instagram and YouTube",
      "Deadline: December 1, 2026",
      "Must publish original clips and include disclosure."
    ].join("\n")
  });
  assert.equal(result.sourceUrl, "https://contentrewards.com/c/campaign/creator-launch");
  assert.equal(result.deadline, "2026-12-01");
  assert.equal(result.platformMatch, "match");
  const dayFirst = Scout.parseCampaignBrief({ text: "Campaign: Day first\nDeadline: 2 Dec 2026\nYouTube" });
  assert.equal(dayFirst.deadline, "2026-12-02");
  const invalid = Scout.parseCampaignBrief({ text: "Campaign: Bad date\nDeadline: February 31, 2027\nInstagram" });
  assert.equal(invalid.deadline, "");
});

test("autofill notes preserve uncertainty and include extracted evidence", () => {
  const result = Scout.parseCampaignBrief({
    url: "https://contentrewards.com/c/demo",
    text: "Campaign: Demo Clips\n$1.50 CPM\nPlatforms: TikTok\nMust be original."
  });
  const notes = Scout.buildTrackerNotes(result);
  assert.match(notes, /verify against the official campaign page/i);
  assert.match(notes, /\$1.5 per 1,000 views/);
  assert.match(notes, /TikTok/);
  assert.match(notes, /Joining method: Not stated/);
  assert.match(notes, /Must be original/);
  assert.match(notes, /Not recognised/);
});

test("India workflow flags TikTok from a public campaign brief without treating it as an available destination", () => {
  const result = Scout.parseCampaignBrief({
    requestedPlatform: "Instagram",
    text: ["Campaign: India creator offer", "$2/1K views", "Platforms: TikTok and Instagram", "Must publish original clips."].join("\n")
  });
  assert.equal(result.platformMatch, "match");
  assert.deepEqual(result.unsupportedPlatforms, ["TikTok"]);
  assert.ok(result.findings.some((item) => item.label === "Not available in India" && /TikTok/.test(item.value)));
  assert.ok(result.missing.some((item) => /TikTok is not available in the India workflow/.test(item)));
  assert.match(Scout.buildTrackerNotes(result), /Platforms unavailable in the India workflow: TikTok/);
});

test("India ClipReward selectors default to supported platforms and do not offer TikTok", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  for (const id of ["social-platform", "draft-platform", "campaign-platform", "campaign-post-platform"]) {
    const match = html.match(new RegExp('<select id="' + id + '"[^>]*>([\\s\\S]*?)</select>'));
    assert.ok(match, "missing selector " + id);
    assert.doesNotMatch(match[1], /TikTok/i, id + " must not offer TikTok in the India workflow");
  }
  const draftOptions = html.match(/<select id="draft-platform"[^>]*>([\s\S]*?)<\/select>/)[1];
  assert.ok(draftOptions.trim().startsWith("<option>Instagram Reels</option>"));
  assert.match(html, /TikTok is not available in India/i);
  assert.match(html, /18\+ only/i);
  assert.doesNotMatch(html, /CR-XXXXXX|code expires after 24 hours/i);
});

test("campaign finder is wired to official Discover, local parser, and existing tracker autofill", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const worker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  assert.match(html, /https:\/\/contentrewards\.com\/c\/discover/);
  assert.match(html, /id="campaign-scout-form"/);
  assert.match(html, /id="scout-autofill-button"/);
  assert.match(html, /data-scout-platform-link="Instagram"/);
  assert.match(html, /data-scout-platform-link="Facebook"/);
  assert.match(html, /data-scout-platform-link="YouTube"/);
  assert.match(html, /professional dashboard/i);
  assert.ok(html.includes("studio.youtube.com"));
  assert.match(html, /creator marketplace/i);
  assert.match(html, /id="scout-target-platform"/);
  assert.match(html, /<option value="X">X<\/option>/);
  assert.match(html, /data-scout-platform-link="X"/);
  assert.match(html, /id="scout-paste-button"/);
  assert.match(html, /campaign-scout\.js/);
  assert.match(app, /ClipRewardScout\.parseCampaignBrief/);
  assert.match(app, /ClipRewardScout\.buildTrackerNotes/);
  assert.match(app, /autofillCampaignTracker/);
  assert.match(app, /pasteCampaignBriefFromClipboard/);
  assert.ok(app.includes("analyseCampaignBrief();"));
  assert.ok(app.includes('addEventListener("input"'));
  assert.match(app, /result\.platformMatch === "mismatch"/);
  assert.match(worker, /clipreward-static-v9/);
  assert.match(worker, /campaign-scout\.js/);
});


test("campaign finder distinguishes direct join from application review", () => {
  const direct = Scout.parseCampaignBrief({ text: ["Campaign: Open campaign", "Join Campaign", "TikTok"].join("\n") });
  assert.equal(direct.entryMode, "Open campaign / direct join");
  const application = Scout.parseCampaignBrief({ text: ["Campaign: Screened campaign", "Apply now", "Instagram"].join("\n") });
  assert.equal(application.entryMode, "Application / brand review");
});

test("platform-specific finder matches Instagram, Facebook, YouTube and X, and blocks an explicit mismatch", () => {
  const brief = [
    "Campaign: Four platform launch",
    "$2/1K views",
    "$1K/$5K",
    "Platforms: Instagram, Facebook, YouTube and X",
    "Must use original clips only."
  ].join("\n");
  for (const platform of ["Instagram", "Facebook", "YouTube", "X"]) {
    const match = Scout.parseCampaignBrief({ requestedPlatform: platform, text: brief });
    assert.equal(match.platformMatch, "match", platform);
    assert.equal(match.requestedPlatform, platform);
  }
  const mismatch = Scout.parseCampaignBrief({
    requestedPlatform: "Instagram",
    text: "Campaign: YouTube only\n$2/1K views\nPlatforms: YouTube"
  });
  assert.equal(mismatch.platformMatch, "mismatch");
  assert.ok(mismatch.missing.some((item) => /Instagram is not listed/i.test(item)));
  const unknown = Scout.parseCampaignBrief({
    requestedPlatform: "Facebook",
    text: "Campaign: No platform stated\n$2/1K views"
  });
  assert.equal(unknown.platformMatch, "unknown");
});

test("campaign parser recognises shared pool payout models without inventing a per-view rate", () => {
  const result = Scout.parseCampaignBrief({
    requestedPlatform: "X",
    text: ["Campaign: Creator pool", "Payout model: Pool", "Platforms: X and Instagram", "Deadline: 2026-12-15"].join("\n")
  });
  assert.equal(result.rate.model, "Pool");
  assert.equal(result.rate.amount, null);
  assert.match(result.rate.label, /variable allocation/i);
  assert.equal(result.platformMatch, "match");
});

test("unified Rewards Intelligence engine is loaded and displayed with the campaign findings", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const worker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  assert.match(html, /rewards-intelligence\.js/);
  assert.match(html, /id="reward-intelligence-results"/);
  assert.match(app, /ClipRewardIntelligence\.assessAll/);
  assert.match(app, /renderRewardsIntelligence/);
  assert.match(worker, /clipreward-static-v9/);
  assert.match(worker, /rewards-intelligence\.js/);
});


test("full copied campaign page keeps rule lines beyond the 1,400-character preview", () => {
  const filler = Array.from({ length: 120 }, (_, index) => "Campaign overview detail " + index + " describes the product and creator audience.").join("\n");
  const text = [
    "Campaign: Full length campaign",
    "Platforms: Instagram and YouTube",
    "$2 CPM",
    "Budget left: $650",
    "Deadline: 2026-12-20",
    "Join Campaign",
    filler,
    "Do not use watermarked footage. Only publish original content with licensed audio."
  ].join("\n");
  const result = Scout.parseCampaignBrief({ requestedPlatform: "Instagram", text });
  assert.ok(result.rawText.length > 1400);
  assert.equal(result.rawExcerpt.length, 1400);
  assert.match(result.rawText, /Do not use watermarked footage/);
  assert.ok(result.requirementLines.some((line) => /watermarked footage/i.test(line)));
  assert.equal(result.budget.remaining.value, 650);
  const engine = require("../rewards-intelligence.js");
  assert.ok(engine.inferBriefRequirements(result).some((item) => item.key === "prohibited-actions"));
});

test("budget-left cards and spent/total budgets are parsed without guessing the missing total", () => {
  const remaining = Scout.parseCampaignBrief({
    text: "Campaign: Budget left offer\nPlatforms: Instagram\nBudget left: $375\nCPM: $1.75\nDeadline: 2026-12-01\nJoin Campaign"
  });
  assert.equal(remaining.budget.total, null);
  assert.equal(remaining.budget.spent, null);
  assert.deepEqual(remaining.budget.remaining, { value: 375, currency: "USD", raw: "$375" });
  const spent = Scout.parseCampaignBrief({
    text: "Campaign: Spent offer\nPlatforms: YouTube\n$1.2K/$5K\nBudget remaining: $3.8K"
  });
  assert.equal(spent.budget.spent.value, 1200);
  assert.equal(spent.budget.total.value, 5000);
  assert.equal(spent.budget.remaining.value, 3800);
});

test("platform sections retain their own CPM rates, caps and view thresholds", () => {
  const result = Scout.parseCampaignBrief({
    requestedPlatform: "YouTube",
    text: [
      "Campaign: Platform rates",
      "Platforms: Instagram and YouTube",
      "Instagram",
      "$2.50 CPM",
      "Minimum views: 5K",
      "Max per clip: $75",
      "YouTube",
      "$1.25 CPM",
      "Minimum views: 10,000",
      "Max per clip: $40",
      "Budget left: $1K",
      "Deadline: December 20, 2026",
      "Join Campaign"
    ].join("\n")
  });
  assert.deepEqual(result.platformRates.map((item) => [item.platform, item.amount.value]), [["Instagram", 2.5], ["YouTube", 1.25]]);
  assert.deepEqual(result.platformCaps.map((item) => [item.platform, item.amount.value]), [["Instagram", 75], ["YouTube", 40]]);
  assert.deepEqual(result.platformMinimumViews.map((item) => [item.platform, item.value]), [["Instagram", 5000], ["YouTube", 10000]]);
  assert.equal(result.platformMatch, "match");
});

test("campaign parser identifies minimum followers, duration, format, language, access and content type", () => {
  const result = Scout.parseCampaignBrief({
    text: [
      "Campaign: Malayalam UGC",
      "Campaign type: UGC",
      "Application-only",
      "Platforms: Instagram and Facebook",
      "Minimum 10K followers",
      "Minimum 30 seconds",
      "Maximum 60 seconds",
      "Format: 9:16 vertical 1080x1920",
      "Languages: Malayalam and English",
      "Deadline: 2026-12-30",
      "Must include #ad and mention @brand"
    ].join("\n")
  });
  assert.equal(result.campaignType, "UGC");
  assert.equal(result.entryMode, "Application / brand review");
  assert.equal(result.minimumFollowers, 10000);
  assert.deepEqual(result.duration, { minSeconds: 30, maxSeconds: 60 });
  assert.match(result.creativeFormat, /9:16/);
  assert.match(result.creativeFormat, /1080x1920/);
  assert.deepEqual(result.languages, ["Malayalam and English"]);
  assert.deepEqual(result.hashtags, ["#ad"]);
  assert.deepEqual(result.mentions, ["@brand"]);
});

test("parser separates explicitly excluded platforms from accepted destinations", () => {
  const result = Scout.parseCampaignBrief({
    requestedPlatform: "Instagram",
    text: [
      "Campaign: Platform exclusions",
      "Do not publish this offer on TikTok.",
      "Accepted platforms: Instagram and YouTube",
      "$2 CPM"
    ].join("\n")
  });
  assert.deepEqual(result.platforms, ["Instagram", "YouTube"]);
  assert.deepEqual(result.excludedPlatforms, ["TikTok"]);
  assert.equal(result.platformMatch, "match");
});

test("parser marks application-only, invitation-only and exhausted campaigns distinctly", () => {
  const application = Scout.parseCampaignBrief({ text: "Campaign: Apply-only\nApplication-only\nInstagram" });
  assert.equal(application.entryMode, "Application / brand review");
  const privateOffer = Scout.parseCampaignBrief({ text: "Campaign: Private offer\nPrivate / invite-only\nInstagram" });
  assert.equal(privateOffer.entryMode, "Private / invitation-only");
  const exhausted = Scout.parseCampaignBrief({ text: "Campaign: Empty offer\nPlatforms: YouTube\nBudget left: $0" });
  assert.equal(exhausted.campaignStatus, "Out of budget");
});

test("generic creator campaign labels are not mistaken for a campaign title", () => {
  const result = Scout.parseCampaignBrief({ text: "Creator campaign\nDiscover\nPlatforms: Instagram\n$2 CPM" });
  assert.equal(result.title, "");
});

test("CPM, per-post and retainer rates accept common reversed label formats", () => {
  assert.equal(Scout.parseRate("CPM: $2.25").amount.value, 2.25);
  assert.equal(Scout.parseRate("Per post: $125").amount.value, 125);
  assert.equal(Scout.parseRate("Retainer: $500 monthly").amount.value, 500);
});
