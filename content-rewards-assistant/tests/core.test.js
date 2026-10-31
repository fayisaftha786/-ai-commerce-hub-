"use strict";
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
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
    { status: "idea" }, { status: "applied" }, { status: "joined" },
    { status: "editing" }, { status: "ready" }, { status: "submitted" },
    { status: "approved" }, { status: "rejected" }
  ]), { total: 8, progress: 4, review: 1, approved: 1 });
  assert.equal(Core.normalizeCampaign({ name: "Applied offer", status: "applied" }).status, "applied");
  assert.equal(Core.normalizeCampaign({ name: "Joined offer", status: "joined" }).status, "joined");
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


test("legacy Content Rewards submission records remain importable but are labelled without timing evidence", () => {
  const legacy = Core.normalizeCampaign({
    id: "legacy-submission",
    name: "Older campaign",
    platform: "Content Rewards",
    status: "submitted"
  });
  assert.equal(Core.hasLegacySubmissionTiming(legacy), true);

  const timed = Core.normalizeCampaign({
    id: "timed-submission",
    name: "Current campaign",
    platform: "Content Rewards",
    status: "submitted",
    submittedAt: "2026-10-30T10:20:00.000Z"
  });
  assert.equal(Core.hasLegacySubmissionTiming(timed), false);

  const unrelated = Core.normalizeCampaign({
    id: "other-platform",
    name: "Other platform campaign",
    platform: "Whop",
    status: "submitted"
  });
  assert.equal(Core.hasLegacySubmissionTiming(unrelated), false);
});

test("campaign cards visibly flag legacy submissions whose submission time was not recorded", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.ok(appSource.includes("Core.hasLegacySubmissionTiming(campaign)"));
  assert.match(appSource, /Legacy · submission time not recorded/);
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
      checklist: { ageEligible: true, loggedIn: true, socialVerified: true, campaignReady: true, postPublished: false, submissionSent: false }
    }
  }, "2026-10-29T12:00:00.000Z");
  const imported = Core.parseBackup(backup);
  assert.equal(imported.account.displayName, "My creator setup");
  assert.equal(imported.account.socialAccounts[0].handle, "@studio");
  assert.equal(imported.account.checklist.campaignReady, true);
  assert.equal(imported.account.checklist.ageEligible, true);
  const legacy = Core.parseBackup({ app: "ClipReward Studio", version: 1, campaigns: [], timestamps: [] });
  assert.equal(legacy.account.displayName, "");
  assert.equal(legacy.account.socialAccounts.length, 0);
  assert.equal(legacy.account.checklist.ageEligible, false);
});


