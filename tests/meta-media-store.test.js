"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createEphemeralMetaMediaStore } = require("../meta-media-store.js");

test("serves only random, expiring HTTPS media URLs and disposes the media after publication", () => {
  let now = 1000;
  const store = createEphemeralMetaMediaStore({
    publicBaseUrl: "https://api.example.com",
    now: () => now,
    randomBytes: (size) => Buffer.alloc(size, 0xab)
  });
  const bytes = Buffer.from("mock mp4 content");
  const item = store.create(bytes, "video/mp4");
  assert.equal(item.url, "https://api.example.com/media/instagram/" + "ab".repeat(32));
  const token = item.url.split("/").pop();
  assert.deepEqual(store.get(token).buffer, bytes);
  assert.equal(store.get("not-a-token"), null);
  assert.equal(store.size(), 1);
  item.dispose();
  assert.equal(store.get(token), null);
  assert.equal(store.size(), 0);
});

test("expires media even when the creator does not explicitly dispose it", () => {
  let now = 1000;
  const store = createEphemeralMetaMediaStore({
    publicBaseUrl: "https://api.example.com",
    now: () => now,
    ttlMs: 60_000
  });
  const item = store.create(Buffer.from("mp4"), "video/mp4");
  const token = item.url.split("/").pop();
  assert.ok(store.get(token));
  now += 60_001;
  assert.equal(store.get(token), null);
  assert.equal(store.size(), 0);
});

test("rejects unsafe media bases, empty files, oversized files and unsupported media types", () => {
  const noBase = createEphemeralMetaMediaStore({ publicBaseUrl: "http://api.example.com" });
  assert.throws(() => noBase.create(Buffer.from("mp4"), "video/mp4"), /not configured/i);
  const store = createEphemeralMetaMediaStore({ publicBaseUrl: "https://api.example.com" });
  assert.throws(() => store.create(Buffer.alloc(0), "video/mp4"), /size.*invalid/i);
  assert.throws(() => store.create(Buffer.alloc(50 * 1024 * 1024 + 1), "video/mp4"), /size.*invalid/i);
  assert.throws(() => store.create(Buffer.from("pdf"), "application/pdf"), /type.*invalid/i);
});
