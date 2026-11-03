"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer, createPublicCampaignPageRateLimiter } = require("../server.js");

async function withServer(callback, options = {}) {
  const server = createServer({
    env: { DISCOVERY_CORS_ORIGINS: "https://app.example.com", ...options.env },
    publicCampaignPageFetcher: options.publicCampaignPageFetcher,
    publicCampaignPageLimiter: options.publicCampaignPageLimiter,
    maxConcurrentPublicCampaignScans: options.maxConcurrentPublicCampaignScans
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  try { await callback("http://127.0.0.1:" + address.port); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

function publicDetail(url = "https://contentrewards.com/c/campaigns/live-123") {
  return {
    url, finalUrl: url, status: "ok", fetchedAt: "2026-11-03T06:00:00.000Z",
    httpStatus: 200, contentType: "text/html", htmlBytes: 420, requestAttempts: 1,
    pageTitle: "Live campaign",
    pageText: "Campaign: Live public campaign\nInstagram\nAccepting clips\n$2 per 1,000 views",
    textLength: 83, detected: { platforms: ["Instagram"], missing: [] }
  };
}

test("rate limiter allows a bounded number of requests and reports a retry window", () => {
  let now = 1000;
  const limiter = createPublicCampaignPageRateLimiter({ limit: 2, windowMs: 5000, now: () => now });
  assert.equal(limiter.consume("ip-a").allowed, true);
  assert.equal(limiter.consume("ip-a").allowed, true);
  const denied = limiter.consume("ip-a");
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 5);
  assert.equal(limiter.consume("ip-b").allowed, true);
  now += 5001;
  assert.equal(limiter.consume("ip-a").allowed, true);
});

test("live campaign endpoint reads one canonical public Content Rewards URL and returns official-source detail", async () => {
  const calls = [];
  await withServer(async (base) => {
    const response = await fetch(base + "/api/discovery/analyze-public-campaign", {
      method: "POST",
      headers: { Origin: "https://app.example.com", "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ url: "https://contentrewards.com/c/campaigns/live-123?utm_source=private" })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://app.example.com");
    assert.equal(payload.sourceVerification, "official-public-page");
    assert.equal(payload.detail.status, "ok");
    assert.equal(payload.detail.url, "https://contentrewards.com/c/campaigns/live-123");
    assert.match(payload.detail.pageText, /Live public campaign/);
    assert.match(payload.note, /No Content Rewards login/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://contentrewards.com/c/campaigns/live-123");
    assert.equal(calls[0].options.timeoutMs, 10000);
  }, { publicCampaignPageFetcher: async (url, options) => { calls.push({ url, options }); return publicDetail(url); } });
});

test("live campaign endpoint rejects non-Content-Rewards URLs without fetching", async () => {
  let calls = 0;
  await withServer(async (base) => {
    for (const url of [
      "https://evil.example/c/campaigns/one",
      "http://contentrewards.com/c/campaigns/one",
      "https://contentrewards.com/c/settings",
      "https://contentrewards.com.evil.example/c/campaigns/one"
    ]) {
      const response = await fetch(base + "/api/discovery/analyze-public-campaign", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url })
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, "unsupported_campaign_url");
    }
    assert.equal(calls, 0);
  }, { publicCampaignPageFetcher: async () => { calls += 1; return publicDetail(); } });
});

test("live campaign endpoint enforces the configured CORS origin and JSON request body", async () => {
  await withServer(async (base) => {
    const deniedOrigin = await fetch(base + "/api/discovery/analyze-public-campaign", {
      method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://contentrewards.com/c/campaigns/one" })
    });
    assert.equal(deniedOrigin.status, 403);
    const wrongType = await fetch(base + "/api/discovery/analyze-public-campaign", {
      method: "POST", headers: { Origin: "https://app.example.com", "Content-Type": "text/plain" },
      body: "https://contentrewards.com/c/campaigns/one"
    });
    assert.equal(wrongType.status, 415);
    const wrongMethod = await fetch(base + "/api/discovery/analyze-public-campaign", { method: "GET" });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get("allow"), "POST, OPTIONS");
  });
});

test("live campaign endpoint returns a bounded error for an oversized request body", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/discovery/analyze-public-campaign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "x".repeat(5000) })
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error, "request_too_large");
  });
});

test("live campaign endpoint supports POST CORS preflight", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/discovery/analyze-public-campaign", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type"
      }
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://app.example.com");
    assert.match(response.headers.get("access-control-allow-methods"), /POST/);
    assert.match(response.headers.get("access-control-allow-headers"), /Content-Type/i);
  });
});

test("live campaign endpoint maps scanner failures to safe HTTP errors", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/discovery/analyze-public-campaign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://contentrewards.com/c/campaigns/one" })
    });
    const payload = await response.json();
    assert.equal(response.status, 504);
    assert.equal(payload.error, "public_campaign_scan_timeout");
    assert.match(payload.message, /timed out/i);
    assert.equal(JSON.stringify(payload).includes("stack"), false);
  }, { publicCampaignPageFetcher: async () => { throw new Error("Public Content Rewards page request timed out."); } });
});

test("live campaign endpoint rejects malformed scanner results instead of returning a false success", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/discovery/analyze-public-campaign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://contentrewards.com/c/campaigns/one" })
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "public_campaign_scan_invalid_result");
  }, { publicCampaignPageFetcher: async () => ({ ...publicDetail(), status: "stale", pageText: "" }) });
});
