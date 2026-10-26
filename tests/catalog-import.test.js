"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { rankCatalogCsv } = require("../catalog-import");

test("ranks imported products using supplied order and click evidence", () => {
  const csv = "name,platform,url,price,commission,rating,reviews,clicks,orders,period_days,stock\n" +
    '"Storage, organiser",Meesho,https://www.meesho.com/item,599,10,4.4,250,100,12,7,yes\n' +
    "Lamp,Amazon,https://www.amazon.in/item,899,5,4.1,80,100,2,7,yes";
  const result = rankCatalogCsv(csv);
  assert.equal(result.valid, true);
  assert.equal(result.importedRows, 2);
  assert.equal(result.records[0].name, "Storage, organiser");
  assert.ok(result.records[0].score > result.records[1].score);
  assert.equal(result.records[0].conversionRate, 0.12);
});

test("requires minimum headers and valid rows", () => {
  assert.equal(rankCatalogCsv("").valid, false);
  assert.equal(rankCatalogCsv("name\nLamp").valid, false);
  assert.equal(rankCatalogCsv("name,price\nLamp,0").valid, false);
});

test("does not trust unsafe product links and warns when no performance data exists", () => {
  const result = rankCatalogCsv("name,price,url\nLamp,499,javascript:alert(1)");
  assert.equal(result.valid, true);
  assert.equal(result.records[0].url, "");
  assert.ok(result.records[0].warnings.some((warning) => warning.includes("No click/order data")));
  assert.ok(result.records[0].warnings.some((warning) => warning.includes("valid HTTPS")));
});

test("rejects unclosed quoted CSV fields", () => {
  const result = rankCatalogCsv('name,price\n"broken,499');
  assert.equal(result.valid, false);
  assert.match(result.error, /unclosed quoted field/i);
});

test("penalises high returns and warns about return rate", () => {
  const good = rankCatalogCsv("name,price,orders,clicks,returns,period_days\nLamp,499,50,200,2,30");
  const poor = rankCatalogCsv("name,price,orders,clicks,returns,period_days\nLamp,499,50,200,15,30");
  assert.ok(poor.records[0].score < good.records[0].score);
  assert.ok(poor.records[0].warnings.some((warning) => warning.includes("return rate")));
});

test("rejects malformed quotes, duplicate headers and mismatched row widths", () => {
  assert.equal(rankCatalogCsv('name,price\n"lamp"x,499').valid, false);
  assert.equal(rankCatalogCsv("name,product_name,price\nLamp,Lamp,499").valid, false);
  const result = rankCatalogCsv("name,price,rating\nLamp,499");
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /expected 3 columns/i);
});

test("accepts quoted thousands separators and rejects fractional counts", () => {
  const good = rankCatalogCsv('name,price,orders,clicks,period_days\nLamp,"1,299",12,100,7');
  assert.equal(good.valid, true);
  assert.equal(good.records[0].price, 1299);
  const bad = rankCatalogCsv("name,price,orders\nLamp,499,1.5");
  assert.equal(bad.valid, false);
});

test("does not award stock points when stock is unknown", () => {
  const result = rankCatalogCsv("name,price\nLamp,499");
  assert.equal(result.valid, true);
  assert.equal(result.records[0].inStock, null);
  assert.ok(result.records[0].warnings.some((warning) => warning.includes("Stock status")));
});

test("warns when supplied orders exceed clicks and rejects fractional reporting periods", () => {
  const result = rankCatalogCsv("name,price,clicks,orders,period_days\nLamp,499,10,12,7");
  assert.equal(result.valid, true);
  assert.ok(result.records[0].warnings.some((warning) => warning.includes("Orders exceed clicks")));
  assert.equal(rankCatalogCsv("name,price,orders,period_days\nLamp,499,12,7.5").valid, false);
});


test("labels evidence completeness and normalizes metrics by the supplied period", () => {
  const complete = rankCatalogCsv(
    "name,price,clicks,orders,period_days\nLamp,499,100,12,6"
  ).records[0];
  assert.equal(complete.evidenceQuality, "Complete");
  assert.equal(complete.ordersPerDay, 2);
  assert.equal(complete.clicksPerDay, 100 / 6);
  assert.equal(complete.conversionRate, 0.12);

  const partial = rankCatalogCsv(
    "name,price,clicks,orders\nLamp,499,100,12"
  ).records[0];
  assert.equal(partial.evidenceQuality, "Partial");
  assert.equal(partial.ordersPerDay, null);

  const limited = rankCatalogCsv(
    "name,price,clicks,orders,period_days\nLamp,499,0,3,7"
  ).records[0];
  assert.equal(limited.evidenceQuality, "Limited");
  assert.equal(limited.conversionRate, null);

  const unverified = rankCatalogCsv("name,price\nLamp,499").records[0];
  assert.equal(unverified.evidenceQuality, "Unverified");
  assert.equal(unverified.clicksPerDay, null);
});


test("gives cautious promotion guidance for stock, returns, and data quality", () => {
  const ready = rankCatalogCsv(
    "name,price,clicks,orders,returns,period_days,stock\nLamp,499,100,12,1,7,yes"
  ).records[0];
  assert.equal(ready.promotionReadiness, "Shortlist for a small test");

  const outOfStock = rankCatalogCsv(
    "name,price,clicks,orders,returns,period_days,stock\nLamp,499,100,12,1,7,no"
  ).records[0];
  assert.equal(outOfStock.promotionReadiness, "Do not promote yet");

  const highReturns = rankCatalogCsv(
    "name,price,clicks,orders,returns,period_days,stock\nLamp,499,100,12,3,7,yes"
  ).records[0];
  assert.equal(highReturns.promotionReadiness, "Do not promote yet");

  const incomplete = rankCatalogCsv(
    "name,price,clicks,orders,stock\nLamp,499,100,12,yes"
  ).records[0];
  assert.equal(incomplete.promotionReadiness, "Test cautiously");

  const conflict = rankCatalogCsv(
    "name,price,clicks,orders,period_days,stock\nLamp,499,10,12,7,yes"
  ).records[0];
  assert.equal(conflict.promotionReadiness, "Do not promote yet");
});


