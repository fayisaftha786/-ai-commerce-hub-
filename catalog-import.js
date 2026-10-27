"use strict";

const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_CSV_ROWS = 5000;
const ALLOWED_PLATFORMS = new Set(["Meesho", "Amazon", "Flipkart", "Other"]);

function parseCsvRows(text) {
  const rows = [];
  let row = [], field = "", quoted = false, afterQuote = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') { quoted = false; afterQuote = true; }
      else field += ch;
      continue;
    }
    if (afterQuote) {
      if (ch === ",") { row.push(field); field = ""; afterQuote = false; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i += 1;
        row.push(field); field = ""; afterQuote = false;
        if (row.some((cell) => cell.trim() !== "")) rows.push(row);
        row = [];
      } else if (ch === " " || ch === "\t") {
        // Ignore harmless whitespace between a closing quote and delimiter.
      } else return { valid: false, error: "Unexpected character after a quoted CSV field." };
      continue;
    }
    if (ch === '"') {
      if (field.length !== 0) return { valid: false, error: "Unexpected quote inside an unquoted CSV field." };
      quoted = true;
    } else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (quoted) return { valid: false, error: "CSV has an unclosed quoted field." };
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return { valid: true, rows };
}

function calculateEvidenceAgeDays(checkedAt, now = new Date()) {
  const utils = typeof module !== "undefined" && module.exports
    ? require("./product-utils")
    : typeof window !== "undefined" ? window.AICommerceProductUtils : null;
  return typeof utils?.calculateCalendarDateAgeDays === "function"
    ? utils.calculateCalendarDateAgeDays(checkedAt, now)
    : null;
}

