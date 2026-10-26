"use strict";

const MAX_NAME_LENGTH = 120;

function analyzeOffer(input, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, error: "Offer details are required." };
  }

  const productName = typeof input.productName === "string" ? input.productName.trim() : "";
  if (!productName || productName.length > MAX_NAME_LENGTH) {
    return { valid: false, error: "Enter a product name (max 120 characters)." };
  }

  const currentPrice = Number(input.currentPrice);
  const originalPrice = Number(input.originalPrice);
  const shipping = input.shipping === "" || input.shipping == null ? 0 : Number(input.shipping);

  if (!Number.isFinite(currentPrice) || currentPrice <= 0 ||
      !Number.isFinite(originalPrice) || originalPrice <= 0 ||
      originalPrice < currentPrice) {
    return { valid: false, error: "Original price must be at least the current price, and both prices must be positive." };
  }
  if (!Number.isFinite(shipping) || shipping < 0) {
    return { valid: false, error: "Shipping must be zero or a positive amount." };
  }

  const discountPercent = Math.round(((originalPrice - currentPrice) / originalPrice) * 1000) / 10;
  const savings = Math.round((originalPrice - currentPrice) * 100) / 100;
  const deliveredPrice = Math.round((currentPrice + shipping) * 100) / 100;
  const expiryText = typeof input.expiresAt === "string" ? input.expiresAt.trim() : "";
  let expiryState = "not-provided";
  let expiryTime = null;
  if (expiryText) {
    // A date-only expiry means the offer is valid through that calendar day.
    const dateOnly = /^\\d{4}-\\d{2}-\\d{2}$/.test(expiryText);
    expiryTime = Date.parse(dateOnly ? expiryText + "T23:59:59.999Z" : expiryText);
    if (!Number.isFinite(expiryTime)) {
      return { valid: false, error: "Enter a valid offer expiry date or leave it blank." };
    }
    expiryState = expiryTime > now.getTime() ? "upcoming" : "expired";
  }

  const urlText = typeof input.url === "string" ? input.url.trim() : "";
  let validHttpsUrl = false;
  try {
    const url = new URL(urlText);
    validHttpsUrl = url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    validHttpsUrl = false;
  }

  // This is a transparent readiness heuristic, not proof of a genuine deal.
  let score = 20; // usable price inputs
  if (discountPercent >= 40) score += 25;
  else if (discountPercent >= 25) score += 20;
  else if (discountPercent >= 10) score += 14;
  else if (discountPercent > 0) score += 8;
  if (savings >= 1000) score += 15;
  else if (savings >= 300) score += 10;
  else if (savings > 0) score += 5;
  if (validHttpsUrl) score += 15;
  if (expiryState === "upcoming") score += 10;
  if (productName.length >= 4) score += 5;
  if (expiryState === "expired") score -= 25;
  score = Math.max(0, Math.min(100, score));

  const recommendations = [];
  if (discountPercent === 0) recommendations.push("No listed discount: lead with product value, not a discount claim.");
  else if (discountPercent < 10) recommendations.push("The listed discount is modest; explain the product benefit clearly.");
  if (!validHttpsUrl) recommendations.push("Add a valid HTTPS product link before sharing.");
  if (expiryState === "expired") recommendations.push("This offer appears expired. Verify it before publishing.");
  if (expiryState === "not-provided") recommendations.push("Add an expiry date only if the seller confirms one; avoid false urgency.");
  recommendations.push("Verify the current price, stock, shipping and terms on the seller page.");
  recommendations.push("The listed original price has not been independently verified.");

  return {
    valid: true,
    offer: {
      productName,
      currentPrice,
      originalPrice,
      shipping,
      deliveredPrice,
      savings,
      discountPercent,
      expiryState,
      expiresAt: expiryText || null,
      validHttpsUrl,
      score,
      scoreLabel: score >= 75 ? "Ready to review" : score >= 50 ? "Needs checks" : "Low confidence",
      recommendations
    }
  };
}

function createPromoCopy(offer, language = "Malayalam", channel = "WhatsApp") {
  if (!offer || typeof offer !== "object" || !offer.productName) {
    throw new TypeError("A valid analyzed offer is required.");
  }
  const money = (value) => "₹" + Number(value).toLocaleString("en-IN", {
    maximumFractionDigits: 2
  });
  const savingsLine = offer.savings > 0
    ? `Listed price: ${money(offer.originalPrice)} → ${money(offer.currentPrice)} (listed saving ${money(offer.savings)}, ${offer.discountPercent}% off)`
    : `Price: ${money(offer.currentPrice)}`;
  const shippingLine = offer.shipping > 0
    ? `Shipping: ${money(offer.shipping)} | Total before other charges: ${money(offer.deliveredPrice)}`
    : `Total before other charges: ${money(offer.deliveredPrice)}`;
  const urgency = offer.expiryState === "upcoming" && offer.expiresAt
    ? `Offer expiry stated as: ${offer.expiresAt}. Please verify availability.`
    : "";
  const disclosure = "Affiliate disclosure: I may earn a commission from eligible purchases at no extra cost to you. Prices and availability can change.";
  const ml = [
    `🛍️ ${offer.productName}`,
    savingsLine,
    shippingLine,
    urgency,
    "വാങ്ങുന്നതിന് മുമ്പ് വിൽപ്പനക്കാരന്റെ പേജിൽ വില, സ്റ്റോക്ക്, ഡെലിവറി, നിബന്ധനകൾ എന്നിവ പരിശോധിക്കുക.",
    "[ഇവിടെ നിങ്ങളുടെ സ്ഥിരീകരിച്ച ഉൽപ്പന്ന ലിങ്ക് ചേർക്കുക]",
    disclosure
  ].filter(Boolean).join("\n\n");
  const en = [
    `🛍️ ${offer.productName}`,
    savingsLine,
    shippingLine,
    urgency,
    "Check the seller page for current price, stock, delivery and terms before buying.",
    "[Add your verified product link here]",
    disclosure
  ].filter(Boolean).join("\n\n");
  const body = language === "English" ? en : language === "Both" ? `${ml}\n\n---\n\n${en}` : ml;
  const channelHint = channel === "Instagram"
    ? "\n\n#ShoppingDeals #ProductFinds"
    : channel === "Facebook" ? "\n\nShare with someone who may find this useful." : "";
  return body + channelHint;
}

const api = { analyzeOffer, createPromoCopy };
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.AICommerceOfferEngine = api;
