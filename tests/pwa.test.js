"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
const serviceWorker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
const pwaInstall = fs.readFileSync(path.join(root, "pwa-install.js"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

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
    "./app.js",
    "./pwa-install.js",
    "./app-health.js"
  ]) {
    assert.ok(serviceWorker.includes('"' + asset + '"'), "missing cached asset " + asset);
  }
  assert.match(serviceWorker, /cache\.addAll\(ASSET_PATHS\.map\(assetUrl\)\)/);
  assert.match(serviceWorker, /const response = await fetch\(request\)/);
  assert.match(serviceWorker, /const cached = await cache\.match\(request\)/);
  assert.match(serviceWorker, /request\.mode === "navigate"/);
  assert.match(serviceWorker, /caches\.delete\(key\)/);
});

test("HTML links the PWA manifest and registers service worker outside file URLs", () => {
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest">/);
  assert.match(html, /navigator\.serviceWorker\.register\("\.\/service-worker\.js"\)/);
  assert.match(html, /location\.protocol !== "file:"/);
});


test("install button handles browser prompts and gives a manual HTTPS fallback", () => {
  assert.ok(html.includes('id="installAppButton"'));
  assert.ok(html.includes('id="installAppStatus"'));
  assert.match(html, /<script src="pwa-install\.js"><\/script>/);
  assert.match(pwaInstall, /beforeinstallprompt/);
  assert.match(pwaInstall, /promptEvent\.prompt\(\)/);
  assert.match(pwaInstall, /promptEvent\.userChoice/);
  assert.match(pwaInstall, /Install app or Add to Home screen/);
  assert.match(pwaInstall, /location\.protocol === "https:"/);
  assert.match(pwaInstall, /appinstalled/);
});


test("GitHub Pages deployment workflow publishes only the static runtime assets from main", () => {
  const workflowPath = path.join(root, ".github", "workflows", "deploy-pages.yml");
  const workflow = fs.readFileSync(workflowPath, "utf8");
  assert.match(workflow, /push:\s*\n\s*branches: \[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /pages: write/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /actions\/configure-pages@v5/);
  assert.match(workflow, /id: pages[\s\S]*?continue-on-error: true/);
  assert.match(workflow, /if: steps\.pages\.outcome == 'success'/);
  assert.match(workflow, /Explain missing Pages setup/);
  assert.match(workflow, /deployment was skipped safely/i);
  assert.match(workflow, /actions\/upload-pages-artifact@v4/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /path: _site/);
  for (const asset of ["index.html", "style.css", "manifest.webmanifest", "service-worker.js", "pwa-install.js", "app-health.js", "app.js"]) {
    assert.ok(workflow.includes(asset), "deployment is missing " + asset);
  }
  assert.match(readme, /select \*\*GitHub Actions\*\*/);
});
