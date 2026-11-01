"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const directory = require("../creator-program-directory");

const valid = {
  schemaVersion: 1,
  country: "IN",
  status: "success",
  generatedAt: "2026-11-01T00:00:00.000Z",
  summary: { sourcesAttempted: 1, sourcesAvailable: 1, sourcesUnavailable: 0 },
  sources: [{
    id: "youtube-ypp",
    platform: "YouTube",
    program: "YouTube Partner Program",
    sourceUrl: "https://support.google.com/youtube/answer/72851?hl=en-IN",
    status: "available",
    checkedAt: "2026-11-01T00:00:00.000Z",
    accountCheck: "YouTube Studio → Earn",
    indiaNote: "Check the channel account.",
    limitation: "Public docs do not verify account access.",
    pageTitle: "Official help"
  }]
};

test("normalizes official source reports and retains only approved HTTPS links", () => {
  const result = directory.normalizeSnapshot(valid);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].status, "available");
  assert.equal(result.sources[0].sourceUrl, valid.sources[0].sourceUrl);
  assert.equal(directory.safeSourceUrl("http://support.google.com/youtube"), "");
  assert.equal(directory.safeSourceUrl("https://support.google.com.evil.example/"), "");
});

test("rejects unknown snapshot shapes and removes unapproved source URLs", () => {
  assert.throws(() => directory.normalizeSnapshot({ schemaVersion: 2, country: "IN", sources: [] }), /unrecognised format/i);
  assert.throws(() => directory.normalizeSnapshot({
    ...valid, sources: [{ ...valid.sources[0], sourceUrl: "https://evil.example/page" }]
  }), /no valid sources/i);
});

test("unknown source states are downgraded to not checked", () => {
  const result = directory.normalizeSnapshot({
    ...valid,
    status: "pending",
    sources: [{ ...valid.sources[0], status: "eligible" }]
  });
  assert.equal(result.status, "pending");
  assert.equal(result.sources[0].status, "not_checked");
});
