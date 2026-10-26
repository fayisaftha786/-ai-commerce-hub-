"use strict";

const ALLOWED_PLATFORMS = new Set(["Amazon", "Flipkart", "Meesho"]);
const MAX_NAME_LENGTH = 120;
const MAX_URL_LENGTH = 2048;

/**
 * Validate and normalize a product entered by the user.
 * This is client-side input validation, not proof that a link belongs to
 * the selected marketplace or that an affiliate program approved it.
 */
function validateProduct(product) {
  if (!product || typeof product !== "object" || Array.isArray(product)) {
    return { valid: false, error: "Invalid product." };
  }

  const name = typeof product.name === "string" ? product.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) {
    return {
      valid: false,
      error: "Product name is required (max 120 characters)."
    };
  }

  if (!ALLOWED_PLATFORMS.has(product.platform)) {
    return { valid: false, error: "Choose Amazon, Flipkart or Meesho." };
  }

  if (typeof product.url !== "string" || !product.url.trim() ||
      product.url.trim().length > MAX_URL_LENGTH) {
    return { valid: false, error: "Enter a valid product URL (max 2048 characters)." };
  }

  let url;
  try {
    url = new URL(product.url.trim());
  } catch {
    return { valid: false, error: "Enter a valid product URL." };
  }

  if (url.protocol !== "https:") {
    return { valid: false, error: "Product links must use HTTPS." };
  }

  if (!url.hostname || url.username || url.password) {
    return { valid: false, error: "This URL is not allowed." };
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

// Keep this module usable in both Node.js tests and the browser.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { validateProduct };
}
if (typeof window !== "undefined") {
  window.AICommerceProductUtils = { validateProduct };
}