test("normalizes sales to a 30-day equivalent when reporting periods differ", () => {
  const csv = "name,price,orders,clicks,period_days\n" +
    "Seven day,499,14,100,7\n" +
    "Thirty day,499,30,200,30";
  const result = rankCatalogCsv(csv);
  assert.equal(result.valid, true);
  const sevenDay = result.records.find((record) => record.name === "Seven day");
  const thirtyDay = result.records.find((record) => record.name === "Thirty day");
  assert.equal(sevenDay.normalizedOrders, 60);
  assert.equal(thirtyDay.normalizedOrders, 30);
  assert.ok(sevenDay.score > thirtyDay.score);
});

test("provides transparent reasons, next action and commission estimates", () => {
  const ready = rankCatalogCsv(
    "name,price,commission,clicks,orders,returns,period_days,stock\nLamp,500,10,100,20,2,14,yes"
  ).records[0];
  assert.equal(ready.estimatedCommissionPerOrder, 50);
  assert.equal(ready.estimatedCommissionAfterReturns, 45);
  assert.ok(ready.recommendationReasons.some((reason) => reason.includes("reporting period")));
  assert.match(ready.nextAction, /small .*test/i);

  const unknownReturns = rankCatalogCsv(
    "name,price,commission,orders\nLamp,500,10,20"
  ).records[0];
  assert.equal(unknownReturns.estimatedCommissionAfterReturns, null);
  assert.ok(unknownReturns.recommendationReasons.length > 0);
});

test("does not estimate commission after returns when return count exceeds orders", () => {
  const record = rankCatalogCsv(
    "name,price,commission,orders,returns\nLamp,500,10,10,12"
  ).records[0];
  assert.equal(record.estimatedCommissionAfterReturns, null);
  assert.ok(record.warnings.some((warning) => warning.includes("Returns exceed orders")));
});


test("ranks promotion readiness before raw score when performance metrics conflict", () => {
  const csv = "name,price,commission,rating,reviews,clicks,orders,returns,period_days,stock\n" +
    "Conflicted,499,10,5,1000,1,100,0,30,yes\n" +
    "Consistent,499,10,4.5,200,100,10,0,30,yes";
  const result = rankCatalogCsv(csv);
  assert.equal(result.valid, true);
  assert.equal(result.records[0].name, "Consistent");
  assert.equal(result.records[0].promotionReadiness, "Shortlist for a small test");
  assert.equal(result.records[1].name, "Conflicted");
  assert.equal(result.records[1].promotionReadiness, "Do not promote yet");
  assert.ok(result.records[1].warnings.some((warning) => warning.includes("Orders exceed clicks")));
  assert.ok(result.records[1].score > result.records[0].score);
});


test("records evidence source and flags stale or missing check dates", () => {
  const stale = rankCatalogCsv("name,price,source,checked_at\nLamp,499,Official dashboard,2026-10-01");
  assert.equal(stale.valid, true);
  assert.equal(stale.records[0].source, "Official dashboard");
  assert.equal(stale.records[0].checkedAt, "2026-10-01");
  assert.ok(stale.records[0].warnings.some((warning) => warning.includes("over 7 days old")));
  const missing = rankCatalogCsv("name,price\nLamp,499");
  assert.ok(missing.records[0].warnings.some((warning) => warning.includes("Evidence source missing")));
  assert.ok(missing.records[0].warnings.some((warning) => warning.includes("Checked date missing")));
});


test("requires a recorded source and current check date before shortlisting a product", () => {
  const today = new Date().toISOString().slice(0, 10);
  const staleDate = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const baseHeaders = "name,price,commission,clicks,orders,returns,period_days,stock,source,checked_at\n";
  const current = rankCatalogCsv(baseHeaders + "Lamp,500,10,100,20,2,14,yes,Official dashboard," + today).records[0];
  assert.equal(current.evidenceFreshness, "current");
  assert.equal(current.evidenceTraceable, true);
  assert.equal(current.promotionReadiness, "Shortlist for a small test");

  const missingSource = rankCatalogCsv(
    "name,price,commission,clicks,orders,returns,period_days,stock,checked_at\n" +
    "Lamp,500,10,100,20,2,14,yes," + today
  ).records[0];
  assert.equal(missingSource.promotionReadiness, "Verify before promotion");
  assert.ok(missingSource.recommendationReasons.some((reason) => reason.includes("source is missing")));

  const stale = rankCatalogCsv(
    baseHeaders + "Lamp,500,10,100,20,2,14,yes,Official dashboard," + staleDate
  ).records[0];
  assert.equal(stale.evidenceFreshness, "stale");
  assert.equal(stale.promotionReadiness, "Verify before promotion");
  assert.ok(stale.recommendationReasons.some((reason) => reason.includes("Evidence is stale")));

  const future = rankCatalogCsv(
    baseHeaders + "Lamp,500,10,100,20,2,14,yes,Official dashboard," + tomorrow
  ).records[0];
  assert.equal(future.evidenceFreshness, "future");
  assert.equal(future.promotionReadiness, "Verify before promotion");
  assert.ok(future.recommendationReasons.some((reason) => reason.includes("in the future")));
});
