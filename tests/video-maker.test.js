"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const source = fs.readFileSync(path.join(root, "video-maker.js"), "utf8");

test("video maker controls exist and script loads before app initialisation", () => {
  for (const id of ["videoMakerForm", "videoMakerImages", "videoMakerName", "videoMakerBenefit", "videoMakerPreview", "videoMakerDownload", "videoMakerStatus", "videoMakerLanguage"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(scripts.indexOf("video-maker.js") >= 0);
  assert.ok(scripts.indexOf("video-maker.js") < scripts.indexOf("app.js"));
});

test("video maker validates image count and size and creates local WebM output", () => {
  assert.match(source, /MAX_FILES = 8/);
  assert.match(source, /MAX_FILE_BYTES = 10 \* 1024 \* 1024/);
  assert.match(source, /video\/webm/);
  assert.match(source, /URL\.createObjectURL/);
  assert.match(source, /URL\.revokeObjectURL/);
});

test("video maker embeds a language-specific affiliate disclosure on each slide", () => {
  assert.match(html, /id="videoMakerLanguage"/);
  assert.match(source, /Affiliate link • I may earn a commission/);
  assert.match(source, /അഫിലിയേറ്റ് ലിങ്ക്/);
  assert.match(source, /drawSlide\(ctx, images\[i % images\.length\], title, benefit, price, cta, language, i, sceneCount, progress\)/);
});

test("video maker does not upload files or use external media services", () => {
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|https?:\/\//i);
});


test("saved product event prefills the video maker and remote images require HTTPS plus canvas access", () => {
  assert.match(html, /id="videoMakerImageUrl"/);
  assert.match(source, /commerce:prepare-video/);
  assert.match(source, /byId\("videoMakerName"\)\.value = cleanText\(product\.name, 100\)/);
  assert.match(source, /function loadRemoteImage\(value\)/);
  assert.match(source, /parsed\.protocol !== "https:"/);
  assert.match(source, /image\.crossOrigin = "anonymous"/);
  assert.match(source, /image host blocked canvas access/);
  assert.match(source, /Choose at least one authorised image file or enter a direct HTTPS image URL/);
});


test("video scenes animate product imagery and use distinct hook, benefit, and CTA labels", () => {
  assert.match(source, /Ken Burns-style push-in/);
  assert.match(source, /requestAnimationFrame\(paintFrame\)/);
  assert.match(source, /STOP THE SCROLL/);
  assert.match(source, /WHY IT MAY HELP/);
  assert.match(source, /TAKE A CLOSER LOOK/);
  assert.match(source, /ശ്രദ്ധിക്കൂ!/);
  assert.match(source, /പ്രധാന ഗുണം/);
  assert.match(source, /വിശദാംശങ്ങൾ പരിശോധിക്കൂ/);
});


test("single-image videos expand into a structured short-form storyboard", () => {
  assert.match(source, /TARGET_VIDEO_MS = 16000/);
  assert.match(source, /MIN_SCENES = 4/);
  assert.match(source, /const sceneCount = Math\.max\(MIN_SCENES, images\.length\)/);
  assert.match(source, /const sceneDuration = Math\.max\(MIN_SCENE_MS, Math\.round\(TARGET_VIDEO_MS \/ sceneCount\)\)/);
  assert.match(source, /images\[i % images\.length\]/);
  assert.match(source, /const isHook = index === 0 && total > 1/);
  assert.match(source, /const isClosing = index === total - 1 && total > 1/);
});


test("video storyboard uses distinct hook, product-benefit and closing copy", () => {
  assert.match(source, /const sceneTitle = isHook/);
  assert.match(source, /Before you decide, take a look/);
  assert.match(source, /Could " \+ title \+ " fit your needs/);
  assert.match(source, /const sceneBenefit = isHook/);
  assert.match(source, /isClosing \? \(language === "Malayalam" \? "വിലയും ലഭ്യതയും പരിശോധിക്കൂ"/);
  assert.match(source, /if \(price && !isClosing\)/);
});

test("video maker falls back to uploaded images when an optional remote image is blocked", () => {
  assert.match(source, /const uploadedImages = await Promise\.all\(files\.map\(loadImage\)\)/);
  assert.match(source, /let remoteImageWarning = ""/);
  assert.match(source, /if \(!uploadedImages\.length\) throw error/);
  assert.match(source, /images\.push\(\.\.\.uploadedImages\)/);
  assert.match(source, /Remote image unavailable; using the uploaded image files instead/);
  assert.match(source, /if \(!images\.length\) throw new Error\("No usable product images were loaded/);
});

test("video export always cleans up capture tracks and names downloads after the product", () => {
  assert.match(source, /let activeStream = null/);
  assert.match(source, /let activeRecorder = null/);
  assert.match(source, /if \(activeRecorder && activeRecorder\.state !== "inactive"\)/);
  assert.match(source, /if \(activeStream\) activeStream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(source, /\.normalize\("NFKD"\)/);
  assert.match(source, /link\.download = filename \+ "-video\.webm"/);
});
