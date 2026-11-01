"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "earning-hub.js"), "utf8");
const directory = fs.readFileSync(path.join(root, "creator-program-directory.js"), "utf8");

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


test("Earning Hub exposes official program import without treating it as verified earnings", () => {
  assert.match(app, /function importOfficialProgram\(source, snapshotGeneratedAt\)/);
  assert.match(app, /window\.AIEarningHub = Object\.freeze\(\{ importOfficialProgram \}\)/);
  assert.match(app, /eligibility.*unknown|createOfficialProgramOpportunity/);
  assert.match(directory, /Add research task to tracker/);
});


test("official program import stores a deduplicated research record with unknown earning fields", () => {
  const values = new Map();
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : "[]"; },
    setItem(key, value) { values.set(key, value); }
  };
  const nodes = new Map();
  function makeNode() {
    return {
      children: [], value: "", textContent: "",
      addEventListener() {},
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = [...items]; },
      reset() {}
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
      MAX_OPPORTUNITIES: 10,
      createOfficialProgramOpportunity(source) {
        return {
          valid: true,
          opportunity: {
            id: "official-" + source.id, title: "YouTube YPP", platform: "youtube",
            description: "Official public research task", sourceUrl: source.sourceUrl,
            eligibility: "unknown", payoutConfidence: "unknown", risk: "unknown",
            reward: null, effortHours: null, currency: "INR", deadline: "",
            sourceCheckedAt: "2026-11-01", deliverables: [], status: "open"
          }
        };
      },
      rankOpportunities() { return []; },
      summarizeEarnings() { return { estimated: 0, confirmed: 0, paid: 0 }; },
      createTaskPlan() { return { valid: true, tasks: [] }; }
    },
    addEventListener() {}
  };
  vm.runInNewContext(app, { window, document, localStorage, Intl, URL, Date });
  const source = {
    id: "youtube-ypp",
    sourceUrl: "https://support.google.com/youtube/answer/72851?hl=en-IN"
  };
  const first = window.AIEarningHub.importOfficialProgram(source, "2026-11-01T00:00:00.000Z");
  assert.equal(first.added, true);
  const stored = JSON.parse(values.get("ai-commerce-hub.earning-opportunities.v1"));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].eligibility, "unknown");
  assert.equal(stored[0].reward, null);
  assert.equal(stored[0].payoutConfidence, "unknown");
  const second = window.AIEarningHub.importOfficialProgram(source, "2026-11-01T00:00:00.000Z");
  assert.equal(second.added, false);
  assert.equal(second.duplicate, true);
  assert.equal(JSON.parse(values.get("ai-commerce-hub.earning-opportunities.v1")).length, 1);
});

test("official program import rolls back memory when browser storage fails", () => {
  const localStorage = {
    getItem() { return "[]"; },
    setItem() { throw new Error("quota exceeded"); }
  };
  const nodes = new Map();
  function makeNode() {
    return { children: [], addEventListener() {}, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = [...items]; }, reset() {} };
  }
  const document = {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, makeNode()); return nodes.get(id); },
    createElement() { return makeNode(); }
  };
  const window = {
    AIEarningEngine: {
      MAX_OPPORTUNITIES: 10,
      createOfficialProgramOpportunity() { return { valid: true, opportunity: { id: "official-youtube-ypp" } }; },
      rankOpportunities() { return []; }, summarizeEarnings() { return { confirmed: 0, paid: 0 }; }
    },
    addEventListener() {}
  };
  vm.runInNewContext(app, { window, document, localStorage, Intl, URL, Date });
  const result = window.AIEarningHub.importOfficialProgram({
    id: "youtube-ypp", sourceUrl: "https://support.google.com/youtube/answer/72851?hl=en-IN"
  });
  assert.equal(result.added, false);
  assert.match(result.error, /storage failed/i);
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
