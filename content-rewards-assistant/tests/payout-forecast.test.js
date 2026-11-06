"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Forecast = require("../payout-forecast.js");
const tenDays = 10 * Forecast.DAY_MS;

test("CPM forecast starts only after approval and the minimum payout threshold", () => {
  const approvedAt = "2026-11-01T10:00:00.000Z";
  const noThreshold = Forecast.calculatePayoutForecast({
    payoutModel: "CPM",
    payoutThresholdStatus: "not-required",
    reviewedAt: approvedAt
  });
  assert.equal(noThreshold.status, "estimate");
  assert.equal(noThreshold.estimateAt, new Date(Date.parse(approvedAt) + tenDays).toISOString());

  const metLater = Forecast.calculatePayoutForecast({
    payoutModel: "CPM",
    payoutThresholdStatus: "met",
    payoutThresholdMetAt: "2026-11-03T10:00:00.000Z",
    reviewedAt: approvedAt
  });
  assert.equal(metLater.estimateAt, "2026-11-13T10:00:00.000Z");
  assert.match(metLater.detail, /both approval and the minimum payout requirement/i);
  assert.match(metLater.caveat, /First approved round/);

  const thresholdBeforeApproval = Forecast.calculatePayoutForecast({
    payoutModel: "CPM",
    payoutThresholdStatus: "met",
    payoutThresholdMetAt: "2026-10-30T10:00:00.000Z",
    reviewedAt: approvedAt
  });
  assert.equal(thresholdBeforeApproval.estimateAt, "2026-11-11T10:00:00.000Z");
});

test("CPM and Per-post do not invent a date while approval or required threshold is unknown", () => {
  assert.equal(Forecast.calculatePayoutForecast({ payoutModel: "CPM" }).status, "waiting");
  assert.equal(Forecast.calculatePayoutForecast({
    payoutModel: "CPM",
    reviewedAt: "2026-11-01T10:00:00.000Z",
    payoutThresholdStatus: "unknown"
  }).status, "needs-input");
  assert.equal(Forecast.calculatePayoutForecast({
    payoutModel: "Per post",
    reviewedAt: "2026-11-01T10:00:00.000Z",
    payoutThresholdStatus: "pending"
  }).status, "waiting");
  assert.equal(Forecast.calculatePayoutForecast({
    payoutModel: "Per post",
    reviewedAt: "2026-11-01T10:00:00.000Z",
    payoutThresholdStatus: "met",
    payoutThresholdMetAt: "bad date"
  }).status, "needs-input");
});

test("Per-post, Retainer and Pool forecasts use their own payout rules", () => {
  const perPost = Forecast.calculatePayoutForecast({
    payoutModel: "Per post",
    reviewedAt: "2026-11-01T10:00:00.000Z",
    payoutThresholdStatus: "not-required"
  });
  assert.equal(perPost.estimateAt, "2026-11-01T10:15:00.000Z");
  assert.equal(perPost.estimateEndAt, "2026-11-01T10:30:00.000Z");

  const thresholdLater = Forecast.calculatePayoutForecast({
    payoutModel: "Per post",
    reviewedAt: "2026-11-01T10:00:00.000Z",
    payoutThresholdStatus: "met",
    payoutThresholdMetAt: "2026-11-02T10:00:00.000Z"
  });
  assert.equal(thresholdLater.estimateAt, "2026-11-02T10:15:00.000Z");
  assert.equal(thresholdLater.estimateEndAt, "2026-11-02T10:30:00.000Z");

  const retainer = Forecast.calculatePayoutForecast({
    payoutModel: "Retainer",
    payoutCycleEndAt: "2026-11-30T12:00:00.000Z"
  });
  assert.equal(retainer.estimateAt, "2026-11-30T12:15:00.000Z");

  const pool = Forecast.calculatePayoutForecast({
    payoutModel: "Pool",
    payoutThresholdStatus: "met",
    payoutPoolEndedAt: "2026-11-30T12:00:00.000Z"
  });
  assert.equal(pool.status, "needs-input");
  assert.equal(pool.estimateAt, "");
  assert.match(pool.detail, /does not give a universal Pool settlement schedule/);
});

test("flags, ineligible records, and missing Pool eligibility suppress payout dates", () => {
  assert.equal(Forecast.calculatePayoutForecast({
    payoutModel: "CPM",
    payoutFlagOpen: true
  }).status, "paused");
  assert.equal(Forecast.calculatePayoutForecast({
    payoutModel: "Pool",
    payoutThresholdStatus: "unknown",
    payoutPoolEndedAt: "2026-11-30T12:00:00.000Z"
  }).status, "waiting");
  assert.equal(Forecast.calculatePayoutForecast({
    payoutModel: "Pool",
    payoutThresholdStatus: "not-met",
    payoutPoolEndedAt: "2026-11-30T12:00:00.000Z"
  }).status, "blocked");
  assert.equal(Forecast.calculatePayoutForecast({
    payoutModel: "CPM",
    payoutStatus: "not-eligible"
  }).status, "blocked");
});

test("an available or credited Content Rewards balance is not forecast as a new payout", () => {
  assert.equal(Forecast.calculatePayoutForecast({
    payoutModel: "CPM",
    payoutStatus: "available"
  }).status, "credited");
  assert.equal(Forecast.calculatePayoutForecast({
    payoutModel: "CPM",
    payoutStatus: "paid",
    paidAmountStage: "content-rewards-balance",
    paidAmount: 15
  }).status, "credited");
});

test("ClipReward payout forecast UI and offline cache are wired", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const core = fs.readFileSync(path.join(root, "core.js"), "utf8");
  const worker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  assert.match(html, /payout-forecast\.js/);
  for (const id of ["ops-payout-model", "ops-payout-threshold-status", "ops-payout-threshold-met-at", "ops-payout-cycle-end-at", "ops-payout-pool-ended-at", "ops-payout-flag-open", "ops-payout-forecast"]) {
    assert.ok(html.includes('id="' + id + '"'), "missing " + id);
  }
  assert.match(app, /PayoutForecast\.calculatePayoutForecast/);
  assert.match(app, /function renderPayoutForecast\(/);
  for (const field of ["payoutModel", "payoutThresholdStatus", "payoutThresholdMetAt", "payoutCycleEndAt", "payoutPoolEndedAt", "payoutFlagOpen"]) {
    assert.ok(core.includes(field), "missing normalized field " + field);
  }
  assert.match(worker, /clipreward-static-v44/);
  assert.match(worker, /payout-forecast\.js/);
  assert.match(app, /payoutModel: old \? old\.payoutModel/);
  assert.match(app, /payoutThresholdMetAt: old \? old\.payoutThresholdMetAt/);
  assert.match(app, /payoutFlagOpen: old \? old\.payoutFlagOpen/);
});
