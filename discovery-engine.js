"use strict";

function scoreCandidate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, error: "Enter product details first." };
  }
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 120) return { valid: false, error: "Product name is required (max 120 characters)." };

  const number = (value, fallback = NaN) => value === "" || value == null ? fallback : Number(value);
  const price = number(input.price);
  const rating = number(input.rating, 0);
  const reviews = number(input.reviews, 0);
  const commission = number(input.commission, 0);
  const demand = number(input.demand, 3);
  const competition = number(input.competition, 3);
  const inStock = input.inStock !== false;
  if (!Number.isFinite(price) || price <= 0) return { valid: false, error: "Enter a valid product price greater than zero." };
  if (!Number.isFinite(rating) || rating < 0 || rating > 5) return { valid: false, error: "Rating must be from 0 to 5." };
  if (!Number.isFinite(reviews) || reviews < 0 || reviews > 100000000) return { valid: false, error: "Review count must be a non-negative number." };
  if (!Number.isFinite(commission) || commission < 0 || commission > 100) return { valid: false, error: "Commission must be from 0 to 100 percent." };
  if (!Number.isInteger(demand) || demand < 1 || demand > 5) return { valid: false, error: "Demand signal must be from 1 to 5." };
  if (!Number.isInteger(competition) || competition < 1 || competition > 5) return { valid: false, error: "Competition must be from 1 to 5." };

  // A transparent shortlist score based only on the user's entered evidence.
  const demandPoints = (demand - 1) * 7.5; // max 30
  const ratingPoints = (rating / 5) * 15;
  const reviewPoints = Math.min(15, Math.log10(reviews + 1) * 3.75);
  const commissionPoints = Math.min(15, commission / 2);
  const pricePoints = price >= 199 && price <= 1999 ? 10 : price < 199 || price <= 3999 ? 6 : 3;
  const competitionPoints = (5 - competition) * 3; // max 12
  const stockPoints = inStock ? 3 : 0;
  const score = Math.round(Math.max(0, Math.min(100,
    demandPoints + ratingPoints + reviewPoints + commissionPoints + pricePoints + competitionPoints + stockPoints
  )));
  const checks = [];
  if (demand <= 2) checks.push("Demand evidence is weak; check search suggestions, social comments or recent marketplace activity.");
  if (rating < 4) checks.push("Rating is below 4/5; read recent negative reviews before recommending.");
  if (reviews < 30) checks.push("Few reviews: verify product quality and seller reliability carefully.");
  if (commission <= 0) checks.push("Commission is missing or zero; verify the approved affiliate dashboard.");
  if (!inStock) checks.push("Marked out of stock; do not promote until availability is confirmed.");
  checks.push("Demand and competition are user-entered estimates, not live marketplace statistics.");
  checks.push("Verify current price, shipping, returns, product variants and affiliate eligibility before posting.");
  return {
    valid: true,
    candidate: {
      name, price, rating, reviews, commission, demand, competition, inStock, score,
      label: score >= 75 ? "Prioritize for review" : score >= 55 ? "Test with a small post" : "Research more first",
      estimatedCommission: Math.round(price * commission) / 100,
      checks
    }
  };
}

function createContentPack(input) {
  if (!input || typeof input !== "object") throw new TypeError("Content details are required.");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new TypeError("Product name is required.");
  const audience = (typeof input.audience === "string" && input.audience.trim()) || "people looking for practical value";
  const benefit = (typeof input.benefit === "string" && input.benefit.trim()) || "a useful everyday solution";
  const proof = (typeof input.proof === "string" && input.proof.trim()) || "Check the product page for full details";
  const price = typeof input.price === "string" ? input.price.trim() : "";
  const rawLink = typeof input.link === "string" ? input.link.trim() : "";
  let link = "";
  try {
    const parsedLink = new URL(rawLink);
    if (parsedLink.protocol === "https:" && parsedLink.hostname && !parsedLink.username && !parsedLink.password) link = parsedLink.href;
  } catch {
    link = "";
  }
  const platform = input.platform || "Instagram";
  const language = input.language || "Malayalam";
  const type = input.type || "Video";
  const safePrice = price ? "Price shown: ₹" + price + " (verify before posting)." : "Check the current price before buying.";
  const disclosure = "Affiliate disclosure: I may earn a commission from eligible purchases at no extra cost to you.";
  const linkLine = link || "[Add your approved affiliate link]";
  const malayalam = [
    disclosure,
    "✨ " + name,
    benefit + " — " + audience + "ക്കായി.",
    "🔎 " + proof,
    safePrice,
    "വാങ്ങുന്നതിന് മുമ്പ് വില, size/variant, delivery, return നിബന്ധനകൾ പരിശോധിക്കുക.",
    "ലിങ്ക്: " + linkLine
  ].join("\n\n");
  const english = [
    disclosure,
    "✨ " + name,
    benefit + " — worth a look if you are " + audience + ".",
    "🔎 " + proof,
    safePrice,
    "Check the current price, size/variant, delivery and return terms before buying.",
    "Link: " + linkLine
  ].join("\n\n");
  const post = language === "English" ? english : language === "Both" ? malayalam + "\n\n---\n\n" + english : malayalam;
  const hook = language === "English"
    ? "Need " + benefit.toLowerCase() + "? Take a quick look."
    : "ഇത് നിങ്ങൾക്ക് ഉപകാരപ്പെടുമോ? ഒന്ന് കണ്ടുനോക്കൂ!";
  const voice = language === "English"
    ? "Here is " + name + ". " + benefit + ". " + proof + ". Check the current price and details through the link."
    : name + ". " + benefit + ". " + proof + ". നിലവിലെ വിലയും വിവരങ്ങളും ലിങ്കിൽ പരിശോധിച്ച ശേഷം തീരുമാനിക്കൂ.";
  const video = [
    "SHORT VIDEO PLAN (20–25 seconds)",
    "0–8s — AFFILIATE DISCLOSURE: Show a clear, readable \"Affiliate\" label on-screen for at least 9 seconds in this 20–25 second video. Do not hide it among hashtags.",
    "0–2s — HOOK: " + hook,
    "2–6s — SHOW: Show the real product clearly; use your own footage or media you are authorised to use.",
    "6–12s — BENEFIT: Demonstrate " + benefit + " for " + audience + ". Do not claim features you cannot verify.",
    "12–17s — PROOF: Show only the verified detail: " + proof + ".",
    "17–25s — PRICE + CTA: " + safePrice + " Invite viewers to check the link for current availability; the affiliate label must already have been visible for at least 9 seconds.",
    "",
    "VOICE-OVER",
    voice,
    "",
    "ON-SCREEN TEXT",
    "Affiliate" + "\n" + hook + "\n" + benefit + "\nCheck current price • Link in bio/post",
    "",
    "CAPTION",
    post
  ].join("\n");
  return { post, video, platform, type, language, disclosure };
}

const api = { scoreCandidate, createContentPack };
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.AICommerceDiscovery = api;
