"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core.js");

test("campaign normalization trims text, preserves status and rejects unsafe links", () => {
  const item = Core.normalizeCampaign({
    id: "one", name: "  Example campaign  ", platform: "Whop",
    status: "submitted", url: "https://example.com/rules",
    postUrl: "https://example.com/post", deadline: "2027-01-30", rules: " Check disclosure "
  }, "2026-10-29T12:00:00.000Z");
  assert.equal(item.name, "Example campaign");
  assert.equal(item.rules, "Check disclosure");
  assert.equal(item.status, "submitted");
  assert.equal(item.updatedAt, "2026-10-29T12:00:00.000Z");
  assert.throws(() => Core.normalizeCampaign({ name: "Bad link", url: "javascript:alert(1)" }), /HTTPS/);
  assert.throws(() => Core.normalizeCampaign({ name: "Bad date", deadline: "2027-02-30" }), /calendar date/);
  assert.throws(() => Core.normalizeCampaign({ name: "Bad post", postUrl: "http://example.com" }), /HTTPS/);
});

test("timestamp parser accepts mm:ss and hh:mm:ss and rejects malformed values", () => {
  assert.deepEqual(Core.validateTimestamp("01:24"), { ok: true, seconds: 84, normalized: "01:24", error: "" });
  assert.equal(Core.validateTimestamp("01:02:03").seconds, 3723);
  assert.equal(Core.validateTimestamp("99:99").ok, false);
  assert.equal(Core.validateTimestamp("2:70:00").ok, false);
  assert.throws(() => Core.normalizeTimestamp({ timestamp: "01:00", note: "" }), /note is required/);
});

test("stats count only explicit campaign statuses", () => {
  assert.deepEqual(Core.stats([
    { status: "idea" }, { status: "editing" }, { status: "ready" },
    { status: "submitted" }, { status: "approved" }, { status: "rejected" }
  ]), { total: 6, progress: 2, review: 1, approved: 1 });
});

test("draft generator uses requested language and safe disclosure guidance", () => {
  const english = Core.makeDraft({ topic: "Three editing tips", benefit: "Keep the hook clear", language: "en", platform: "TikTok" });
  assert.match(english, /Three editing tips/);
  assert.match(english, /DISCLOSURE/);
  const malayalam = Core.makeDraft({ topic: "വീഡിയോ ടിപ്പുകൾ", language: "ml" });
  assert.match(malayalam, /പോസ്റ്റ് ചെയ്യുന്നതിന് മുമ്പ്/);
  assert.throws(() => Core.makeDraft({ topic: " " }), /topic/);
});

test("backup export/import round-trips and rejects unsupported or duplicate data", () => {
  const backup = Core.createBackup({
    campaigns: [{ id: "c1", name: "Test", status: "idea" }],
    timestamps: [{ id: "t1", timestamp: "00:42", note: "Opening hook" }]
  }, "2026-10-29T12:00:00.000Z");
  const imported = Core.parseBackup(JSON.stringify(backup));
  assert.equal(imported.campaigns[0].name, "Test");
  assert.equal(imported.timestamps[0].seconds, 42);
  assert.throws(() => Core.parseBackup('{"app":"wrong","version":1,"campaigns":[],"timestamps":[]}'), /not supported/);
  const duplicate = { app: "ClipReward Studio", version: 1, campaigns: [{id:"x",name:"A"},{id:"x",name:"B"}], timestamps: [] };
  assert.throws(() => Core.parseBackup(duplicate), /duplicate campaign IDs/);
});
