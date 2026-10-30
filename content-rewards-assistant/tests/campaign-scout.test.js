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
  assert.match(html, /id="scout-target-platform"/);
  assert.match(html, /id="scout-paste-button"/);
  assert.match(html, /campaign-scout\.js/);
  assert.match(app, /ClipRewardScout\.parseCampaignBrief/);
  assert.match(app, /ClipRewardScout\.buildTrackerNotes/);
  assert.match(app, /autofillCampaignTracker/);
  assert.match(app, /pasteCampaignBriefFromClipboard/);
  assert.match(app, /result\.platformMatch === "mismatch"/);
  assert.match(worker, /clipreward-static-v3/);
  assert.match(worker, /campaign-scout\.js/);
});


test("campaign finder distinguishes direct join from application review", () => {
  const direct = Scout.parseCampaignBrief({ text: ["Campaign: Open campaign", "Join Campaign", "TikTok"].join("\n") });
  assert.equal(direct.entryMode, "Open campaign / direct join");
  const application = Scout.parseCampaignBrief({ text: ["Campaign: Screened campaign", "Apply now", "Instagram"].join("\n") });
  assert.equal(application.entryMode, "Application / brand review");
});

test("platform-specific finder matches Instagram, Facebook and YouTube, and blocks an explicit mismatch", () => {
  const brief = [
    "Campaign: Three platform launch",
    "$2/1K views",
    "$1K/$5K",
    "Platforms: Instagram, Facebook and YouTube",
    "Must use original clips only."
  ].join("\n");
  for (const platform of ["Instagram", "Facebook", "YouTube"]) {
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
