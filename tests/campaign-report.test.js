"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCampaignReport } = require("../campaign-report");

const header = "campaign_id,period_start,period_end,clicks,orders,commission,returns";
const campaigns = [{ id: "ACH-demo-123", productName: "Demo product" }];

test("matches exact saved campaign ID and calculates plausible metrics", () => {
  const result = parseCampaignReport(header + "\nACH-demo-123,2026-10-01,2026-10-07,100,5,250.50,1", campaigns);
  assert.equal(result.valid, true);
  assert.equal(result.reports[0].matched, true);
  assert.equal(result.reports[0].conversionRate, 0.05);
  assert.equal(result.reports[0].returnRate, 0.2);
  assert.equal(result.reports[0].commission, 250.5);
});

test("does not guess attribution when report ID does not match a saved campaign", () => {
  const result = parseCampaignReport(header + "\nunknown-subid,2026-10-01,2026-10-07,20,1,10,0", campaigns);
  assert.equal(result.valid, true);
  assert.equal(result.reports[0].matched, false);
  assert.match(result.reports[0].warnings.join(" "), /Attribution unavailable/);
});

test("aggregates rows only within the same campaign and reporting period", () => {
  const csv = header + "\nACH-demo-123,2026-10-01,2026-10-07,10,1,20,0\nACH-demo-123,2026-10-01,2026-10-07,5,1,30,0\nACH-demo-123,2026-10-08,2026-10-14,9,0,0,0";
  const result = parseCampaignReport(csv, campaigns);
  assert.equal(result.valid, true);
  assert.equal(result.reports.length, 2);
  assert.equal(result.reports[0].clicks, 15);
  assert.equal(result.reports[0].orders, 2);
  assert.equal(result.reports[0].commission, 50);
  assert.equal(result.reports[1].clicks, 9);
});

test("does not report partial commission or return totals as complete", () => {
  const csv = header + "\nACH-demo-123,2026-10-01,2026-10-07,10,1,,\nACH-demo-123,2026-10-01,2026-10-07,5,1,30,0";
  const result = parseCampaignReport(csv, campaigns);
  assert.equal(result.valid, true);
  assert.equal(result.reports[0].commission, null);
  assert.equal(result.reports[0].returns, null);
});

test("requires campaign IDs, valid ordered dates and non-negative integer counts", () => {
  assert.equal(parseCampaignReport("period_start,period_end,clicks,orders\n2026-10-01,2026-10-02,1,1").valid, false);
  const result = parseCampaignReport(header + "\nACH-demo-123,2026-10-10,2026-10-01,-2,1,10,0", campaigns);
  assert.equal(result.valid, false);
});

test("rejects duplicate normalized headers and malformed quoting", () => {
  assert.equal(parseCampaignReport("campaign_id,sub-id,period_start,period_end,clicks,orders\na,b,2026-10-01,2026-10-02,1,1").valid, false);
  assert.equal(parseCampaignReport(header + '\n"unterminated,2026-10-01,2026-10-02,1,1,10,0').valid, false);
});

test("conversion is withheld when orders exceed clicks or clicks are zero", () => {
  const result = parseCampaignReport(header + "\nACH-demo-123,2026-10-01,2026-10-07,2,3,10,0\nACH-demo-123,2026-10-08,2026-10-14,0,1,10,0", campaigns);
  assert.equal(result.valid, true);
  assert.equal(result.reports[0].conversionRate, null);
  assert.equal(result.reports[1].conversionRate, null);
  assert.ok(result.reports.every((item) => item.warnings.some((warning) => /verify|zero/.test(warning))));
});

test("campaign report controls are wired and module is loaded before app.js", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  for (const id of ["campaignReportForm", "campaignReportCsv", "campaignReportMessage", "campaignReportResults"]) {
    assert.ok(html.includes('id="' + id + '"'));
  }
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(scripts.indexOf("campaign-report.js") < scripts.indexOf("app.js"));
  assert.match(app, /parseCampaignReport\(await file\.text\(\), campaigns\)/);
});
