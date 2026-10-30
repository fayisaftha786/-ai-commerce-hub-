"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { collectLocalAssets, assembleSite } = require("../scripts/pages-build");

const root = path.join(__dirname, "..");

test("Pages asset discovery includes every app script, styles and PWA dependency", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const assets = collectLocalAssets(html);
  for (const name of [
    "index.html", "style.css", "manifest.webmanifest", "icon.svg",
    "earning-engine.js", "earning-hub.js", "product-utils.js", "offer-engine.js",
    "discovery-engine.js", "catalog-import.js", "marketplace-search.js",
    "campaign-report.js", "video-maker.js", "social-center.js", "app.js",
    "pwa-install.js", "app-health.js", "workflow-guide.js", "service-worker.js"
  ]) {
    assert.ok(assets.includes(name), "missing required Pages asset: " + name);
  }
});

test("assembled Pages bundle contains every referenced root asset and nested assistant", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-commerce-pages-"));
  const output = path.join(temp, "site");
  try {
    const result = assembleSite({ rootDir: root, outputDir: output });
    assert.ok(result.assets.includes("earning-engine.js"));
    assert.ok(result.assets.includes("earning-hub.js"));
    for (const name of result.assets) assert.ok(fs.statSync(path.join(output, name)).isFile(), name);
    assert.ok(fs.statSync(path.join(output, "content-rewards-assistant", "index.html")).isFile());
    assert.ok(fs.existsSync(path.join(output, ".nojekyll")));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("Pages asset discovery rejects path traversal", () => {
  assert.throws(
    () => collectLocalAssets('<script src="../secret.js"></script>'),
    /Unsafe local asset path/
  );
});
