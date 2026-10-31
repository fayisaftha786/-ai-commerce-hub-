"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Feed = require("../campaign-feed.js");

const NOW = Date.parse("2026-10-31T00:00:00Z");
const sample = {
  success: true,
  data: [
    {
      externalId: "ig-1", title: "Instagram Creator Campaign", brand: "Sample Brand",
      type: "clipping", description: "Make an original short video",
      requirements_text: "Must disclose sponsorship",
      url: "https://contentrewards.com/c/campaigns/ig-1",
      payouts: [{ platform: "instagram", ratePerKViews: 2.5, minViewsRequired: 1000, maxPayoutPerSubmission: 80 }],
      latest_snapshot: { snapshotDate: "2026-10-29", budgetUsd: 5000, budgetSpentUsd: 1250 }
    },
    {
      externalId: "tt-1", title: "TikTok Only", payouts: [{ platform: "tiktok", ratePerKViews: 9 }],
      latest_snapshot: { snapshotDate: "2026-10-30" }
    },
    {
      externalId: "fb-old", title: "Old Facebook Campaign",
      payouts: [{ platform: "facebook", ratePerKViews: 1 }],
      latest_snapshot: { snapshotDate: "2026-10-01", budgetUsd: 100, budgetSpentUsd: 100 }
    }
  ]
};

test("normalizes campaign fields and calculates freshness and snapshot remaining budget", () => {
  const result = Feed.normalizeResponse(sample, NOW);
  const instagram = result.find((item) => item.id === "ig-1");
  assert.equal(instagram.title, "Instagram Creator Campaign");
  assert.equal(instagram.payouts[0].platform, "Instagram");
  assert.equal(instagram.remainingUsd, 3750);
  assert.equal(instagram.freshness, "recent");
  assert.equal(instagram.officialUrl, "https://contentrewards.com/c/campaigns/ig-1");
  assert.equal(result.find((item) => item.id === "fb-old").freshness, "stale");
});

test("filters to the selected platform, excludes TikTok-only India leads and ranks by rate", () => {
  const rows = Feed.normalizeResponse(sample, NOW);
  const filtered = Feed.filterCampaigns(rows, { platform: "Instagram" });
  assert.deepEqual(filtered.map((item) => item.id), ["ig-1"]);
});

test("rejects untrusted campaign links and never invents official campaign URLs", () => {
  const normalized = Feed.normalizeCampaign({
    externalId: "bad-link", url: "https://evil.example/campaign",
    payouts: [{ platform: "youtube", ratePerKViews: 1 }]
  }, NOW);
  assert.equal(normalized.officialUrl, "");
  assert.equal(Feed.campaignToBrief(normalized, "YouTube").includes("Third-party scraped snapshot"), true);
});

test("builds a platform-specific import brief with visible third-party warning", () => {
  const campaign = Feed.normalizeCampaign(sample.data[0], NOW);
  const brief = Feed.campaignToBrief(campaign, "Instagram");
  assert.match(brief, /\$2.5/);
  assert.match(brief, /Minimum views: 1000/);
  assert.match(brief, /Maximum payout per submission: \$80/);
  assert.match(brief, /not an official campaign brief/i);
});

test("fetches public campaign leads without credentials and handles response shape", async () => {
  let request;
  const result = await Feed.fetchCampaigns({
    platform: "Instagram", now: NOW,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => sample };
    }
  });
  assert.match(request.url, /limit=100/);
  assert.match(request.url, /sort=rate/);
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.mode, "cors");
  assert.deepEqual(result.campaigns.map((item) => item.id), ["ig-1"]);
});

test("reports source/network failures instead of returning fabricated empty results", async () => {
  await assert.rejects(
    Feed.fetchCampaigns({ fetchImpl: async () => { throw new Error("blocked"); } }),
    /could not be reached/
  );
  assert.throws(() => Feed.normalizeResponse({ success: true, data: "not-an-array" }, NOW), /format was not recognised/);
});

test("canonical campaign URLs accept only public Content Rewards campaign pages", () => {
  assert.equal(Feed.canonicalCampaignUrl("https://contentrewards.com/c/campaigns/abc?ref=discover#top"), "https://contentrewards.com/c/campaigns/abc");
  assert.equal(Feed.canonicalCampaignUrl("https://www.contentrewards.com/c/my-campaign/"), "https://www.contentrewards.com/c/my-campaign");
  assert.equal(Feed.canonicalCampaignUrl("https://contentrewards.com/c/discover"), "");
  assert.equal(Feed.canonicalCampaignUrl("https://contentrewards.com/c/"), "");
  assert.equal(Feed.canonicalCampaignUrl("https://evil.example/c/campaigns/abc"), "");
  assert.equal(Feed.canonicalCampaignUrl("http://contentrewards.com/c/campaigns/abc"), "");
  assert.equal(Feed.canonicalCampaignUrl("javascript:alert(1)"), "");
});
