"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Alerts = require("../submission-alerts.js");

const postedAt = "2026-11-02T10:00:00.000Z";
const postedMs = Date.parse(postedAt);
const campaign = (overrides = {}) => ({
  id: "campaign-1",
  name: "Example campaign",
  platform: "Content Rewards",
  status: "ready",
  postedAt,
  ...overrides
});

test("submission reminders use strict under-30-minute timing and final 15/5/1-minute stages", () => {
  const fifteen = Alerts.getReminder(campaign(), postedMs + 15 * 60 * 1000);
  assert.equal(fifteen.stage, "15m");
  assert.match(fifteen.body, /final 15 minutes/);

  const five = Alerts.getReminder(campaign(), postedMs + 25 * 60 * 1000);
  assert.equal(five.stage, "5m");
  assert.match(five.body, /final 5 minutes/);

  const one = Alerts.getReminder(campaign(), postedMs + 29 * 60 * 1000);
  assert.equal(one.stage, "1m");
  assert.match(one.body, /Less than 1 minute/);

  assert.equal(Alerts.getReminder(campaign(), postedMs + Alerts.WINDOW_MS), null);
  assert.equal(Alerts.getReminder(campaign(), postedMs + Alerts.WINDOW_MS + 1), null);
});

test("submission reminders ignore non-Content-Rewards and terminal campaign records", () => {
  assert.equal(Alerts.getReminder(campaign({ platform: "Whop" }), postedMs + 25 * 60 * 1000), null);
  for (const status of ["submitted", "approved", "rejected"]) {
    assert.equal(Alerts.getReminder(campaign({ status }), postedMs + 25 * 60 * 1000), null);
  }
  assert.equal(Alerts.getReminder(campaign({ postedAt: "not-a-date" }), postedMs + 25 * 60 * 1000), null);
  assert.equal(Alerts.getReminder(campaign({ postedAt: "" }), postedMs + 25 * 60 * 1000), null);
});

test("alert keys are stable for one post and change for another post or reminder stage", () => {
  const first = Alerts.getAlertKey(campaign(), "5m");
  assert.equal(first, Alerts.getAlertKey(campaign(), "5m"));
  assert.notEqual(first, Alerts.getAlertKey(campaign(), "1m"));
  assert.notEqual(first, Alerts.getAlertKey(campaign({ postedAt: "2026-11-02T11:00:00.000Z" }), "5m"));
  assert.equal(Alerts.getAlertKey({}, "5m"), "");
});

test("ClipReward wires opt-in deadline alerts, timestamp shortcuts and notification tap navigation", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const worker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  assert.match(html, /submission-alerts\.js/);
  for (const id of ["submission-alert-toggle", "submission-alert-status", "campaign-posted-now", "campaign-submitted-now"]) {
    assert.ok(html.includes('id="' + id + '"'), "missing " + id);
  }
  assert.match(app, /SubmissionAlerts\.getReminder/);
  assert.match(app, /function configureSubmissionAlerts\(\)/);
  assert.match(worker, /notificationclick/);
  assert.match(worker, /clipreward-static-v49/);
  assert.match(worker, /submission-alerts\.js/);
});