test("campaign post time normalizes to ISO, is optional for old backups, and rejects invalid dates", () => {
  const item = Core.normalizeCampaign({
    id: "posted-time",
    name: "Recent clip",
    platform: "Content Rewards",
    postedAt: "2026-10-30T04:40:00+05:30",
    postPlatform: "Instagram",
    payoutTerms: "CPM — $2 per 1,000 views",
    budgetTerms: "$1K used / $5K total",
    submittedAt: "2026-10-30T05:00:00+05:30"
  }, "2026-10-30T00:00:00.000Z");
  assert.equal(item.postedAt, "2026-10-29T23:10:00.000Z");
  assert.equal(item.submittedAt, "2026-10-29T23:30:00.000Z");
  assert.equal(item.postPlatform, "Instagram");
  assert.equal(item.payoutTerms, "CPM — $2 per 1,000 views");
  assert.equal(item.budgetTerms, "$1K used / $5K total");
  assert.equal(Core.normalizeCampaign({ name: "Legacy campaign" }).payoutTerms, "");
  assert.equal(Core.normalizeCampaign({ name: "Legacy campaign" }).budgetTerms, "");
  assert.equal(Core.normalizeCampaign({ name: "Legacy campaign" }).postedAt, "");
  assert.throws(() => Core.normalizeCampaign({ name: "Bad post time", postedAt: "not-a-date" }), /valid date and time/);
  assert.throws(() => Core.normalizeCampaign({ name: "Bad submission time", submittedAt: "not-a-date" }), /Submission time must be a valid date and time/);
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


test("ClipReward rolls back every local data mutation when browser storage rejects a save", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(appSource, /function snapshotState\(\)/);
  assert.match(appSource, /function saveOrRestore\(previous\)/);
  assert.match(appSource, /if \(!persisted\) \{\s*state = previous;\s*render\(\);\s*\}/);

  function sourceBlock(startMarker, endMarker) {
    const start = appSource.indexOf(startMarker);
    assert.ok(start >= 0, "missing handler: " + startMarker);
    const end = appSource.indexOf(endMarker, start + startMarker.length);
    assert.ok(end > start, "missing handler boundary: " + endMarker);
    return appSource.slice(start, end);
  }

  const mutatingHandlers = [
    ["function onCampaignSubmit", "function deleteCampaign"],
    ["function deleteCampaign", "function addTimestamp"],
    ["function addTimestamp", "function generateDraft"],
    ["function importBackup", '$("today-label")'],
    ['$("timestamp-list").addEventListener("click"', '$("account-profile-form").addEventListener("submit"'],
    ['$("account-profile-form").addEventListener("submit"', '$("social-account-form").addEventListener("submit"'],
    ['$("social-account-form").addEventListener("submit"', '$("social-account-list").addEventListener("click"'],
    ['$("social-account-list").addEventListener("click"', 'document.querySelectorAll("[data-account-check]").forEach((input) => {\n    input.addEventListener("change"'],
    ['document.querySelectorAll("[data-account-check]").forEach((input) => {\n    input.addEventListener("change"', '$("campaign-scout-form")']
  ];

  for (const [start, end] of mutatingHandlers) {
    const block = sourceBlock(start, end);
    assert.match(block, /snapshotState\(\)/, "missing state snapshot in " + start);
    assert.match(block, /saveOrRestore\(previous\)/, "missing persistence rollback in " + start);
    assert.match(block, /if \(!persisted\) return|if \(!saveOrRestore\(previous\)\) return/,
      "handler must stop after a failed save: " + start);
  }
});


test("ClipReward keeps saved UI state when campaign, timestamp, account and backup writes fail", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const savedCampaign = Core.normalizeCampaign({
    id: "saved-campaign", name: "Saved campaign", platform: "Content Rewards", status: "idea"
  });
  const savedTimestamp = Core.normalizeTimestamp({
    id: "saved-timestamp", timestamp: "00:10", note: "Saved timestamp"
  });
  const savedAccount = Core.normalizeAccount({
    displayName: "Saved profile",
    socialAccounts: [{ id: "saved-social", platform: "Instagram", handle: "@saved" }]
  });
  const initialState = {
    campaigns: [savedCampaign],
    timestamps: [savedTimestamp],
    account: savedAccount
  };
  const importedState = Core.createBackup({
    campaigns: [Core.normalizeCampaign({
      id: "imported-campaign", name: "Imported campaign", platform: "Content Rewards", status: "idea"
    })],
    timestamps: [],
    account: Core.normalizeAccount({ displayName: "Imported profile" })
  });

  const elements = new Map();
  function makeElement(id) {
    return {
      id,
      value: id === "status-filter" ? "all" : "",
      innerHTML: "",
      textContent: "",
      hidden: false,
      checked: false,
      dataset: {},
      style: {},
      listeners: {},
      resetCount: 0,
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(type, callback) { this.listeners[type] = callback; },
      reset() { this.resetCount += 1; this.value = ""; },
      focus() {},
      select() {}
    };
  }
  function element(id) {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  }
  const accountCheck = makeElement("account-check");
  accountCheck.dataset.accountCheck = "loggedIn";
  const document = {
    body: { style: {} },
    getElementById: element,
    querySelectorAll(selector) {
      return selector === "[data-account-check]" ? [accountCheck] : [];
    },
    addEventListener() {},
    createElement: makeElement
  };
  let writeAttempts = 0;
  const localStorage = {
    getItem(key) {
      return key === "clipreward-studio-v1" ? JSON.stringify(initialState) : null;
    },
    setItem() {
      writeAttempts += 1;
      throw new Error("QuotaExceededError");
    }
  };
  class FakeFileReader {
    readAsText() {
      this.result = JSON.stringify(importedState);
      this.onload();
    }
  }
  const window = {
    ClipRewardCore: Core,
    confirm() { return true; },
    setInterval() { return 1; },
    addEventListener() {},
    isSecureContext: false
  };
  vm.runInNewContext(appSource, {
    window,
    document,
    localStorage,
    navigator: {},
    location: { protocol: "file:", hostname: "" },
    URL,
    Date,
    Intl,
    FileReader: FakeFileReader,
    setTimeout() { return 1; },
    clearTimeout() {}
  });

  const submit = (id) => element(id).listeners.submit({ preventDefault() {} });
  const click = (id, selector, recordId) => element(id).listeners.click({
    target: { closest(value) { return value === selector ? { dataset: { id: recordId } } : null; } }
  });

  element("add-campaign-button").listeners.click();
  element("campaign-name").value = "Unsaved campaign";
  submit("campaign-form");
  assert.match(element("campaign-list").innerHTML, /Saved campaign/);
  assert.doesNotMatch(element("campaign-list").innerHTML, /Unsaved campaign/);
  assert.equal(element("campaign-modal").hidden, false);

  click("campaign-list", ".delete-campaign", "saved-campaign");
  assert.match(element("campaign-list").innerHTML, /Saved campaign/);

  element("timestamp-input").value = "00:20";
  element("timestamp-note").value = "Unsaved timestamp";
  submit("timestamp-form");
  assert.match(element("timestamp-list").innerHTML, /Saved timestamp/);
  assert.doesNotMatch(element("timestamp-list").innerHTML, /Unsaved timestamp/);
  assert.equal(element("timestamp-form").resetCount, 0);

  click("timestamp-list", ".remove-time", "saved-timestamp");
  assert.match(element("timestamp-list").innerHTML, /Saved timestamp/);

  element("account-display-name").value = "Unsaved profile";
  submit("account-profile-form");
  assert.equal(element("account-display-name").value, "Saved profile");

  element("social-platform").value = "Instagram";
  element("social-handle").value = "@unsaved";
  submit("social-account-form");
  assert.equal(element("social-handle").value, "@unsaved");
  assert.match(element("social-account-list").innerHTML, /@saved/);
  assert.doesNotMatch(element("social-account-list").innerHTML, /@unsaved/);

  click("social-account-list", ".remove-social", "saved-social");
  assert.match(element("social-account-list").innerHTML, /@saved/);

  accountCheck.checked = true;
  accountCheck.listeners.change();
  assert.equal(accountCheck.checked, false);

  element("import-file").files = [{ size: 100 }];
  element("import-file").listeners.change({ target: element("import-file") });
  assert.match(element("campaign-list").innerHTML, /Saved campaign/);
  assert.doesNotMatch(element("campaign-list").innerHTML, /Imported campaign/);
  assert.ok(writeAttempts >= 8, "expected each failed mutation to attempt persistence");
});

