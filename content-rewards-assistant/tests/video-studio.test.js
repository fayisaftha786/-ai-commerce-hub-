"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Studio = require("../video-studio.js");

const video = (name, size, type) => ({ name, size, type });

test("prefers MP4 when the browser explicitly reports an MP4 recorder codec", () => {
  const recorder = { isTypeSupported: (type) => type.startsWith("video/mp4") };
  assert.match(Studio.chooseMimeType(recorder), /^video\/mp4/);
});

test("falls back to a supported WebM codec rather than pretending MP4 is available", () => {
  const recorder = { isTypeSupported: (type) => type.startsWith("video/webm;codecs=vp8") };
  assert.equal(Studio.chooseMimeType(recorder), "video/webm;codecs=vp8,opus");
});


test("retries another browser codec when a reported MP4 codec fails at recorder creation", () => {
  const previous = global.MediaRecorder;
  class FakeRecorder {
    static isTypeSupported() { return true; }
    constructor(stream, options) {
      if (options.mimeType && options.mimeType.startsWith("video/mp4")) throw new Error("MP4 encoder unavailable");
      this.mimeType = options.mimeType || "";
    }
  }
  global.MediaRecorder = FakeRecorder;
  try {
    const recorder = Studio.createMediaRecorder({}, 1000000);
    assert.match(recorder.mimeType, /^video\/webm/);
  } finally {
    if (previous === undefined) delete global.MediaRecorder;
    else global.MediaRecorder = previous;
  }
});

test("does not report browser rendering support when required APIs are missing", () => {
  const unsupported = Studio.getCapabilities({});
  assert.equal(unsupported.supported, false);
  assert.ok(unsupported.missing.includes("MediaRecorder API"));
  const supported = Studio.getCapabilities({
    MediaRecorder: { isTypeSupported: (type) => type === "video/webm" },
    document: { createElement: () => ({ captureStream: () => ({}) }) },
    requestAnimationFrame: () => 1
  });
  assert.equal(supported.supported, true);
  assert.equal(supported.formatLabel, "WebM");
});

test("validates common media, item limits and total size before rendering", () => {
  const result = Studio.validateFiles([
    video("one.mp4", 10_000, "video/mp4"),
    video("two.webp", 5_000, "image/webp")
  ]);
  assert.equal(result.count, 2);
  assert.equal(result.mediaBytes, 15_000);
  assert.throws(() => Studio.validateFiles([]), /at least one photo or video/i);
  assert.throws(() => Studio.validateFiles(Array.from({ length: 9 }, (_, i) => video(i + ".jpg", 10, "image/jpeg"))), /no more than 8/i);
});

test("rejects unsupported, zero-byte and oversized inputs", () => {
  assert.throws(() => Studio.validateFiles([video("script.pdf", 100, "application/pdf")]), /unsupported media/i);
  assert.throws(() => Studio.validateFiles([video("empty.mp4", 0, "video/mp4")]), /empty or unreadable/i);
  assert.throws(() => Studio.validateFiles([video("large.mp4", Studio.MAX_MEDIA_BYTES + 1, "video/mp4")]), /150 MB/i);
  assert.throws(() => Studio.validateFiles([video("voice.wav", 10, "video/mp4")], video("bad.mp4", 10, "video/mp4")), /Audio must be/i);
  assert.throws(() => Studio.validateFiles([video("small.mp4", 10, "video/mp4")], video("large.mp3", Studio.MAX_AUDIO_BYTES + 1, "audio/mpeg")), /40 MB/i);
});

test("splits scene captions into non-empty lines and caps them to the number of scenes", () => {
  assert.deepEqual(Studio.splitCaptions(" First scene \n\nSecond scene\r\nThird scene "), ["First scene", "Second scene", "Third scene"]);
  assert.equal(Studio.splitCaptions(Array.from({ length: 12 }, (_, i) => "Scene " + i).join("\n")).length, 8);
});

test("verifies exported duration and 9:16 dimensions instead of trusting the recorder event", () => {
  assert.equal(Studio.validateRenderedMetadata({ duration: 29.8, width: 720, height: 1280 }, 30, 720, 1280), true);
  assert.throws(() => Studio.validateRenderedMetadata({ duration: 8, width: 720, height: 1280 }, 30, 720, 1280), /duration check failed/i);
  assert.throws(() => Studio.validateRenderedMetadata({ duration: 30, width: 1280, height: 720 }, 30, 720, 1280), /size check failed/i);
  assert.throws(() => Studio.validateRenderedMetadata({ duration: 0, width: 720, height: 1280 }, 30, 720, 1280), /no readable duration/i);
});


test("campaign preflight matches selected platform, duration, deadline, hashtags and mentions", () => {
  const result = Studio.inspectCampaignRules({
    selectedCampaign: true,
    rules: "Accepted platforms: Instagram, YouTube\nVideo duration: {\"minSeconds\":15,\"maxSeconds\":30}\nHashtags: #Creator #Rewards\nMentions: @brand",
    platform: "Instagram Reels",
    durationSeconds: 30,
    deadline: "2026-11-30",
    today: "2026-10-31",
    postCaption: "A useful clip #Creator #Rewards @brand"
  });
  assert.equal(result.status, "needs-review");
  assert.deepEqual(result.acceptedPlatforms, ["Instagram", "YouTube"]);
  assert.deepEqual(result.bounds, { minSeconds: 15, maxSeconds: 30 });
  assert.deepEqual(result.missingHashtags, []);
  assert.deepEqual(result.missingMentions, []);
  assert.equal(result.checks.find((item) => item.key === "platform").status, "matched");
  assert.equal(result.checks.find((item) => item.key === "duration").status, "matched");
  assert.equal(result.checks.find((item) => item.key === "post-tags").status, "matched");
});

