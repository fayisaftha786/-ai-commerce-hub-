"use strict";

const ALLOWED_PLATFORMS = new Set(["Amazon", "Flipkart", "Meesho"]);
const MAX_NAME_LENGTH = 120;
const MAX_URL_LENGTH = 2048;

/**
 * Calculate the age of a YYYY-MM-DD value in local calendar days.
 * Date-only evidence has no time-of-day, so do not compare it to the UTC clock.
 * Returns null for an invalid/impossible date; negative values are future-dated.
 */
function calculateCalendarDateAgeDays(dateOnly, now = new Date()) {
  if (typeof dateOnly !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  const checkedDate = new Date(dateOnly + "T00:00:00Z");
  if (!Number.isFinite(checkedDate.getTime()) || checkedDate.toISOString().slice(0, 10) !== dateOnly) return null;
  const localToday = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
  const todayDate = new Date(localToday + "T00:00:00Z");
  return Math.floor((todayDate.getTime() - checkedDate.getTime()) / 86400000);
}

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
  module.exports = { validateProduct, calculateCalendarDateAgeDays };
}
if (typeof window !== "undefined") {
  window.AICommerceProductUtils = { validateProduct, calculateCalendarDateAgeDays };
}
