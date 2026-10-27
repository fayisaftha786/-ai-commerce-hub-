"use strict";

function calculateManualCandidateAgeDays(checkedAt) {
  const utils = typeof module !== "undefined" && module.exports
    ? require("./product-utils")
    : typeof window !== "undefined" ? window.AICommerceProductUtils : null;
  return typeof utils?.calculateCalendarDateAgeDays === "function"
    ? utils.calculateCalendarDateAgeDays(checkedAt)
    : null;
}

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
  const hasStockStatus = input.inStock === true || input.inStock === false;
  const inStock = input.inStock === true ? true : input.inStock === false ? false : null;
  const rawUrl = typeof input.url === "string" ? input.url.trim() : "";
  let url = "";
  if (rawUrl && rawUrl.length <= 2048) {
    try {
      const parsedUrl = new URL(rawUrl);
      if (parsedUrl.protocol === "https:" && parsedUrl.hostname && !parsedUrl.username && !parsedUrl.password) {
        url = parsedUrl.href;
      }
    } catch {
      url = "";
    }
  }
  const source = typeof input.source === "string" ? input.source.trim().slice(0, 160) : "";
  const checkedAt = typeof input.checkedAt === "string" ? input.checkedAt.trim() : "";
  const evidenceAgeDays = calculateManualCandidateAgeDays(checkedAt);
  const evidenceFreshness = evidenceAgeDays === null
    ? "unknown"
    : evidenceAgeDays < 0
      ? "future"
      : evidenceAgeDays > 7
        ? "stale"
        : "current";
  const evidenceTraceable = Boolean(url) && Boolean(source) && evidenceFreshness === "current";
  if (!Number.isFinite(price) || price <= 0) return { valid: false, error: "Enter a valid product price greater than zero." };
  if (!Number.isFinite(rating) || rating < 0 || rating > 5) return { valid: false, error: "Rating must be from 0 to 5." };
  if (!Number.isFinite(reviews) || reviews < 0 || reviews > 100000000) return { valid: false, error: "Review count must be a non-negative number." };
  if (!Number.isFinite(commission) || commission < 0 || commission > 100) return { valid: false, error: "Commission must be from 0 to 100 percent." };
  if (!Number.isInteger(demand) || demand < 1 || demand > 5) return { valid: false, error: "Demand signal must be from 1 to 5." };
  if (!Number.isInteger(competition) || competition < 1 || competition > 5) return { valid: false, error: "Competition must be from 1 to 5." };

  // A transparent shortlist score based only on the user's entered evidence.
  // Empty fields are unknown, not evidence of poor performance or a zero commission.
  const hasRating = input.rating !== "" && input.rating != null;
  const hasReviews = input.reviews !== "" && input.reviews != null;
  const hasCommission = input.commission !== "" && input.commission != null;
  const hasDemand = input.demand !== "" && input.demand != null;
  const hasCompetition = input.competition !== "" && input.competition != null;
  const demandPoints = hasDemand ? (demand - 1) * 7.5 : 0; // max 30
  const ratingPoints = hasRating ? (rating / 5) * 15 : 0;
  const reviewPoints = hasReviews ? Math.min(15, Math.log10(reviews + 1) * 3.75) : 0;
  const commissionPoints = hasCommission ? Math.min(15, commission / 2) : 0;
  const pricePoints = price >= 199 && price <= 1999 ? 10 : price < 199 || price <= 3999 ? 6 : 3;
  const competitionPoints = hasCompetition ? (5 - competition) * 3 : 0; // max 12
  const stockPoints = inStock === true ? 3 : 0;
  const hasUrl = Boolean(url);
  const hasSource = Boolean(source);
  const evidenceFields = [
    true, hasRating, hasReviews, hasCommission && commission > 0,
    hasDemand, hasCompetition, hasStockStatus, hasUrl, hasSource,
    evidenceFreshness === "current"
  ];
  const evidenceCount = evidenceFields.filter(Boolean).length;
  const evidenceCoverage = Math.round((evidenceCount / evidenceFields.length) * 100);
  const confidence = evidenceCoverage === 100 ? "High" : evidenceCoverage >= 70 ? "Medium" : "Low";
  const score = Math.round(Math.max(0, Math.min(100,
    demandPoints + ratingPoints + reviewPoints + commissionPoints + pricePoints + competitionPoints + stockPoints
  )));
  const checks = [];
  if (!hasRating) checks.push("Missing rating: enter the current product/seller rating before comparing candidates.");
  if (!hasReviews) checks.push("Missing review count: check how many reviews support the rating.");
  if (!hasCommission || commission <= 0) checks.push("Commission is missing or zero; verify the approved affiliate dashboard before prioritising this product.");
  if (!hasDemand) checks.push("Missing demand signal: review recent search suggestions, audience questions or marketplace activity.");
  if (!hasCompetition) checks.push("Missing competition estimate: compare similar listings and competing posts.");
  if (!hasUrl) checks.push("Missing valid HTTPS product/affiliate link; verify the approved link before promotion.");
  if (!hasSource) checks.push("Evidence source is missing; record the listing or dashboard used.");
  if (!checkedAt) checks.push("Date checked is missing; enter the date you last verified the evidence.");
  else if (evidenceAgeDays === null) checks.push("Date checked is invalid; use a real date in YYYY-MM-DD format.");
  else if (evidenceAgeDays < 0) checks.push("Date checked is in the future; correct it before promotion.");
  else if (evidenceAgeDays > 7) checks.push("Evidence is over 7 days old; re-check price, stock and commission before promotion.");
  if (evidenceFreshness === "current" && source && url) checks.push("Evidence source/date are recorded; this does not independently verify the source or data.");
  if (demand <= 2 && hasDemand) checks.push("Demand evidence is weak; check search suggestions, social comments or recent marketplace activity.");
  if (hasRating && rating < 4) checks.push("Rating is below 4/5; read recent negative reviews before recommending.");
  if (hasReviews && reviews < 30) checks.push("Few reviews: verify product quality and seller reliability carefully.");
  if (inStock === false) checks.push("Marked out of stock; do not promote until availability is confirmed.");
  else if (inStock === null) checks.push("Stock status is not checked; verify current availability.");
  checks.push("Demand and competition are user-entered estimates, not live marketplace statistics.");
  checks.push("Verify current price, shipping, returns, product variants and affiliate eligibility before posting.");
  return {
    valid: true,
    candidate: {
      name, price, rating: hasRating ? rating : null, reviews: hasReviews ? reviews : null, commission: hasCommission ? commission : null, demand: hasDemand ? demand : null, competition: hasCompetition ? competition : null, inStock, stockKnown: hasStockStatus, url, source, checkedAt: evidenceAgeDays !== null ? checkedAt : "", evidenceAgeDays, evidenceFreshness, evidenceTraceable, score,
      evidenceCount, evidenceTotal: evidenceFields.length, evidenceCoverage, confidence,
      label: inStock === false
        ? "Do not promote — out of stock"
        : !hasRating || !hasReviews || !hasCommission || commission <= 0 || !hasDemand || !hasCompetition ||
          !hasStockStatus || !hasUrl || !hasSource || evidenceFreshness !== "current"
          ? "Need more evidence"
          : score >= 75 ? "Prioritize for review" : score >= 55 ? "Test with a small post" : "Research more first",
      estimatedCommission: hasCommission && commission > 0 ? Math.round(price * commission) / 100 : null,
      checks
    }
  };
}

