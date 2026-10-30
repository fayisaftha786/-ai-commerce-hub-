"use strict";

const fs = require("node:fs");
const path = require("node:path");

function collectLocalAssets(html) {
  const assets = new Set(["index.html", "service-worker.js"]);
  const tags = html.match(/<(?:script|link)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const isScript = /^<script\b/i.test(tag);
    const isLink = /^<link\b/i.test(tag);
    if (!isScript && !isLink) continue;
    if (isLink) {
      const rel = (tag.match(/\brel=["']([^"']+)["']/i) || [])[1] || "";
      if (!/\b(stylesheet|manifest|icon)\b/i.test(rel)) continue;
    }
    const attrPattern = isScript ? /\bsrc=["']([^"']+)["']/i : /\bhref=["']([^"']+)["']/i;
    const value = (tag.match(attrPattern) || [])[1];
    if (!value || /^(?:[a-z]+:|\/\/|#)/i.test(value)) continue;
    const clean = value.split(/[?#]/, 1)[0].replace(/^\.\//, "");
    if (!clean || clean.startsWith("/") || clean.split("/").includes("..")) {
      throw new Error("Unsafe local asset path in index.html: " + value);
    }
    assets.add(clean);
  }
  return [...assets].sort();
}

function assembleSite(options = {}) {
  const rootDir = path.resolve(options.rootDir || path.join(__dirname, ".."));
  const outputDir = path.resolve(options.outputDir || path.join(rootDir, "_site"));
  if (outputDir === rootDir || rootDir.startsWith(outputDir + path.sep)) {
    throw new Error("Output directory must not overwrite or contain the source project.");
  }
  const html = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
  const assets = collectLocalAssets(html);
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  for (const asset of assets) {
    const source = path.resolve(rootDir, asset);
    if (!source.startsWith(rootDir + path.sep) || !fs.existsSync(source) || !fs.statSync(source).isFile()) {
      throw new Error("Required GitHub Pages asset is missing or not a file: " + asset);
    }
    const destination = path.join(outputDir, asset);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }

  const rewardsSource = path.join(rootDir, "content-rewards-assistant");
  if (!fs.existsSync(rewardsSource) || !fs.statSync(rewardsSource).isDirectory()) {
    throw new Error("Content Rewards assistant directory is missing.");
  }
  fs.cpSync(rewardsSource, path.join(outputDir, "content-rewards-assistant"), { recursive: true });
  fs.writeFileSync(path.join(outputDir, ".nojekyll"), "");
  return { outputDir, assets };
}

if (require.main === module) {
  try {
    const outputDir = process.argv[2] || path.join(__dirname, "..", "_site");
    const result = assembleSite({ outputDir });
    process.stdout.write("GitHub Pages site assembled: " + result.assets.length + " root assets + Content Rewards assistant\n");
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  }
}

module.exports = { collectLocalAssets, assembleSite };