test("ClipReward service worker is registered, refreshes v6 assets and scopes offline caching", () => {
  const workerSource = fs.readFileSync(path.join(__dirname, "..", "service-worker.js"), "utf8");
  const htmlSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(workerSource, /const CACHE = "clipreward-static-v9"/);
  for (const asset of ["./index.html", "./style.css", "./campaign-scout.js", "./core.js", "./app.js", "./manifest.webmanifest", "./icon.svg"]) {
    assert.ok(workerSource.includes('"' + asset + '"'), "missing ClipReward offline asset " + asset);
  }
  assert.match(workerSource, /url\.href\.startsWith\(self\.registration\.scope\)/);
  assert.match(htmlSource, /navigator\.serviceWorker\.register\("\.\/service-worker\.js"\)/);
  assert.match(htmlSource, /location\.protocol !== "file:"/);
  assert.match(htmlSource, /data-register-service-worker/);
  const networkFetch = workerSource.indexOf("event.respondWith(\n    fetch(request)");
  const offlineFallback = workerSource.indexOf("caches.match(request).then((cached)");
  assert.ok(networkFetch >= 0, "service worker should try the network first");
  assert.ok(offlineFallback > networkFetch, "cache should be used only after a network failure");
  assert.match(workerSource, /request.mode === "navigate"/);
  assert.match(workerSource, /return Response.error\(\)/);
});


