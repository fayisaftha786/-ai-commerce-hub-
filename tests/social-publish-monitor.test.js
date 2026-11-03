"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Monitor = require("../social-publish-monitor.js");

test("accepts a YouTube receipt only after processing, public visibility, matching URL and timestamp", () => {
  const receipt = {
    ok: true,
    videoId: "AbCd1234",
    url: "https://www.youtube.com/watch?v=AbCd1234",
    uploadStatus: "processed",
    processingStatus: "succeeded",
    privacyStatus: "public",
    publishedAt: "2026-11-03T01:02:03.000Z"
  };
  assert.deepEqual(Monitor.safeReceipt(receipt, "youtube"), {
    state: "published",
    url: receipt.url,
    publishedAt: receipt.publishedAt
  });
  assert.equal(Monitor.safeReceipt({ ...receipt, url: "https://evil.example/watch?v=AbCd1234" }, "youtube").state, "invalid");
  assert.equal(Monitor.safeReceipt({ ...receipt, videoId: "Other123" }, "youtube").state, "invalid");
  assert.equal(Monitor.safeReceipt({ ...receipt, publishedAt: "" }, "youtube").state, "invalid");
});

test("keeps private and unlisted YouTube uploads out of Content Rewards receipt flow", () => {
  const result = Monitor.safeReceipt({
    ok: true, videoId: "AbCd1234", url: "https://www.youtube.com/watch?v=AbCd1234",
    uploadStatus: "processed", processingStatus: "succeeded",
    privacyStatus: "private", publishedAt: ""
  }, "youtube");
  assert.deepEqual(result, { state: "not_public", privacyStatus: "private" });
});

test("accepts Facebook only after Meta confirms a public permalink and publication time", () => {
  const result = Monitor.safeReceipt({
    ok: true, published: true, privacyStatus: "public",
    permalink: "https://www.facebook.com/reel/123456789/",
    publishedAt: "2026-11-03T01:02:03.000Z"
  }, "facebook");
  assert.equal(result.state, "published");
  assert.equal(result.url, "https://www.facebook.com/reel/123456789/");
  assert.equal(Monitor.safeReceipt({
    ok: true, published: false, privacyStatus: "unknown"
  }, "facebook").state, "pending");
});

test("retries transient status responses and stops after a verified public result", async () => {
  let calls = 0;
  let waits = 0;
  const result = await Monitor.pollUntilPublic(async () => {
    calls += 1;
    if (calls === 1) return { ok: false, error: "provider_status_unavailable" };
    if (calls === 2) return { ok: true, published: false, privacyStatus: "unknown" };
    return {
      ok: true, published: true, privacyStatus: "public",
      permalink: "https://www.facebook.com/reel/123456789/",
      publishedAt: "2026-11-03T01:02:03.000Z"
    };
  }, {
    provider: "facebook",
    maxAttempts: 5,
    intervalMs: 1000,
    sleep: async (milliseconds) => { assert.equal(milliseconds, 1000); waits += 1; }
  });
  assert.equal(result.state, "published");
  assert.equal(result.attempt, 3);
  assert.equal(calls, 3);
  assert.equal(waits, 2);
});

test("stops immediately when a provider session must be reconnected", async () => {
  let calls = 0;
  const result = await Monitor.pollUntilPublic(async () => {
    calls += 1;
    return { ok: false, error: "reconnect_required" };
  }, { provider: "youtube", maxAttempts: 10, intervalMs: 0 });
  assert.equal(result.state, "failed");
  assert.equal(result.error, "reconnect_required");
  assert.equal(calls, 1);
});

test("uses a bounded polling window and reports a timeout without inventing publication", async () => {
  let calls = 0;
  let waits = 0;
  const result = await Monitor.pollUntilPublic(async () => {
    calls += 1;
    return { ok: true, published: false, privacyStatus: "unknown" };
  }, {
    provider: "facebook", maxAttempts: 3, intervalMs: 10,
    sleep: async () => { waits += 1; }
  });
  assert.equal(result.state, "timed_out");
  assert.equal(result.attempt, 3);
  assert.equal(calls, 3);
  assert.equal(waits, 2);
});

test("validates arguments and honours cancellation before a provider check", async () => {
  await assert.rejects(() => Monitor.pollUntilPublic(null), /status check function/i);
  let calls = 0;
  const result = await Monitor.pollUntilPublic(async () => { calls += 1; return {}; }, {
    provider: "youtube", signal: { aborted: true }, maxAttempts: 3
  });
  assert.equal(result.state, "cancelled");
  assert.equal(calls, 0);
});
