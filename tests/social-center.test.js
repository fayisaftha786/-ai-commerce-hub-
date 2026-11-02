"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const social = require("../social-center.js");

test("social metrics calculate engagement, click-through, and order rates", () => {
  const result = social.analyzeSocialMetrics({ reach: 1000, likes: 80, comments: 10, shares: 10, clicks: 50, orders: 5 });
  assert.equal(result.valid, true);
  assert.equal(result.interactions, 100);
  assert.equal(result.engagementRate, 10);
  assert.equal(result.clickThroughRate, 5);
  assert.equal(result.orderRate, 10);
});

test("social metrics avoid division by zero and reject invalid counts", () => {
  const zero = social.analyzeSocialMetrics({ reach: 0, likes: 0, comments: 0, shares: 0, clicks: 0, orders: 0 });
  assert.equal(zero.valid, true);
  assert.equal(zero.engagementRate, null);
  assert.equal(zero.clickThroughRate, null);
  assert.equal(zero.orderRate, null);
  assert.equal(social.analyzeSocialMetrics({ reach: -1, likes: 0, comments: 0, shares: 0, clicks: 0, orders: 0 }).valid, false);
  assert.equal(social.analyzeSocialMetrics({ reach: 1.5, likes: 0, comments: 0, shares: 0, clicks: 0, orders: 0 }).valid, false);
});

test("social desk clearly labels manual posting and includes upload and analytics controls", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(html.includes('id="socialMediaFiles"'));
  assert.ok(html.includes('id="socialCaption"'));
  assert.ok(html.includes('id="openSocialPlatform"'));
  assert.ok(html.includes('id="socialAnalyticsForm"'));
  assert.ok(html.includes("private backend supports official YouTube OAuth and server-side video uploads"));
  assert.ok(html.includes('id="publishYouTubeVideo"'));
  assert.ok(html.includes('src="social-center.js"'));
});

test("social analytics withholds order rate when orders exceed clicks", () => {
  const result = social.analyzeSocialMetrics({ reach: 1000, likes: 50, comments: 10, shares: 5, clicks: 20, orders: 25 });
  assert.equal(result.valid, true);
  assert.equal(result.orderRate, null);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Orders exceed clicks/);
});

test("social analytics rejects an unsafe aggregate interaction count", () => {
  const result = social.analyzeSocialMetrics({
    reach: 100,
    likes: Number.MAX_SAFE_INTEGER,
    comments: 1,
    shares: 0,
    clicks: 10,
    orders: 1
  });
  assert.equal(result.valid, false);
  assert.match(result.error, /safe numeric range/);
});


test("Social Desk validates a same-origin Clip Studio video handoff before loading it", () => {
  const valid = social.validatePostHandoff({
    platform: "youtube",
    title: "My clip",
    caption: "Original caption #Shorts",
    file: { name: "clip.mp4", type: "video/mp4", size: 1024 }
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.platform, "youtube");
  assert.equal(valid.caption, "Original caption #Shorts");
  assert.equal(valid.file.name, "clip.mp4");
  const campaignHandoff = social.validatePostHandoff({
    platform: "youtube",
    caption: "Campaign clip",
    campaignId: "campaign_123",
    campaignName: "Campaign test",
    requiresPreApproval: true,
    preApprovalConfirmed: true,
    file: { name: "clip.mp4", type: "video/mp4", size: 2048 }
  });
  assert.equal(campaignHandoff.valid, true);
  assert.equal(campaignHandoff.campaignId, "campaign_123");
  assert.equal(campaignHandoff.requiresPreApproval, true);
  assert.equal(social.validatePostHandoff({
    platform: "youtube",
    caption: "No confirmation",
    campaignId: "campaign_123",
    requiresPreApproval: true,
    preApprovalConfirmed: false,
    file: { name: "clip.mp4", type: "video/mp4", size: 2048 }
  }).valid, false);
  assert.equal(social.validatePostHandoff({
    platform: "youtube",
    caption: "Bad ID",
    campaignId: "invalid id",
    file: { name: "clip.mp4", type: "video/mp4", size: 2048 }
  }).valid, false);

  assert.equal(social.validatePostHandoff({
    platform: "instagram",
    caption: "caption",
    file: { name: "large.mp4", type: "video/mp4", size: social.MAX_FILE_BYTES + 1 }
  }).valid, false);

  assert.equal(social.validatePostHandoff({
    platform: "tiktok",
    caption: "caption",
    file: { name: "clip.mp4", type: "video/mp4", size: 100 }
  }).valid, false);

  assert.equal(social.validatePostHandoff({
    platform: "youtube",
    caption: "caption",
    file: { name: "photo.jpg", type: "image/jpeg", size: 100 }
  }).valid, false);
});

test("Social Desk includes X destination and checks the opener origin during Clip Studio handoff", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "..", "social-center.js"), "utf8");
  assert.ok(html.includes('<option value="x">X</option>'));
  assert.match(source, /event\.origin !== root\.location\.origin/);
  assert.match(source, /event\.source !== root\.opener/);
  assert.match(source, /AI_COMMERCE_SOCIAL_DESK_READY/);
  assert.match(source, /AI_COMMERCE_CLIP_HANDOFF_ACK/);
  assert.match(source, /AICommerceSocialHandoff/);
  assert.match(source, /campaignId/);
});
