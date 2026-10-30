"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "earning-hub.js"), "utf8");

test("earning hub scripts load before the root app script", () => {
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(match => match[1]);
  assert.ok(scripts.indexOf("earning-engine.js") >= 0);
  assert.ok(scripts.indexOf("earning-hub.js") > scripts.indexOf("earning-engine.js"));
  assert.ok(scripts.indexOf("earning-hub.js") < scripts.indexOf("app.js"));
});

test("every earning hub listener target exists in HTML", () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const targets = [...app.matchAll(/\$\("([^"]+)"\)\.addEventListener\(/g)].map(match => match[1]);
  assert.ok(targets.length > 0);
  assert.deepEqual([...new Set(targets.filter(id => !ids.has(id)))], []);
});

test("earning hub uses local storage and explains its limits", () => {
  assert.match(app, /ai-commerce-hub\.earning-opportunities\.v1/);
  assert.match(app, /ai-commerce-hub\.earning-tasks\.v1/);
  assert.match(html, /not a payout promise/i);
  assert.match(html, /TikTok/i);
  assert.ok(html.includes("id=\"earningTaskList\""));
  assert.ok(html.includes("id=\"earningRecordForm\""));
  assert.match(app, /function renderTasks\(\)/);
  assert.match(app, /function renderEarnings\(\)/);
  assert.match(app, /EARNINGS_KEY/);
  assert.match(app, /sourceCheckedAt/);
  assert.match(app, /official evidence link/);
});