function createContentPack(input) {
  if (!input || typeof input !== "object") throw new TypeError("Content details are required.");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new TypeError("Product name is required.");
  const audience = (typeof input.audience === "string" && input.audience.trim()) || "people looking for practical value";
  const benefit = typeof input.benefit === "string" ? input.benefit.trim() : "";
  const benefitProvided = Boolean(benefit);
  const safeBenefitLine = language => language === "English"
    ? (benefitProvided ? benefit + " — worth a look if you are " + audience + "." : "Review the listed details to decide whether " + name + " fits your needs.")
    : (benefitProvided ? benefit + " — " + audience + "ക്കായി." : name + " നിങ്ങളുടെ ആവശ്യത്തിന് അനുയോജ്യമാണോ എന്ന് അറിയാൻ ലിസ്റ്റിലെ വിവരങ്ങൾ പരിശോധിക്കൂ.");
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
    safeBenefitLine("Malayalam"),
    "🔎 " + proof,
    safePrice,
    "വാങ്ങുന്നതിന് മുമ്പ് വില, size/variant, delivery, return നിബന്ധനകൾ പരിശോധിക്കുക.",
    "ലിങ്ക്: " + linkLine
  ].join("\n\n");
  const english = [
    disclosure,
    "✨ " + name,
    safeBenefitLine("English"),
    "🔎 " + proof,
    safePrice,
    "Check the current price, size/variant, delivery and return terms before buying.",
    "Link: " + linkLine
  ].join("\n\n");
  const post = language === "English" ? english : language === "Both" ? malayalam + "\n\n---\n\n" + english : malayalam;
  const hooks = language === "English"
    ? [
        benefitProvided ? "Need " + benefit.toLowerCase() + "? Take a quick look." : "Before you decide, review the listed details for " + name + ".",
        benefitProvided ? "Looking for " + benefit.toLowerCase() + "? Check these details first." : "Check the listed features and terms before choosing " + name + ".",
        "Before you decide, see whether " + name + " fits your needs."
      ]
    : [
        "ഇത് നിങ്ങൾക്ക് ഉപകാരപ്പെടുമോ? ഒന്ന് കണ്ടുനോക്കൂ!",
        benefitProvided ? benefit + " തേടുന്നുണ്ടോ? ആദ്യം വിവരങ്ങൾ പരിശോധിക്കൂ." : name + " തിരഞ്ഞെടുക്കുന്നതിന് മുമ്പ് ലിസ്റ്റിലെ വിവരങ്ങൾ പരിശോധിക്കൂ.",
        "വാങ്ങുന്നതിന് മുമ്പ് " + name + " നിങ്ങളുടെ ആവശ്യത്തിന് അനുയോജ്യമാണോ എന്ന് നോക്കൂ."
      ];
  const ctas = language === "English"
    ? [
        "Check the current price and details using the link.",
        "Save this for later and compare the details before buying.",
        "Share this with someone who may find it useful."
      ]
    : [
        "നിലവിലെ വിലയും വിവരങ്ങളും ലിങ്കിൽ പരിശോധിക്കൂ.",
        "പിന്നീട് നോക്കാൻ സേവ് ചെയ്യൂ; വാങ്ങുന്നതിന് മുമ്പ് വിവരങ്ങൾ താരതമ്യം ചെയ്യൂ.",
        "ഉപകാരപ്പെടുമെന്ന് തോന്നുന്ന ഒരാളുമായി പങ്കുവെക്കൂ."
      ];
  const hook = hooks[0];
  const voice = language === "English"
    ? "Here is " + name + ". " + (benefitProvided ? benefit + ". " : "Review the listed details to decide whether it fits your needs. ") + proof + ". Check the current price and details through the link."
    : name + ". " + (benefitProvided ? benefit + ". " : "നിങ്ങളുടെ ആവശ്യത്തിന് അനുയോജ്യമാണോ എന്ന് ലിസ്റ്റിലെ വിവരങ്ങൾ പരിശോധിക്കൂ. ") + proof + ". നിലവിലെ വിലയും വിവരങ്ങളും ലിങ്കിൽ പരിശോധിച്ച ശേഷം തീരുമാനിക്കൂ.";
  const video = [
    "SHORT VIDEO PLAN (20–25 seconds)",
    "0–9s — AFFILIATE DISCLOSURE: Show a clear, readable \"Affiliate\" label on-screen for at least 9 seconds in this 20–25 second video. Do not hide it among hashtags.",
    "0–2s — HOOK: " + hook,
    "2–6s — SHOW: Show the real product clearly; use your own footage or media you are authorised to use.",
    benefitProvided
      ? "6–12s — BENEFIT: Demonstrate " + benefit + " for " + audience + ". Do not claim features you cannot verify."
      : "6–12s — DETAILS: Show only real product details supported by the listing. Do not invent benefits or performance claims.",
    "12–17s — PROOF: Show only the verified detail: " + proof + ".",
    "17–25s — PRICE + CTA: " + safePrice + " Invite viewers to check the link for current availability; the affiliate label must already have been visible for at least 9 seconds.",
    "",
    "VOICE-OVER",
    voice,
    "",
    "ON-SCREEN TEXT",
    "Affiliate" + "\n" + hook + "\n" + (benefitProvided ? benefit : "Check listed details before deciding") + "\nCheck current price • Link in bio/post",
    "",
    "CAPTION",
    post
  ].join("\n");
  return { post, video, platform, type, language, disclosure, hooks, ctas };
}

