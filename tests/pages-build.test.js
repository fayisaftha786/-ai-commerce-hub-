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
    "creator-program-directory.js", "creator-programs-snapshot.json",
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
    assert.ok(result.assets.includes("creator-program-directory.js"));
    assert.ok(result.assets.includes("creator-programs-snapshot.json"));
    const snapshot = JSON.parse(fs.readFileSync(path.join(output, "creator-programs-snapshot.json"), "utf8"));
    assert.ok(snapshot.sources.some((source) => source.id === "youtube-expanded-ypp"));
    assert.ok(result.assets.includes("earning-hub.js"));
    for (const name of result.assets) assert.ok(fs.statSync(path.join(output, name)).isFile(), name);
    assert.ok(fs.statSync(path.join(output, "content-rewards-assistant", "index.html")).isFile());
    assert.ok(fs.statSync(path.join(output, "content-rewards-assistant", "discovery-snapshot.json")).isFile());
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

test("both Pages deployment workflows refresh creator-program status before site assembly", () => {
  const primary = fs.readFileSync(path.join(root, ".github", "workflows", "deploy-pages.yml"), "utf8");
  const rewards = fs.readFileSync(path.join(root, ".github", "workflows", "scheduled-content-rewards-discovery.yml"), "utf8");
  for (const [name, workflow] of [["primary Pages", primary], ["Content Rewards Pages", rewards]]) {
    const refresh = workflow.indexOf("run: node scripts/creator-program-discovery.js");
    const assemble = workflow.indexOf("run: node scripts/pages-build.js _site");
    assert.ok(refresh >= 0, name + " workflow must run official creator-program checks");
    assert.ok(assemble > refresh, name + " workflow must refresh creator data before building the site");
    assert.ok(workflow.includes("creator-programs-snapshot.json"));
  }
  assert.match(rewards, /id: creator_scan/);
  assert.match(rewards, /git add creator-programs-snapshot\.json/);
  assert.match(rewards, /git checkout -- creator-programs-snapshot\.json/);
  assert.ok(
    rewards.indexOf("git checkout -- creator-programs-snapshot.json") <
      rewards.indexOf("git commit -m"),
    "restore the old snapshot before rebasing and committing"
  );
  const ignore = 'paths-ignore:\n      - "content-rewards-assistant/discovery-snapshot.json"\n      - "creator-programs-snapshot.json"';
  assert.ok(primary.includes(ignore));
  assert.ok(rewards.includes(ignore));
});
