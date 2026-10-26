"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateProduct } = require("../product-utils");

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