function createBulkContentPacks(rows, options = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new TypeError("Add at least one product row.");
  }
  if (rows.length > 50) throw new RangeError("Bulk content supports up to 50 products per batch.");
  const packs = rows.map((row, index) => {
    if (!row || typeof row !== "object") throw new TypeError("Product row " + (index + 1) + " is invalid.");
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const benefit = typeof row.benefit === "string" ? row.benefit.trim() : "";
    if (!name || !benefit) throw new TypeError("Product row " + (index + 1) + " needs both a product name and a verified practical benefit.");
    return {
      name,
      pack: createContentPack({
        ...options,
        name,
        benefit,
        audience: typeof row.audience === "string" ? row.audience.trim() : "",
        proof: typeof row.proof === "string" ? row.proof.trim() : "",
        price: typeof row.price === "string" || typeof row.price === "number" ? String(row.price).trim() : "",
        link: typeof row.link === "string" ? row.link.trim() : ""
      })
    };
  });
  return packs;
}

function compareCandidatesByReadiness(a, b) {
  const readinessRank = (candidate) => {
    if (candidate?.inStock === false) return 3;
    const ageDays = calculateManualCandidateAgeDays(candidate?.checkedAt);
    const evidenceIsCurrent = ageDays !== null && ageDays >= 0 && ageDays <= 7;
    if (!candidate?.label || candidate.label === "Need more evidence" ||
        candidate?.evidenceTraceable !== true || !candidate?.url ||
        !(Number(candidate?.commission) > 0) || candidate?.inStock !== true ||
        !candidate?.source || !evidenceIsCurrent) return 2;
    if (candidate.label === "Research more first") return 1;
    return 0;
  };
  return readinessRank(a) - readinessRank(b) || Number(b?.score || 0) - Number(a?.score || 0);
}

const api = { scoreCandidate, createContentPack, createBulkContentPacks, compareCandidatesByReadiness };
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.AICommerceDiscovery = api;
