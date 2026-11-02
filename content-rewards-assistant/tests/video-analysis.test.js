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
    "video-analysis-use-editor", "video-analysis-send-social", "video-analysis-preapproval-confirm"
  ]) assert.ok(html.includes('id="' + id + '"'), "missing video analysis control " + id);
  assert.match(html, /video-analysis\.js/);
  assert.match(html, /video-analysis-ui\.js/);
  assert.match(worker, /video-analysis\.js/);
  assert.match(worker, /video-analysis-ui\.js/);
  assert.match(ui, /AI_COMMERCE_CLIP_HANDOFF/);
  assert.match(ui, /AI_COMMERCE_YOUTUBE_PUBLISH_RESULT/);
  assert.match(ui, /campaignId: campaign.id/);
  assert.match(ui, /selected campaign changed after this post package/);
  assert.match(ui, /cleanup\(\);\n          const handoffResult/);
  assert.match(ui, /clipreward:youtube-published/);
  assert.match(ui, /AI_COMMERCE_YOUTUBE_PUBLISH_RESULT/);
  assert.match(ui, /preApprovalConfirmed/);
  assert.match(ui, /source file stays in this browser/i);
  assert.match(packageJson.scripts.check, /content-rewards-assistant\/video-analysis\.js/);
  assert.match(packageJson.scripts.check, /content-rewards-assistant\/video-analysis-ui\.js/);
});


test("colour histogram and distance identify visibly different sampled frames", () => {
  const pixels = {
    data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255])
  };
  const histogram = Analysis.colorHistogram(pixels);
  assert.equal(histogram.length, 64);
  assert.equal(histogram[0], 0.5);
  assert.equal(histogram[63], 0.5);
  const dark = new Array(64).fill(0);
  const bright = new Array(64).fill(0);
  dark[0] = 1;
  bright[63] = 1;
  assert.equal(Analysis.histogramDistance(dark, dark), 0);
  assert.equal(Analysis.histogramDistance(dark, bright), 1);
});

test("scene map detects sampled cut candidates while suppressing cuts too close together", () => {
  const dark = new Array(64).fill(0);
  const bright = new Array(64).fill(0);
  dark[0] = 1;
  bright[63] = 1;
  const result = Analysis.buildSceneMap([
    { timeSeconds: 0, histogram: dark },
    { timeSeconds: 1, histogram: dark },
    { timeSeconds: 2, histogram: bright },
    { timeSeconds: 2.5, histogram: dark },
    { timeSeconds: 4, histogram: bright }
  ], 5, { threshold: 0.42, minSceneSeconds: 1.25 });
  assert.equal(result.sampleCount, 5);
  assert.deepEqual(result.cuts.map((cut) => cut.timeSeconds), [2, 4]);
  assert.deepEqual(result.scenes.map((scene) => [scene.startSeconds, scene.endSeconds]), [
    [0, 2], [2, 4], [4, 5]
  ]);
  assert.equal(result.scenes[1].cutScore, 1);
});

test("scene map validates inputs and caps the number of suggested segments", () => {
  const histogram = new Array(64).fill(0);
  assert.throws(() => Analysis.buildSceneMap([], 10), /not enough video frames/i);
  assert.throws(() => Analysis.buildSceneMap([{ timeSeconds: 0, histogram }], 0), /valid video duration/i);
  const samples = Array.from({ length: 60 }, (_, index) => {
    const frame = new Array(64).fill(0);
    frame[index % 2 ? 63 : 0] = 1;
    return { timeSeconds: index, histogram: frame };
  });
  const result = Analysis.buildSceneMap(samples, 60, { maxScenes: 5, minSceneSeconds: 0.5 });
  assert.ok(result.scenes.length <= 5);
});

test("builds SRT cues from detected scene times and requires one caption per scene", () => {
  const map = {
    scenes: [
      { startSeconds: 0, endSeconds: 2.45 },
      { startSeconds: 2.45, endSeconds: 7.1 }
    ]
  };
  const srt = Analysis.buildSrt(map, "Opening line\nSecond scene caption");
  assert.match(srt, /1\n00:00:00,000 --> 00:00:02,450\nOpening line/);
  assert.match(srt, /2\n00:00:02,450 --> 00:00:07,100\nSecond scene caption/);
  assert.throws(() => Analysis.buildSrt(map, "Only one caption"), /exactly 2 non-empty subtitle lines/i);
  assert.throws(() => Analysis.buildSrt({ scenes: [] }, "Caption"), /scene map/i);
});

test("Clip Studio exposes scene map, timed SRT and explanatory accuracy boundary", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const ui = fs.readFileSync(path.join(__dirname, "..", "video-analysis-ui.js"), "utf8");
  for (const id of [
    "video-analysis-scenes", "video-analysis-scene-captions", "video-analysis-download-srt"
  ]) assert.ok(html.includes('id="' + id + '"'), "missing scene/subtitle control " + id);
  assert.match(ui, /renderSceneMap/);
  assert.match(ui, /Analysis\.buildSrt/);
  assert.match(html, /does not .*transcribe audio from the selected video/i);
});
