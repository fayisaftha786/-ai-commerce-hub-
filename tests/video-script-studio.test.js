"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildVideoScript, formatVideoScript } = require("../video-script-studio.js");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

test("creates a four-scene Malayalam script with affiliate disclosure", () => {
  const result = buildVideoScript({
    product: "Storage box",
    benefit: "helps organise small spaces",
    price: "₹599",
    audience: "small homes",
    language: "Malayalam"
  });
  assert.equal(result.valid, true);
  assert.equal(result.scenes.length, 4);
  assert.match(result.scenes[1].voice, /Storage box/);
  assert.match(result.scenes[3].voice, /₹599/);
  assert.match(result.disclosure, /കമ്മീഷൻ/);
});

test("requires product name and benefit", () => {
  assert.equal(buildVideoScript({ product: "", benefit: "" }).valid, false);
});

test("uses English copy when selected and formats a downloadable script", () => {
  const result = buildVideoScript({ product: "Bottle", benefit: "easy to carry", language: "English" });
  const text = formatVideoScript(result);
  assert.match(text, /Voice-over:/);
  assert.match(text, /Affiliate disclosure:/);
  assert.match(text, /Hook/);
});

test("limits input and strips markup-like characters", () => {
  const result = buildVideoScript({ product: "<b>" + "x".repeat(150), benefit: "useful & simple" });
  assert.equal(result.product.includes("<"), false);
  assert.ok(result.product.length <= 100);
});

test("video script studio controls are present and script is wired before app init", () => {
  for (const id of ["videoScriptForm", "videoScriptProduct", "videoScriptBenefit", "videoScriptOutput", "videoScriptStatus", "copyVideoScript", "downloadVideoScript"]) {
    assert.ok(html.includes('id="' + id + '"'), "missing " + id);
  }
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(scripts.indexOf("video-script-studio.js") >= 0);
  assert.ok(scripts.indexOf("video-script-studio.js") < scripts.indexOf("app.js"));
  assert.match(packageJson.scripts.check, /video-script-studio\.js/);
});
