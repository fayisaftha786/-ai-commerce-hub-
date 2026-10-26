
"use strict";

const ALLOWED_PLATFORMS = new Set([
  "Amazon",
  "Flipkart",
  "Meesho"
]);

function validateProduct(product) {
  if (!product || typeof product !== "object") {
    return { valid: false, error: "Invalid product." };
  }

  const name = typeof product.name === "string"
    ? product.name.trim()
    : "";

  if (!name || name.length > 120) {
    return { valid: false, error: "Product name is required (max 120 characters)." };
  }

  if (!ALLOWED_PLATFORMS.has(product.platform)) {
    return { valid: false, error: "Unsupported platform." };
  }

  let url;
  try {
    url = new URL(product.url);
  } catch {
    return { valid: false, error: "Invalid URL." };
  }

  if (url.protocol !== "https:") {
    return { valid: false, error: "Product links must use HTTPS." };
  }

  return {
    valid: true,
    product: {
      name,
      platform: product.platform,
      url: url.href
    }
  };
}

module.exports = { validateProduct };