test("Content Rewards submission preflight requires platform-matched public link and both timestamps", () => {
  const now = "2026-10-30T10:29:59.000Z";
  const validRecord = {
    platform: "Content Rewards",
    status: "submitted",
    postPlatform: "Instagram",
    postUrl: "https://www.instagram.com/reel/example/",
    postedAt: "2026-10-30T10:00:00.000Z",
    submittedAt: "2026-10-30T10:29:59.000Z"
  };
  const missingUrl = Core.validateSubmissionRecord({ ...validRecord, postUrl: "" }, now);
  assert.equal(missingUrl.valid, false);
  assert.match(missingUrl.error, /public post URL/i);
  const missingPlatform = Core.validateSubmissionRecord({ ...validRecord, postPlatform: "" }, now);
  assert.equal(missingPlatform.valid, false);
  assert.match(missingPlatform.error, /choose the actual supported social platform/i);
  const missingPostTime = Core.validateSubmissionRecord({ ...validRecord, postedAt: "" }, now);
  assert.equal(missingPostTime.valid, false);
  assert.match(missingPostTime.error, /time the public post went live/i);
  const missingSubmissionTime = Core.validateSubmissionRecord({ ...validRecord, submittedAt: "" }, now);
  assert.equal(missingSubmissionTime.valid, false);
  assert.match(missingSubmissionTime.error, /actually submitted the post link/i);
  assert.deepEqual(Core.validateSubmissionRecord(validRecord, now), { valid: true, error: "" });
  assert.equal(Core.validateSubmissionRecord({ platform: "Whop", status: "submitted" }, now).valid, true);
  assert.equal(Core.validateSubmissionRecord({ platform: "Content Rewards", status: "editing" }, now).valid, true);
});

test("Content Rewards preflight enforces the 30-minute boundary and rejects inconsistent clocks", () => {
  const base = {
    platform: "Content Rewards", status: "submitted", postPlatform: "YouTube",
    postUrl: "https://youtu.be/example",
    postedAt: "2026-10-30T10:00:00.000Z",
    submittedAt: "2026-10-30T10:30:00.000Z"
  };
  const exactBoundary = Core.validateSubmissionRecord({ ...base, submittedAt: "2026-10-30T10:30:00.000Z" }, "2026-10-30T10:30:00.000Z");
  assert.equal(exactBoundary.valid, false);
  assert.match(exactBoundary.error, /30-minute submission window/i);
  const tooLate = Core.validateSubmissionRecord({ ...base, submittedAt: "2026-10-30T10:30:01.000Z" }, "2026-10-30T10:31:00.000Z");
  assert.equal(tooLate.valid, false);
  assert.match(tooLate.error, /30-minute submission window/i);
  const justInTime = Core.validateSubmissionRecord({ ...base, submittedAt: "2026-10-30T10:29:59.999Z" }, "2026-10-30T10:30:00.000Z");
  assert.equal(justInTime.valid, true);
  const beforePost = Core.validateSubmissionRecord({ ...base, submittedAt: "2026-10-30T09:59:00.000Z" }, "2026-10-30T10:30:00.000Z");
  assert.equal(beforePost.valid, false);
  assert.match(beforePost.error, /cannot be earlier than the post time/i);
  const futureSubmission = Core.validateSubmissionRecord({ ...base, submittedAt: "2026-10-30T10:20:00.000Z" }, "2026-10-30T10:10:00.000Z");
  assert.equal(futureSubmission.valid, false);
  assert.match(futureSubmission.error, /in the future/i);
});