function rankCatalogCsv(csvText) {
  if (typeof csvText !== "string" || !csvText.trim()) return { valid: false, error: "Choose a non-empty CSV file." };
  if (new TextEncoder().encode(csvText).length > MAX_CSV_BYTES) return { valid: false, error: "CSV must be 2 MB or smaller." };
  const parsed = parseCsvRows(csvText.replace(/^\uFEFF/, ""));
  if (!parsed.valid) return parsed;
  if (parsed.rows.length < 2) return { valid: false, error: "CSV needs a header row and at least one product row." };
  const header = parsed.rows[0].map((cell) => cell.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const aliases = {
    product: "name", product_name: "name", title: "name", product_title: "name",
    product_url: "url", affiliate_link: "url", commission_percent: "commission",
    review_count: "reviews", order_count: "orders", sales: "orders",
    click_count: "clicks", days: "period_days", available: "stock"
  };
  const columns = header.map((key) => aliases[key] || key);
  if (new Set(columns).size !== columns.length) return { valid: false, error: "CSV contains duplicate column names after normalisation." };
  if (parsed.rows.length - 1 > MAX_CSV_ROWS) return { valid: false, error: "CSV may contain at most 5,000 product rows." };
  if (!columns.includes("name") || !columns.includes("price")) {
    return { valid: false, error: "CSV must include at least name (or product_name) and price columns." };
  }
  const records = [];
  const errors = [];
  const value = (cells, key) => {
    const index = columns.indexOf(key);
    return index < 0 ? "" : String(cells[index] ?? "").trim();
  };
  const numeric = (cells, key, options = {}) => {
    const raw = value(cells, key);
    if (raw === "") return options.optional ? null : options.defaultValue;
    let normalized = raw.replace(/[₹%\s]/g, "");
    if (normalized.includes(",")) {
      if (!/^\d{1,3}(,\d{3})*(\.\d+)?$/.test(normalized)) return NaN;
      normalized = normalized.replace(/,/g, "");
    }
    const parsedValue = Number(normalized);
    if (!Number.isFinite(parsedValue) || parsedValue < 0 || (options.max != null && parsedValue > options.max)) return NaN;
    return parsedValue;
  };
  for (let i = 1; i < parsed.rows.length; i += 1) {
    const cells = parsed.rows[i];
    if (cells.length !== columns.length) { errors.push("Row " + (i + 1) + ": expected " + columns.length + " columns but found " + cells.length + "."); continue; }
    const name = value(cells, "name");
    if (!name) { errors.push("Row " + (i + 1) + ": product name is missing."); continue; }
    if (name.length > 120) { errors.push("Row " + (i + 1) + ": product name is over 120 characters."); continue; }
    const price = numeric(cells, "price");
    const commission = numeric(cells, "commission", { defaultValue: 0, max: 100 });
    const rating = numeric(cells, "rating", { defaultValue: 0, max: 5 });
    const reviews = numeric(cells, "reviews", { defaultValue: 0 });
    const clicks = numeric(cells, "clicks", { defaultValue: null, optional: true });
    const orders = numeric(cells, "orders", { defaultValue: null, optional: true });
    const returns = numeric(cells, "returns", { defaultValue: null, optional: true });
    const periodDays = numeric(cells, "period_days", { defaultValue: null, optional: true });
    const countValues = [reviews, clicks, orders, returns, periodDays].filter((item) => item !== null);
    const countsAreWhole = countValues.every((item) => Number.isInteger(item));
    if (![price, commission, rating, reviews].every(Number.isFinite) || price <= 0 ||
        (clicks !== null && !Number.isFinite(clicks)) ||
        (orders !== null && !Number.isFinite(orders)) ||
        (returns !== null && !Number.isFinite(returns)) ||
        (periodDays !== null && (!Number.isFinite(periodDays) || periodDays <= 0)) || !countsAreWhole) {
      errors.push("Row " + (i + 1) + ": invalid price, commission, rating, review, click, order, return or period value.");
      continue;
    }
    const source = value(cells, "source").slice(0, 160);
    const checkedAt = value(cells, "checked_at");
    let evidenceAgeDays = null;
    let checkedAtValid = false;
    if (checkedAt && /^\d{4}-\d{2}-\d{2}$/.test(checkedAt)) {
      const parsedDate = new Date(checkedAt + "T00:00:00Z");
      checkedAtValid = Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === checkedAt;
      if (checkedAtValid) evidenceAgeDays = calculateEvidenceAgeDays(checkedAt);
    }
    const rawPlatform = value(cells, "platform");
    const platform = rawPlatform ? rawPlatform[0].toUpperCase() + rawPlatform.slice(1).toLowerCase() : "Other";
    if (!ALLOWED_PLATFORMS.has(platform)) {
      errors.push("Row " + (i + 1) + ": platform must be Meesho, Amazon, Flipkart or Other.");
      continue;
    }
    const rawUrl = value(cells, "url");
    let url = "";
    if (rawUrl) {
      try {
        const parsedUrl = new URL(rawUrl);
        if (rawUrl.length <= 2048 && parsedUrl.protocol === "https:" && parsedUrl.hostname && !parsedUrl.username && !parsedUrl.password) url = parsedUrl.href;
        else { errors.push("Row " + (i + 1) + ": non-HTTPS or unsafe URL was ignored."); }
      } catch { errors.push("Row " + (i + 1) + ": invalid URL was ignored."); }
    }
    const rawStock = value(cells, "stock").toLowerCase();
    const positiveStock = ["yes", "true", "1", "in stock", "available"];
    const negativeStock = ["no", "false", "0", "out", "out of stock", "unavailable"];
    const inStock = positiveStock.includes(rawStock) ? true : negativeStock.includes(rawStock) ? false : null;
    const hasOrders = orders !== null;
    const hasClicks = clicks !== null;
    const ordersPerDay = orders !== null && periodDays ? orders / periodDays : null;
    const clicksPerDay = clicks !== null && periodDays ? clicks / periodDays : null;
    // A 30-day equivalent makes different reporting windows more comparable;
    // it is a normalization, not a forecast of future sales.
    const normalizedOrders = orders === null ? null : periodDays ? ordersPerDay * 30 : orders;
    const salesPoints = normalizedOrders !== null ? Math.min(35, Math.log10(normalizedOrders + 1) * 12) : 0;
    const returnRate = returns !== null && orders !== null && orders > 0 ? returns / orders : null;
    const returnPenalty = returnRate === null ? 0 : Math.min(20, returnRate * 100);
    const conversionRate = hasOrders && hasClicks && clicks > 0 ? orders / clicks : null;
    const conversionPoints = conversionRate === null ? 0 : Math.min(20, conversionRate * 200);
    const ratingPoints = rating / 5 * 15;
    const reviewPoints = Math.min(10, Math.log10(reviews + 1) * 2.5);
    const commissionPoints = Math.min(10, commission * 1.25);
    const pricePoints = price >= 199 && price <= 1999 ? 5 : 3;
    const stockPoints = inStock === true ? 5 : 0;
    const score = Math.round(Math.max(0, Math.min(100, salesPoints + conversionPoints + ratingPoints + reviewPoints + commissionPoints + pricePoints + stockPoints - returnPenalty)));
    const hasPerformanceData = hasOrders || hasClicks;
    const warnings = [];
    if (!hasPerformanceData) warnings.push("No click/order data supplied; this is a catalogue-quality score, not a sales-demand ranking.");
    if (hasOrders && !hasClicks) warnings.push("Orders supplied without clicks; conversion rate cannot be calculated.");
    if (hasOrders && hasClicks && clicks === 0 && orders > 0) warnings.push("Orders are positive while clicks are zero; verify attribution windows and metric definitions.");
    if (hasOrders && hasClicks && clicks > 0 && orders > clicks) warnings.push("Orders exceed clicks; verify metric definitions and reporting windows before comparing conversion rates.");
    if (hasClicks && !hasOrders) warnings.push("Clicks supplied without orders; sales performance cannot be calculated.");
    if (hasOrders && orders === 0) warnings.push("No orders recorded in the supplied period; investigate before prioritising this product.");
    if (hasPerformanceData && !periodDays) warnings.push("Reporting period missing; click/order counts may not be comparable across products.");
    if (returns !== null && orders === null) warnings.push("Returns supplied without orders; return rate cannot be calculated.");
    if (returnRate !== null && returnRate >= 0.2) warnings.push("High supplied return rate (" + Math.round(returnRate * 100) + "%); investigate product quality and buyer expectations.");
    else if (returnRate !== null && returnRate >= 0.1) warnings.push("Elevated supplied return rate (" + Math.round(returnRate * 100) + "%); review recent return reasons.");
    if (returns !== null && orders !== null && returns > orders) warnings.push("Returns exceed orders; verify that these columns use the same reporting period.");
    if (inStock === false) warnings.push("Marked unavailable; do not promote until stock is confirmed.");
    if (inStock === null) warnings.push("Stock status missing or unrecognised; verify availability before promotion.");
    if (!url) warnings.push("No valid HTTPS product link supplied.");
    if (commission <= 0) warnings.push("Affiliate commission is missing or not confirmed; verify the rate and eligibility before promotion.");
    if (!source) warnings.push("Evidence source missing; record where the product data came from.");
    if (checkedAt && !checkedAtValid) warnings.push("Checked date is invalid; use YYYY-MM-DD.");
    if (!checkedAt) warnings.push("Checked date missing; freshness cannot be assessed.");
    else if (checkedAtValid && evidenceAgeDays < 0) warnings.push("Checked date is in the future; verify the date.");
    else if (checkedAtValid && evidenceAgeDays > 7) warnings.push("Evidence is over 7 days old; re-check price, stock and performance before promotion.");
    const evidenceFreshness = !checkedAtValid
      ? "unknown"
      : evidenceAgeDays < 0
        ? "future"
        : evidenceAgeDays > 7
          ? "stale"
          : "current";
    const evidenceTraceable = Boolean(source) && evidenceFreshness === "current";
    const conversionIsPlausible = hasOrders && hasClicks && clicks > 0 && orders <= clicks;
    const evidenceQuality = !hasPerformanceData
      ? "Unverified"
      : conversionIsPlausible && periodDays
        ? "Complete"
        : conversionIsPlausible
          ? "Partial"
          : "Limited";
    const metricConflict = (hasOrders && hasClicks && clicks === 0 && orders > 0) ||
      (hasOrders && hasClicks && clicks > 0 && orders > clicks) ||
      (returns !== null && orders !== null && returns > orders);
    let promotionReadiness = "Verify before promotion";
    if (inStock === false || metricConflict || (returnRate !== null && returnRate >= 0.2)) {
      promotionReadiness = "Do not promote yet";
    } else if (!evidenceTraceable) {
      // Strong performance numbers cannot compensate for missing provenance or stale data.
      promotionReadiness = "Verify before promotion";
    } else if (!url || commission <= 0) {
      // A high score does not make a product promotable without a usable link and commission rate.
      promotionReadiness = "Verify before promotion";
    } else if (evidenceQuality !== "Complete" || orders === null || orders === 0 ||
        inStock !== true || (returnRate !== null && returnRate >= 0.1)) {
      promotionReadiness = "Test cautiously";
    } else {
      promotionReadiness = "Shortlist for a small test";
    }
    const recommendationReasons = [];
    if (inStock === false) recommendationReasons.push("Stock is marked unavailable.");
    if (metricConflict) recommendationReasons.push("Supplied click, order or return counts conflict; verify the report.");
    if (!url) recommendationReasons.push("No valid HTTPS product/affiliate link is supplied; verify the approved link before promotion.");
    if (commission <= 0) recommendationReasons.push("Affiliate commission is missing or not confirmed; verify programme eligibility and rate.");
    if (!source) recommendationReasons.push("Evidence source is missing; record the dashboard, listing or report used.");
    if (!checkedAt) recommendationReasons.push("Evidence check date is missing; freshness cannot be assessed.");
    else if (!checkedAtValid) recommendationReasons.push("Evidence check date is invalid; use YYYY-MM-DD.");
    else if (evidenceAgeDays < 0) recommendationReasons.push("Evidence check date is in the future; verify it.");
    else if (evidenceAgeDays > 7) recommendationReasons.push("Evidence is stale; re-check price, stock and performance before promotion.");
    if (evidenceFreshness === "current" && source) recommendationReasons.push("Evidence source is recorded and the check date is within 7 days.");
    if (evidenceQuality === "Complete") recommendationReasons.push("Clicks, orders and reporting period support a comparable performance check.");
    else if (evidenceQuality === "Partial") recommendationReasons.push("Performance metrics are supplied, but the reporting period is missing.");
    else if (evidenceQuality === "Unverified") recommendationReasons.push("No click/order evidence was supplied; ranking relies on catalogue details.");
    else recommendationReasons.push("Performance evidence is incomplete or needs verification.");
    if (returnRate !== null && returnRate >= 0.1) recommendationReasons.push("Return rate is elevated and should be investigated.");
    if (inStock === null) recommendationReasons.push("Stock status needs confirmation.");
    if (commission > 0) recommendationReasons.push("Estimated commission is based on the entered rate, not a guaranteed payout.");
    const nextAction = promotionReadiness === "Do not promote yet"
      ? "Resolve stock, metric or return concerns before publishing."
      : promotionReadiness === "Test cautiously"
        ? "Verify missing details, then run a small measured test."
        : promotionReadiness === "Shortlist for a small test"
          ? "Run a small test and compare results over a consistent reporting period."
          : "Verify product details and fill the missing evidence before promotion.";
    const estimatedCommissionPerOrder = price * commission / 100;
    const estimatedCommissionAfterReturns = returnRate !== null && returns <= orders
      ? estimatedCommissionPerOrder * (1 - returnRate) : null;
    records.push({
      name, platform, url, price, commission, rating, reviews, clicks, orders, returns,
      source, checkedAt: checkedAtValid ? checkedAt : "", evidenceAgeDays,
      evidenceFreshness, evidenceTraceable,
      periodDays, inStock, score, normalizedOrders,
      estimatedCommissionPerOrder, estimatedCommissionAfterReturns,
      evidenceLabel: hasOrders ? "Orders supplied" : hasClicks ? "Clicks supplied" : "No sales evidence",
      evidenceQuality, promotionReadiness, recommendationReasons, nextAction, ordersPerDay, clicksPerDay,
      conversionRate, returnRate,
      warnings,
      rowNumber: i + 1
    });
  }
  if (!records.length) return { valid: false, error: "No valid product rows found.", errors };

  // Detect repeated listing URLs while preserving rows: different seller/offer rows may be
  // meaningful, so warn rather than silently deleting or merging data.
  const seenProductUrls = new Map();
  const trackingParameters = /^(?:utm_[a-z0-9_]+|tag|ref|ref_[a-z0-9_-]*|ascsubtag|linkcode|psc|pd_rd_[a-z0-9_]+|pf_rd_[a-z0-9_]+|mibextid|fbclid|gclid)$/i;
  for (const record of records) {
    if (!record.url) continue;
    let identity;
    try {
      const parsedUrl = new URL(record.url);
      parsedUrl.hash = "";
      for (const key of [...parsedUrl.searchParams.keys()]) {
        if (trackingParameters.test(key)) parsedUrl.searchParams.delete(key);
      }
      parsedUrl.searchParams.sort();
      if (parsedUrl.pathname.length > 1) parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, "");
      identity = parsedUrl.href;
    } catch {
      continue;
    }
    if (seenProductUrls.has(identity)) {
      record.duplicateOfRowNumber = seenProductUrls.get(identity);
      record.warnings.push("Possible duplicate product URL after removing common tracking parameters; compare with row " +
        record.duplicateOfRowNumber + " before ranking both entries separately.");
      record.recommendationReasons.push("Product URL matches row " + record.duplicateOfRowNumber +
        " after tracking parameters are removed; confirm whether these are the same listing or distinct offers.");
    } else {
      seenProductUrls.set(identity, record.rowNumber);
      record.duplicateOfRowNumber = null;
    }
  }

  // Flag repeated product names after trimming and Unicode-aware case folding. Keep all
  // rows because identical names can represent different sellers, variants or offers.
  const seenProductNames = new Map();
  for (const record of records) {
    const nameIdentity = record.name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
    if (seenProductNames.has(nameIdentity)) {
      const firstRow = seenProductNames.get(nameIdentity);
      record.duplicateNameOfRowNumber = firstRow;
      record.warnings.push("Possible duplicate product name; compare with row " + firstRow +
        " before treating these as separate products.");
      record.recommendationReasons.push("Product name matches row " + firstRow +
        " after normalisation; verify whether this is a duplicate, variant or separate seller offer.");
    } else {
      seenProductNames.set(nameIdentity, record.rowNumber);
      record.duplicateNameOfRowNumber = null;
    }
  }

  // Readiness is a safety gate: a high heuristic score must not put conflicted or unavailable
  // products above candidates whose supplied evidence supports a cautious test.
  const readinessPriority = {
    "Shortlist for a small test": 0,
    "Test cautiously": 1,
    "Verify before promotion": 2,
    "Do not promote yet": 3
  };
  const freshnessPriority = { current: 0, unknown: 1, stale: 2, future: 3 };
  // Prefer actual performance evidence over catalogue-only scores within the same
  // readiness and freshness tier. Ratings/reviews alone must not masquerade as demand.
  const evidenceQualityPriority = { Complete: 0, Partial: 1, Limited: 2, Unverified: 3 };
  records.sort((a, b) =>
    (readinessPriority[a.promotionReadiness] ?? 2) - (readinessPriority[b.promotionReadiness] ?? 2) ||
    (freshnessPriority[a.evidenceFreshness] ?? 1) - (freshnessPriority[b.evidenceFreshness] ?? 1) ||
    (evidenceQualityPriority[a.evidenceQuality] ?? 2) - (evidenceQualityPriority[b.evidenceQuality] ?? 2) ||
    b.score - a.score ||
    (b.orders ?? -1) - (a.orders ?? -1)
  );
  return { valid: true, records, errors, importedRows: records.length, totalRows: parsed.rows.length - 1 };
}

