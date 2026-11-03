"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const MetaConnect = require("../meta-social-connect.js");

test("accepts only secure backend origins for Meta publishing", () => {
  assert.equal(MetaConnect.normalizeBackendOrigin("https://api.example.com/"), "https://api.example.com");
  assert.equal(MetaConnect.normalizeBackendOrigin("http://localhost:3000"), "http://localhost:3000");
  for (const value of [
    "http://api.example.com",
    "https://user:pass@api.example.com",
    "https://api.example.com/path",
    "https://api.example.com/?token=secret",
    "javascript:alert(1)"
  ]) assert.equal(MetaConnect.normalizeBackendOrigin(value), "");
});

test("blocks Meta publishing until platform, Content Rewards join state and pre-approval gates pass", () => {
  assert.equal(MetaConnect.validateMetaPublishContext({ provider: "facebook", platform: "instagram" }).valid, false);
  const notJoined = MetaConnect.validateMetaPublishContext({
    provider: "instagram",
    platform: "instagram",
    campaignId: "campaign_1",
    campaignPlatform: "Content Rewards",
    campaignStatus: "idea"
  });
  assert.equal(notJoined.valid, false);
  assert.match(notJoined.error, /Join/);
  const accountNotVerified = MetaConnect.validateMetaPublishContext({
    provider: "instagram",
    platform: "instagram",
    campaignId: "campaign_1",
    campaignPlatform: "Content Rewards",
    campaignStatus: "ready",
    contentRewardsAccountVerified: false
  });
  assert.equal(accountNotVerified.valid, false);
  assert.match(accountNotVerified.error, /verify this exact posting account/i);
  const notAllowedPlatform = MetaConnect.validateMetaPublishContext({
    provider: "facebook",
    platform: "facebook",
    campaignId: "campaign_1",
    campaignPlatform: "Content Rewards",
    campaignStatus: "ready",
    contentRewardsAccountVerified: true,
    rules: "Accepted platforms: Instagram, YouTube"
  });
  assert.equal(notAllowedPlatform.valid, false);
  assert.match(notAllowedPlatform.error, /not listed/i);
  const needsApproval = MetaConnect.validateMetaPublishContext({
    provider: "facebook",
    platform: "facebook",
    campaignId: "campaign_1",
    campaignPlatform: "Content Rewards",
    campaignStatus: "ready",
    contentRewardsAccountVerified: true,
    requiresPreApproval: true,
    preApprovalConfirmed: false
  });
  assert.equal(needsApproval.valid, false);
  const approved = MetaConnect.validateMetaPublishContext({
    provider: "facebook",
    platform: "facebook",
    campaignId: "campaign_1",
    campaignPlatform: "Content Rewards",
    campaignStatus: "ready",
    contentRewardsAccountVerified: true,
    requiresPreApproval: true,
    preApprovalConfirmed: true
  });
  assert.deepEqual(approved, { valid: true, provider: "facebook", campaignId: "campaign_1" });
  assert.equal(MetaConnect.validateMetaPublishContext({
    provider: "instagram", platform: "instagram"
  }).valid, true);
});

test("Social Desk exposes Meta connect, Page selection, public confirmation and both Reels actions", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const worker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  const source = fs.readFileSync(path.join(root, "meta-social-connect.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json" ), "utf8"));
  for (const id of [
    "connectMetaAccount", "disconnectMetaAccount", "metaPageSelect",
    "metaAccountConnectionStatus", "meta-public-confirm", "content-rewards-account-verified",
    "publishFacebookReel", "publishInstagramReel", "checkFacebookReelStatus",
    "facebook-reel-id", "metaPublishStatus"
  ]) assert.ok(html.includes('id="' + id + '"'), "missing Meta control " + id);
  assert.match(html, /meta-social-connect\.js/);
  assert.match(worker, /ai-commerce-hub-pwa-v14/);
  assert.match(worker, /meta-social-connect\.js/);
  assert.match(packageJson.scripts.check, /meta-social-oauth\.js/);
  assert.match(packageJson.scripts.check, /meta-media-store\.js/);
  assert.match(source, /ai-commerce:social-handoff/);
  assert.match(source, /contentRewardsAccountVerified/);
  assert.match(source, /PublishMonitor\.pollUntilPublic/);
  assert.match(source, /autoPollFacebookPublication/);
  assert.match(worker, /social-publish-monitor\.js/);
});