test("Content Rewards post URL host must match the selected platform", () => {
  assert.equal(Core.postUrlMatchesPlatform("https://www.instagram.com/reel/example/", "Instagram"), true);
  assert.equal(Core.postUrlMatchesPlatform("https://youtube.com/shorts/example", "YouTube"), true);
  assert.equal(Core.postUrlMatchesPlatform("https://vm.tiktok.com/example", "TikTok"), true);
  assert.equal(Core.postUrlMatchesPlatform("https://x.com/example/status/1", "X"), true);
  assert.equal(Core.postUrlMatchesPlatform("https://t.co/example", "X"), true);
  assert.equal(Core.postUrlMatchesPlatform("https://fb.watch/example", "Facebook"), true);
  assert.equal(Core.postUrlMatchesPlatform("https://instagram.com.evil.example/reel/1", "Instagram"), false);
  assert.equal(Core.validateSubmissionRecord({
    platform: "Content Rewards", status: "submitted", postPlatform: "YouTube",
    postUrl: "https://www.instagram.com/reel/example/",
    postedAt: "2026-10-30T10:00:00.000Z", submittedAt: "2026-10-30T10:05:00.000Z"
  }, "2026-10-30T10:06:00.000Z").valid, false);
});

test("submission UI wires exact posting platform and submission time, and labels rejections accurately", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(appSource, /rejected: "Rejected"/);
  assert.match(appSource, /campaign\.platform !== "Content Rewards" \|\| !campaign\.postedAt/);
  assert.match(appSource, /Core\.validateSubmissionRecord\(record\)/);
  assert.match(appSource, /campaign-post-platform/);
  assert.match(appSource, /platform: \$\("campaign-platform"\)\.value \|\| \(old \? old\.platform : "Other"\)/);
  assert.match(appSource, /postPlatform: \$\("campaign-post-platform"\)\.value \|\| \(old \? old\.postPlatform : ""\)/);
  assert.match(appSource, /campaign-submitted-at/);
  const htmlSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(htmlSource, /ROUTE A · MOST CAMPAIGNS/);
  assert.match(htmlSource, /ROUTE B · PRE-APPROVAL CAMPAIGNS/);
  assert.match(htmlSource, /less than 30 minutes old/);
  assert.match(htmlSource, /does not submit clips or verify approvals/);
  assert.match(htmlSource, /18\+ only/);
  assert.match(htmlSource, /data-account-check="ageEligible"/);
  assert.match(htmlSource, /0 \/ 6 confirmed/);
  assert.match(htmlSource, /contentrewards\.com\/login/);
  assert.doesNotMatch(htmlSource, /CR-XXXXXX|code expires after 24 hours/);
  assert.match(htmlSource, /Instagram professional Business account/);
  assert.match(htmlSource, /value="applied">Applied/);
  assert.match(htmlSource, /value="joined">Joined/);
  assert.match(htmlSource, /A pool is a shared allocation/i);
  assert.match(htmlSource, /Facebook Reel caption/);
  assert.match(htmlSource, /Your account shows as not linked/);
  assert.match(htmlSource, /X sign-in window/);
  assert.match(htmlSource, /value="rejected">Rejected/);
  assert.match(htmlSource, /Instagram Business account/);
  assert.doesNotMatch(htmlSource, /Instagram Creator account/);
});


test("backup keeps new submission evidence, rejects invalid new records, and imports legacy submitted records", () => {
  const valid = {
    app: "ClipReward Studio",
    version: Core.VERSION,
    exportedAt: "2026-10-29T12:00:00.000Z",
    campaigns: [{
      id: "valid-submission", name: "Past campaign", platform: "Content Rewards", status: "submitted",
      postPlatform: "YouTube", postUrl: "https://youtu.be/example",
      postedAt: "2026-10-28T10:00:00.000Z", submittedAt: "2026-10-28T10:29:00.000Z"
    }],
    timestamps: []
  };
  const imported = Core.parseBackup(valid);
  assert.equal(imported.campaigns[0].postPlatform, "YouTube");
  assert.equal(imported.campaigns[0].submittedAt, "2026-10-28T10:29:00.000Z");

  const late = structuredClone(valid);
  late.campaigns[0].submittedAt = "2026-10-28T10:31:00.000Z";
  assert.throws(() => Core.parseBackup(late), /invalid Content Rewards submission record.*30-minute/i);

  const legacy = structuredClone(valid);
  delete legacy.campaigns[0].postPlatform;
  delete legacy.campaigns[0].submittedAt;
  const legacyImport = Core.parseBackup(legacy);
  assert.equal(legacyImport.campaigns[0].status, "submitted");
  assert.equal(legacyImport.campaigns[0].postPlatform, "Other");
  assert.equal(legacyImport.campaigns[0].submittedAt, "");
});