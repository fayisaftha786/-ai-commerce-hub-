
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateProduct } = require("../product-utils");

test("accepts a valid HTTPS product", () => {
  const result = validateProduct({
    name: "Kitchen organiser",
    platform: "Amazon",
    url: "https://www.amazon.in/"
  });

  assert.equal(result.valid, true);
});

test("rejects missing product names", () => {
  const result = validateProduct({
    name: "   ",
    platform: "Amazon",
    url: "https://www.amazon.in/"
  });

  assert.equal(result.valid, false);
});

test("rejects unsupported platforms", () => {
  const result = validateProduct({
    name: "Product",
    platform: "Unknown",
    url: "https://example.com/"
  });

  assert.equal(result.valid, false);
});

test("rejects insecure HTTP links", () => {
  const result = validateProduct({
    name: "Product",
    platform: "Amazon",
    url: "http://example.com/"
  });

  assert.equal(result.valid, false);
});

