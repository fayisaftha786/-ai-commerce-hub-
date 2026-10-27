"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateProduct, calculateCalendarDateAgeDays } = require("../product-utils");

const validProduct = {
  name: "Kitchen organiser",
  platform: "Amazon",
  url: "https://www.amazon.in/dp/example"
};

test("accepts a valid HTTPS product and trims its name", () => {
  const result = validateProduct({ ...validProduct, name: "  Kitchen organiser  " });
  assert.equal(result.valid, true);
  assert.equal(result.product.name, "Kitchen organiser");
  assert.equal(result.product.url, "https://www.amazon.in/dp/example");
});

test("rejects null, arrays and non-object input", () => {
  for (const value of [null, undefined, [], "product"]) {
    assert.equal(validateProduct(value).valid, false);
  }
});

test("rejects missing, whitespace-only and overlong names", () => {
  for (const name of ["", "   ", "x".repeat(121)]) {
    assert.equal(validateProduct({ ...validProduct, name }).valid, false);
  }
});

test("rejects unsupported platforms", () => {
  assert.equal(
    validateProduct({ ...validProduct, platform: "Unknown" }).valid,
    false
  );
});

test("rejects malformed, empty and overlong URLs", () => {
  for (const url of ["", "not a URL", "x".repeat(2049)]) {
    assert.equal(validateProduct({ ...validProduct, url }).valid, false);
  }
});

test("rejects HTTP and other non-HTTPS schemes", () => {
  for (const url of [
    "http://www.amazon.in/",
    "javascript:alert(1)",
    "data:text/html,hello"
  ]) {
    assert.equal(validateProduct({ ...validProduct, url }).valid, false);
  }
});

test("rejects URLs with embedded credentials", () => {
  const result = validateProduct({
    ...validProduct,
    url: "https://user:password@example.com/product"
  });
  assert.equal(result.valid, false);
});

test("normalizes a valid HTTPS URL", () => {
  const result = validateProduct({
    ...validProduct,
    url: "https://example.com/product path"
  });
  assert.equal(result.valid, true);
  assert.equal(result.product.url, "https://example.com/product%20path");
});


test("calculates date-only evidence freshness by local calendar day", () => {
  const localToday = { getFullYear: () => 2026, getMonth: () => 9, getDate: () => 26 };
  assert.equal(calculateCalendarDateAgeDays("2026-10-26", localToday), 0);
  assert.equal(calculateCalendarDateAgeDays("2026-10-25", localToday), 1);
  assert.equal(calculateCalendarDateAgeDays("2026-10-19", localToday), 7);
  assert.equal(calculateCalendarDateAgeDays("2026-10-18", localToday), 8);
  assert.equal(calculateCalendarDateAgeDays("2026-10-27", localToday), -1);
  assert.equal(calculateCalendarDateAgeDays("2026-02-30", localToday), null);
  assert.equal(calculateCalendarDateAgeDays("", localToday), null);
});


test("accepts a safe optional HTTPS product image URL", () => {
  const result = validateProduct({ ...validProduct, imageUrl: "https://cdn.example.com/item.jpg" });
  assert.equal(result.valid, true);
  assert.equal(result.product.imageUrl, "https://cdn.example.com/item.jpg");
});

test("rejects unsafe product image URLs", () => {
  for (const imageUrl of ["http://example.com/item.jpg", "javascript:alert(1)", "https://user:pass@example.com/x", "not-a-url"]) {
    assert.equal(validateProduct({ ...validProduct, imageUrl }).valid, false);
  }
});

test("keeps legacy product records valid when no image URL exists", () => {
  const result = validateProduct(validProduct);
  assert.equal(result.valid, true);
  assert.equal(Object.hasOwn(result.product, "imageUrl"), false);
});
