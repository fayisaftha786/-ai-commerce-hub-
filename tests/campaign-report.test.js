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
  assert.ok(result.reports.every((item) => item.warnings.some((warning) => /verif|zero/.test(warning))));
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

test("skips exact duplicate source rows to prevent double-counting", () => {
  const row = "ACH-demo-123,2026-10-01,2026-10-07,10,2,20,0";
  const result = parseCampaignReport(header + "\n" + row + "\n" + row, campaigns);
  assert.equal(result.valid, true);
  assert.equal(result.totalRows, 2);
  assert.equal(result.duplicateRows, 1);
  assert.equal(result.importedRows, 1);
  assert.equal(result.reports[0].clicks, 10);
  assert.equal(result.reports[0].orders, 2);
  assert.equal(result.dataQuality.status, "review");
  assert.equal(result.dataQuality.skippedRows, 1);
});

test("flags overlapping date ranges for the same campaign", () => {
  const csv = header + "\nACH-demo-123,2026-10-01,2026-10-07,10,1,20,0\nACH-demo-123,2026-10-07,2026-10-14,20,2,40,0";
  const result = parseCampaignReport(csv, campaigns);
  assert.equal(result.valid, true);
  assert.ok(result.reports.every((report) => report.warnings.some((warning) => /periods overlap/.test(warning))));
  assert.equal(result.dataQuality.status, "review");
});


test("campaign report analysis can be exported only after a valid import", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.ok(html.includes('id="exportCampaignReport"'));
  assert.match(app, /latestCampaignReport = result/);
  assert.match(app, /exportCampaignReport.*disabled = false/);
  assert.match(app, /ai-commerce-hub-campaign-performance\.csv/);
  assert.match(app, /matched_saved_campaign/);
});


test("compares only matched campaigns with exactly the same reporting period", () => {
  const { compareCampaignReports } = require("../campaign-report");
  const reports = [
    { campaignId: "ACH-B", periodStart: "2026-10-01", periodEnd: "2026-10-07", matched: true, clicks: 50, orders: 2, conversionRate: 0.04, commission: 40, returns: 0 },
    { campaignId: "unknown", periodStart: "2026-10-01", periodEnd: "2026-10-07", matched: false, clicks: 100, orders: 8, conversionRate: 0.08, commission: 90, returns: 0 },
    { campaignId: "ACH-A", periodStart: "2026-10-01", periodEnd: "2026-10-07", matched: true, clicks: 20, orders: 1, conversionRate: 0.05, commission: null, returns: null },
    { campaignId: "ACH-C", periodStart: "2026-10-08", periodEnd: "2026-10-14", matched: true, clicks: 30, orders: 1, conversionRate: null, commission: 10, returns: 0 }
  ];
  const comparisons = compareCampaignReports(reports);
  assert.equal(comparisons.length, 1);
  assert.equal(comparisons[0].periodStart, "2026-10-01");
  assert.deepEqual(comparisons[0].campaigns.map((item) => item.campaignId), ["ACH-A", "ACH-B"]);
  assert.equal(comparisons[0].campaigns[0].commission, null);
});

test("campaign comparison UI is wired and labels incomparable data", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.ok(html.includes('id="campaignReportResults"'));
  assert.match(app, /compareCampaignReports\(result\.reports\)/);
  assert.match(app, /exact matching date ranges/);
  assert.match(app, /Incomplete \/ unavailable/);
});
