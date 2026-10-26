"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
const serviceWorker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");

test("PWA manifest is installable and uses relative scope for project subpaths", () => {
  assert.equal(manifest.name, "AI Commerce Hub");
  assert.equal(manifest.short_name, "AI Commerce");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some((icon) => icon.src === "./icon.svg" && icon.sizes === "any"));
  assert.ok(fs.existsSync(path.join(root, "icon.svg")));
});

test("service worker precaches the local app shell and uses offline fallback", () => {
  for (const asset of [
    "./index.html",
    "./style.css",
    "./manifest.webmanifest",
    "./icon.svg",
    "./product-utils.js",
    "./discovery-engine.js",
    "./catalog-import.js",
    "./app.js"
  ]) {
    assert.ok(serviceWorker.includes('"' + asset + '"'), "missing cached asset " + asset);
  }
  assert.match(serviceWorker, /cache\.addAll\(ASSET_PATHS\.map\(assetUrl\)\)/);
  assert.match(serviceWorker, /const response = await fetch\(request\)/);
  assert.match(serviceWorker, /const cached = await cache\.match\(request\)/);
  assert.match(serviceWorker, /request\.mode === "navigate"/);
  assert.match(serviceWorker, /cache\.delete\(key\)/);
});

test("HTML links the PWA manifest and registers service worker outside file URLs", () => {
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest">/);
  assert.match(html, /navigator\.serviceWorker\.register\("\.\/service-worker\.js"\)/);
  assert.match(html, /location\.protocol !== "file:"/);
});
