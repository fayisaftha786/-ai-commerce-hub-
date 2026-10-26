"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const source = fs.readFileSync(path.join(root, "video-maker.js"), "utf8");

test("video maker controls exist and script loads before app initialisation", () => {
  for (const id of ["videoMakerForm", "videoMakerImages", "videoMakerName", "videoMakerBenefit", "videoMakerPreview", "videoMakerDownload", "videoMakerStatus"]) {
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

test("video maker does not upload files or use external media services", () => {
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|https?:\/\//i);
});
