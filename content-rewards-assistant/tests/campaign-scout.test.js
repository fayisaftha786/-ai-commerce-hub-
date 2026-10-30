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
  assert.equal(result.confidence, "Good extraction");
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
  assert.match(notes, /Not found/);
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
  assert.match(worker, /clipreward-static-v6/);
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
