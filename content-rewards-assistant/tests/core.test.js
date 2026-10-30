"use strict";
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
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


test("account center stores only local creator labels, social handles and explicit checklist confirmations", () => {
  const account = Core.normalizeAccount({
    displayName: "Creator workspace",
    socialAccounts: [
      { id: "s1", platform: "YouTube", handle: "@mychannel", confirmedConnected: true },
      { id: "s2", platform: "TikTok", handle: "@clips", confirmedConnected: false }
    ],
    checklist: { loggedIn: true, socialVerified: true, campaignReady: false, postPublished: false, submissionSent: false }
  }, "2026-10-29T12:00:00.000Z");
  assert.equal(account.displayName, "Creator workspace");
  assert.equal(account.socialAccounts.length, 2);
  assert.equal(account.socialAccounts[0].confirmedConnected, true);
  assert.equal(account.checklist.loggedIn, true);
  assert.equal(account.checklist.submissionSent, false);
  assert.equal(account.updatedAt, "2026-10-29T12:00:00.000Z");
  assert.throws(() => Core.normalizeAccount({ socialAccounts: [
    { id: "s1", platform: "TikTok", handle: "@same" },
    { id: "s2", platform: "TikTok", handle: "@same" }
  ] }), /already saved/);
  assert.throws(() => Core.normalizeAccount({ socialAccounts: [{ id: "s1", platform: "TikTok", handle: "" }] }), /needs a handle/);
});

test("backup preserves account-center data and imports legacy backups without account data", () => {
  const backup = Core.createBackup({
    campaigns: [],
    timestamps: [],
    account: {
      displayName: "My creator setup",
      socialAccounts: [{ id: "social1", platform: "Instagram", handle: "@studio", confirmedConnected: true }],
      checklist: { loggedIn: true, socialVerified: true, campaignReady: true, postPublished: false, submissionSent: false }
    }
  }, "2026-10-29T12:00:00.000Z");
  const imported = Core.parseBackup(backup);
  assert.equal(imported.account.displayName, "My creator setup");
  assert.equal(imported.account.socialAccounts[0].handle, "@studio");
  assert.equal(imported.account.checklist.campaignReady, true);
  const legacy = Core.parseBackup({ app: "ClipReward Studio", version: 1, campaigns: [], timestamps: [] });
  assert.equal(legacy.account.displayName, "");
  assert.equal(legacy.account.socialAccounts.length, 0);
});


test("campaign post time normalizes to ISO, is optional for old backups, and rejects invalid dates", () => {
  const item = Core.normalizeCampaign({
    id: "posted-time",
    name: "Recent clip",
    platform: "Content Rewards",
    postedAt: "2026-10-30T04:40:00+05:30"
  }, "2026-10-30T00:00:00.000Z");
  assert.equal(item.postedAt, "2026-10-29T23:10:00.000Z");
  assert.equal(Core.normalizeCampaign({ name: "Legacy campaign" }).postedAt, "");
  assert.throws(() => Core.normalizeCampaign({ name: "Bad post time", postedAt: "not-a-date" }), /valid date and time/);
});

test("campaign cards render and refresh the 30-minute submission countdown", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(appSource, /rules \+ deadline \+ submissionDeadlineMarkup\(campaign\)/);
  assert.match(appSource, /window\.setInterval\(refreshDeadlineCountdowns, 1000\)/);
  assert.match(appSource, /node\.classList\.add\("overdue-deadline"\)/);
});

test("local persistence failures are not followed by success confirmations", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(appSource, /Changes remain only in this open session/);
  assert.match(appSource, /if \(persisted\) showToast\(/);
  assert.doesNotMatch(appSource, /save\(\);\s*[^;]*;\s*showToast\(/);
});

test("service worker uses network-first refresh with cached offline fallback", () => {
  const workerSource = fs.readFileSync(path.join(__dirname, "..", "service-worker.js"), "utf8");
  assert.match(workerSource, /const CACHE = "clipreward-static-v2"/);
  const networkFetch = workerSource.indexOf("event.respondWith(\n    fetch(request)");
  const offlineFallback = workerSource.indexOf("return caches.match(request)");
  assert.ok(networkFetch >= 0, "service worker should try the network first");
  assert.ok(offlineFallback > networkFetch, "cache should be used only after a network failure");
  assert.match(workerSource, /request.mode === "navigate"/);
  assert.match(workerSource, /return Response.error\(\)/);
});