test("campaign preflight blocks a platform excluded by the saved brief", () => {
  const result = Studio.inspectCampaignRules({
    selectedCampaign: true,
    rules: "Accepted platforms: Instagram, YouTube\nVideo duration: {\"minSeconds\":15,\"maxSeconds\":60}",
    platform: "Facebook Reels",
    durationSeconds: 30,
    deadline: "2026-11-30",
    today: "2026-10-31"
  });
  assert.equal(result.status, "blocked");
  assert.match(result.blockingReasons.join(" "), /Facebook is not in the campaign's accepted-platform list/);
});


test("campaign preflight blocks a target platform when the saved campaign only lists unsupported platforms", () => {
  const result = Studio.inspectCampaignRules({
    selectedCampaign: true,
    rules: "Accepted platforms: TikTok\nVideo duration: {\"minSeconds\":15,\"maxSeconds\":60}",
    platform: "Instagram",
    durationSeconds: 30,
    deadline: "2026-11-30",
    today: "2026-10-31"
  });
  assert.equal(result.status, "blocked");
  assert.match(result.blockingReasons.join(" "), /TikTok/);
});

test("campaign preflight blocks short/long videos and expired deadlines", () => {
  const rules = "Accepted platforms: Instagram\nVideo duration: {\"minSeconds\":15,\"maxSeconds\":30}";
  const short = Studio.inspectCampaignRules({
    selectedCampaign: true, rules, platform: "Instagram", durationSeconds: 10,
    deadline: "2026-11-30", today: "2026-10-31"
  });
  assert.equal(short.status, "blocked");
  assert.match(short.blockingReasons.join(" "), /shorter than the campaign minimum/);
  const long = Studio.inspectCampaignRules({
    selectedCampaign: true, rules, platform: "Instagram", durationSeconds: 60,
    deadline: "2026-11-30", today: "2026-10-31"
  });
  assert.match(long.blockingReasons.join(" "), /longer than the campaign maximum/);
  const expired = Studio.inspectCampaignRules({
    selectedCampaign: true, rules, platform: "Instagram", durationSeconds: 30,
    deadline: "2026-10-30", today: "2026-10-31"
  });
  assert.match(expired.blockingReasons.join(" "), /deadline.*has passed/i);
});

test("campaign preflight shows missing tags, disclosure and locked requirements for manual review", () => {
  const result = Studio.inspectCampaignRules({
    selectedCampaign: true,
    rules: "Accepted platforms: Instagram\nVideo duration: minimum 15 seconds maximum 30 seconds\nHashtags: #BrandTag\nMentions: @brand\nDisclosure: add #ad\nCreator requirements locked until Join Campaign",
    platform: "Instagram",
    durationSeconds: 20,
    deadline: "2026-11-30",
    today: "2026-10-31",
    postCaption: "New video"
  });
  assert.equal(result.status, "needs-review");
  assert.deepEqual(result.missingHashtags, ["#BrandTag"]);
  assert.deepEqual(result.missingMentions, ["@brand"]);
  assert.ok(result.reviewReasons.some((item) => /hashtags or partner mentions/i.test(item)));
  assert.ok(result.checks.some((item) => item.key === "disclosure" && item.status === "review"));
  assert.ok(result.checks.some((item) => item.key === "hidden-requirements" && item.status === "review"));
});

test("campaign preflight keeps absent campaign and unknown rules explicit", () => {
  const empty = Studio.inspectCampaignRules({ selectedCampaign: false, platform: "Instagram", durationSeconds: 30 });
  assert.equal(empty.status, "no-campaign");
  const unknown = Studio.inspectCampaignRules({
    selectedCampaign: true, rules: "No platform requirements in my notes", platform: "Instagram",
    durationSeconds: 30, today: "2026-10-31"
  });
  assert.equal(unknown.status, "needs-review");
  assert.equal(unknown.checks.find((item) => item.key === "platform").status, "unknown");
  assert.equal(unknown.checks.find((item) => item.key === "duration").status, "unknown");
});

test("Clip Studio exposes media upload, audio, preflight, progress, preview and save controls", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const worker = fs.readFileSync(path.join(__dirname, "..", "service-worker.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const uiSource = fs.readFileSync(path.join(__dirname, "..", "video-studio-ui.js"), "utf8");
  for (const id of [
    "video-media-files", "video-audio-file", "video-duration", "video-captions",
    "video-rights-confirm", "video-rules-confirm", "video-create-button",
    "video-cancel-button", "video-export-progress", "video-output-preview", "video-download-link",
    "video-target-platform", "video-post-caption", "video-add-campaign-tags", "video-campaign-preflight",
    "video-device-test-button"
  ]) assert.ok(html.includes('id="' + id + '"'), "missing video studio UI control " + id);
  assert.match(html, /video-studio\.js/);
  assert.match(appSource, /data-rules=/);
  assert.match(appSource, /data-deadline=/);
  assert.match(uiSource, /inspectCampaignRules/);
  assert.match(uiSource, /campaignCheck\.status === "blocked"/);
  assert.match(html, /video-studio-ui\.js/);
  assert.ok(html.includes('id="video-device-test-button"'));
  assert.equal(typeof Studio.renderDeviceTest, "function");
  assert.match(worker, /clipreward-static-v13/);
  assert.match(worker, /video-studio\.js/);
  assert.match(worker, /video-studio-ui\.js/);
  assert.match(packageJson.scripts.check, /content-rewards-assistant\/video-studio\.js/);
  assert.match(packageJson.scripts.check, /content-rewards-assistant\/video-studio-ui\.js/);
});
