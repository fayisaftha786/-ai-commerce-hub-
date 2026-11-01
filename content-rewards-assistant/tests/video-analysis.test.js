"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Analysis = require("../video-analysis.js");

const file = (name, size, type) => ({ name, size, type });

test("validates only readable local video files and enforces the upload size limit", () => {
  assert.deepEqual(Analysis.validateSourceVideo(file("my-clip.mp4", 1000, "video/mp4")), {
    name: "my-clip.mp4", type: "video/mp4", size: 1000
  });
  assert.equal(Analysis.validateSourceVideo(file("recording.mov", 100, "")).type, "video/mov");
  assert.throws(() => Analysis.validateSourceVideo(null), /choose your own video/i);
  assert.throws(() => Analysis.validateSourceVideo(file("script.pdf", 100, "application/pdf")), /MP4, WebM, MOV/i);
  assert.throws(() => Analysis.validateSourceVideo(file("empty.mp4", 0, "video/mp4")), /empty or unreadable/i);
  assert.throws(() => Analysis.validateSourceVideo(file("large.mp4", Analysis.MAX_SOURCE_BYTES + 1, "video/mp4")), /150 MB/i);
});

test("formats duration and classifies source aspect ratio accurately", () => {
  assert.equal(Analysis.formatDuration(65.8), "1:05");
  assert.equal(Analysis.formatDuration(3661), "1:01:01");
  assert.equal(Analysis.classifyAspect(720, 1280), "vertical");
  assert.equal(Analysis.classifyAspect(1920, 1080), "horizontal");
  assert.equal(Analysis.classifyAspect(1080, 1080), "square");
  assert.equal(Analysis.classifyAspect(0, 0), "unknown");
});

test("builds a post package from supplied facts, campaign tags, mentions and platform", () => {
  const result = Analysis.buildPostPackage({
    platform: "Instagram Reels",
    language: "both",
    topic: "Budget kitchen organisation",
    notes: "Show three storage steps using the containers already available at home.",
    disclosure: "Affiliate links may earn a commission.",
    campaignName: "Home ideas",
    campaignRules: "Hashtags: #HomeIdeas #Creator\nMentions: @brand",
    video: {
      file: { name: "my-kitchen.mp4" },
      durationSeconds: 28,
      width: 720,
      height: 1280,
      aspectRatio: 0.563,
      aspect: "vertical",
      sizeBytes: 1024
    }
  });
  assert.equal(result.platform, "Instagram");
  assert.equal(result.title, "Budget kitchen organisation");
  assert.match(result.caption, /three storage steps/i);
  assert.match(result.caption, /@brand/);
  assert.ok(result.hashtags.includes("#HomeIdeas"));
  assert.ok(result.hashtags.includes("#Reels"));
  assert.equal(result.sourceFile, "my-kitchen.mp4");
  assert.equal(result.video.aspect, "vertical");
  assert.equal(result.transcriptProvided, false);
  assert.ok(result.warnings.some((item) => /does not identify objects\/scenes/i.test(item)));
});

test("requires a real topic and user-supplied description instead of guessing video contents", () => {
  assert.throws(() => Analysis.buildPostPackage({
    platform: "YouTube", topic: "", notes: "Video shows a demonstration."
  }), /at least 3 characters/i);
  assert.throws(() => Analysis.buildPostPackage({
    platform: "YouTube", topic: "My video", notes: ""
  }), /key points or a transcript/i);
});

test("warns about missing disclosures and pre-approval rules", () => {
  const result = Analysis.buildPostPackage({
    platform: "YouTube Shorts",
    topic: "Product demonstration",
    notes: "Show how the product is used.",
    campaignRules: "Disclosure: add #ad\nDraft pre-approval required before publication."
  });
  assert.ok(result.warnings.some((item) => /disclosure/i.test(item)));
  assert.ok(result.warnings.some((item) => /pre-approval/i.test(item)));
  assert.ok(result.hashtags.includes("#Shorts"));
});

test("Clip Studio wires local analysis, package download and Social Desk handoff", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const worker = fs.readFileSync(path.join(__dirname, "..", "service-worker.js"), "utf8");
  const ui = fs.readFileSync(path.join(__dirname, "..", "video-analysis-ui.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));
  for (const id of [
    "video-analysis-file", "video-analysis-run", "video-analysis-topic",
    "video-analysis-notes", "video-analysis-transcript", "video-analysis-generate",
    "video-analysis-caption", "video-analysis-download-text", "video-analysis-download-json",
    "video-analysis-use-editor", "video-analysis-send-social"
  ]) assert.ok(html.includes('id="' + id + '"'), "missing video analysis control " + id);
  assert.match(html, /video-analysis\.js/);
  assert.match(html, /video-analysis-ui\.js/);
  assert.match(worker, /video-analysis\.js/);
  assert.match(worker, /video-analysis-ui\.js/);
  assert.match(ui, /AI_COMMERCE_CLIP_HANDOFF/);
  assert.match(ui, /video file stays in this browser/i);
  assert.match(packageJson.scripts.check, /content-rewards-assistant\/video-analysis\.js/);
  assert.match(packageJson.scripts.check, /content-rewards-assistant\/video-analysis-ui\.js/);
});