function catalogRecordsToCsv(records) {
  if (!Array.isArray(records) || records.length === 0) return "";
  const columns = [
    ["rank", (record, index) => index + 1],
    ["row_number", (record) => record.rowNumber],
    ["product_name", (record) => record.name],
    ["platform", (record) => record.platform],
    ["product_url", (record) => record.url],
    ["price", (record) => record.price],
    ["commission_percent", (record) => record.commission],
    ["rating", (record) => record.rating],
    ["review_count", (record) => record.reviews],
    ["clicks", (record) => record.clicks],
    ["orders", (record) => record.orders],
    ["returns", (record) => record.returns],
    ["reporting_period_days", (record) => record.periodDays],
    ["stock", (record) => record.inStock === null ? "" : record.inStock ? "yes" : "no"],
    ["source", (record) => record.source],
    ["checked_at", (record) => record.checkedAt],
    ["evidence_freshness", (record) => record.evidenceFreshness],
    ["evidence_quality", (record) => record.evidenceQuality],
    ["score_out_of_100", (record) => record.score],
    ["orders_per_day", (record) => record.ordersPerDay],
    ["clicks_per_day", (record) => record.clicksPerDay],
    ["conversion_percent", (record) => record.conversionRate == null ? "" : Math.round(record.conversionRate * 10000) / 100],
    ["return_rate_percent", (record) => record.returnRate == null ? "" : Math.round(record.returnRate * 10000) / 100],
    ["estimated_commission_per_order", (record) => record.estimatedCommissionPerOrder],
    ["estimated_commission_after_returns", (record) => record.estimatedCommissionAfterReturns],
    ["promotion_readiness", (record) => record.promotionReadiness],
    ["possible_duplicate_of_row", (record) => record.duplicateOfRowNumber],
    ["possible_duplicate_name_of_row", (record) => record.duplicateNameOfRowNumber],
    ["next_action", (record) => record.nextAction],
    ["recommendation_reasons", (record) => (record.recommendationReasons || []).join(" | ")],
    ["warnings", (record) => (record.warnings || []).join(" | ")]
  ];
  const cell = (value) => {
    if (value === null || value === undefined) return '""';
    let text = String(value);
    // Neutralize spreadsheet formula starters in untrusted text fields.
    if (typeof value === "string" && /^[\u0000-\u0020]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const lines = [columns.map(([name]) => cell(name)).join(",")];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] || {};
    lines.push(columns.map(([, getValue]) => cell(getValue(record, index))).join(","));
  }
  // UTF-8 BOM helps spreadsheet apps (especially Excel) detect Malayalam and other Unicode text.
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

const api = { rankCatalogCsv, catalogRecordsToCsv, calculateEvidenceAgeDays };
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.AICommerceCatalogImport = api;
