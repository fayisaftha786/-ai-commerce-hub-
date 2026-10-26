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
  const result = rankCatalogCsv("name,price,clicks,orders,period_days\\nLamp,499,10,12,7");
  assert.equal(result.valid, true);
  assert.ok(result.records[0].warnings.some((warning) => warning.includes("Orders exceed clicks")));
  assert.equal(rankCatalogCsv("name,price,orders,period_days\\nLamp,499,12,7.5").valid, false);
});
