"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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


test("Earning Hub hydrates tasks and earnings with their own 1,000-record limits", () => {
  const storedTasks = Array.from({ length: 350 }, (_, index) => ({
    id: "task-" + index, title: "Task " + index, status: "todo", requiresApproval: false
  }));
  const storedEarnings = Array.from({ length: 400 }, (_, index) => ({
    id: "earning-" + index, title: "Earning " + index, amount: 10,
    currency: "INR", status: "estimated", evidenceUrl: ""
  }));
  const localStorage = {
    getItem(key) {
      if (key === "ai-commerce-hub.earning-tasks.v1") return JSON.stringify(storedTasks);
      if (key === "ai-commerce-hub.earning-records.v1") return JSON.stringify(storedEarnings);
      return "[]";
    },
    setItem() {}
  };
  const nodes = new Map();
  function makeNode() {
    return {
      children: [],
      addEventListener() {},
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = [...items]; }
    };
  }
  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, makeNode());
      return nodes.get(id);
    },
    createElement() { return makeNode(); }
  };
  const window = {
    AIEarningEngine: {
      MAX_OPPORTUNITIES: 300,
      rankOpportunities() { return []; },
      summarizeEarnings(records) {
        return {
          estimated: records.filter((item) => item.status === "estimated").reduce((sum, item) => sum + item.amount, 0),
          confirmed: 0,
          paid: 0
        };
      },
      createTaskPlan() { return { valid: true, tasks: [] }; }
    },
    addEventListener() {}
  };

  vm.runInNewContext(app, { window, document, localStorage, Intl, URL, Date });

  assert.equal(nodes.get("earningTaskList").children.length, 350);
  assert.equal(nodes.get("earningRecordList").children.length, 400);
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
