"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const source = fs.readFileSync(path.join(root, "video-maker.js"), "utf8");
const health = fs.readFileSync(path.join(root, "app-health.js"), "utf8");
test("Reels and Shorts studio controls exist and script loads before app", () => {
  for (const id of ["videoMakerForm", "videoMakerImages", "videoMakerName", "videoMakerBenefit", "videoMakerScenes", "videoMakerCaption", "videoMakerPreview", "videoMakerDownload", "videoMakerStatus", "videoMakerLanguage", "generateVideoScript", "copyVideoCaption", "videoMakerVoiceFile", "videoMakerMusicFile", "recordVoiceStart", "recordVoiceStop"]) assert.match(html, new RegExp('id="' + id + '"'));
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(match => match[1]);
  assert.ok(scripts.indexOf("video-maker.js") >= 0);
  assert.ok(scripts.indexOf("video-maker.js") < scripts.indexOf("app.js"));
});
test("script generator supports Malayalam, English and bilingual editable captions", () => {
  assert.match(source, /function makeScenes\(\)/);
  assert.match(source, /ഇത് ശ്രദ്ധിക്കൂ/);
  assert.match(source, /Take a look at this/);
  assert.match(source, /Key benefit:/);
  assert.match(source, /copyVideoCaption/);
  assert.match(source, /maxScenes: MAX_SCENES/);
});
test("renderer validates image count, scene count and browser WebM support", () => {
  assert.match(source, /MAX_FILES = 8/);
  assert.match(source, /MAX_FILE_BYTES = 10 \* 1024 \* 1024/);
  assert.match(source, /MAX_SCENES = 6/);
  assert.match(source, /MIN_SCENES = 4/);
  assert.match(source, /video\/webm/);
  assert.match(source, /captureStream\(30\)/);
  assert.match(source, /720/);
  assert.match(source, /1280/);
});
test("voice-over recording and uploaded audio can be mixed with optional music", () => {
  assert.match(source, /getUserMedia\(\{ audio: true \}\)/);
  assert.match(source, /new MediaRecorder\(micStream\)/);
  assert.match(source, /createMediaStreamDestination/);
  assert.match(source, /decodeAudioData/);
  assert.match(source, /gain\.gain\.value = 0\.12/);
  assert.match(source, /MAX_AUDIO_BYTES = 25 \* 1024 \* 1024/);
  assert.match(source, /audioTrack\.stream\.getAudioTracks\(\)/);
});
test("media cleanup and rights disclosure are present", () => {
  assert.match(source, /URL\.createObjectURL/);
  assert.match(source, /URL\.revokeObjectURL/);
  assert.match(source, /beforeunload/);
  assert.match(source, /Affiliate link • I may earn a commission/);
  assert.match(source, /അഫിലിയേറ്റ് ലിങ്ക്/);
});
test("remote images require HTTPS and no media is uploaded by the studio", () => {
  assert.match(source, /parsed\.protocol !== "https:"/);
  assert.match(source, /image\.crossOrigin = "anonymous"/);
  assert.match(source, /image host blocked canvas access/);
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|https?:\/\//i);
  assert.match(health, /AICommerceVideoStudio/);
  assert.match(health, /generateVideoScript/);
});
