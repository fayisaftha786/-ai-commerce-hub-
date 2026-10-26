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
    const salesPoints = hasOrders ? Math.min(35, Math.log10(orders + 1) * 12) : 0;
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
    const conversionIsPlausible = hasOrders && hasClicks && clicks > 0 && orders <= clicks;
    const evidenceQuality = !hasPerformanceData
      ? "Unverified"
      : conversionIsPlausible && periodDays
        ? "Complete"
        : conversionIsPlausible
          ? "Partial"
          : "Limited";
    const ordersPerDay = orders !== null && periodDays ? orders / periodDays : null;
    const clicksPerDay = clicks !== null && periodDays ? clicks / periodDays : null;
    records.push({
      name, platform, url, price, commission, rating, reviews, clicks, orders, returns,
      periodDays, inStock, score,
      evidenceLabel: hasOrders ? "Orders supplied" : hasClicks ? "Clicks supplied" : "No sales evidence",
      evidenceQuality, ordersPerDay, clicksPerDay,
      conversionRate, returnRate,
      warnings,
      rowNumber: i + 1
    });
  }
  if (!records.length) return { valid: false, error: "No valid product rows found.", errors };
  records.sort((a, b) => b.score - a.score || (b.orders ?? -1) - (a.orders ?? -1));
  return { valid: true, records, errors, importedRows: records.length, totalRows: parsed.rows.length - 1 };
}

const api = { rankCatalogCsv };
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.AICommerceCatalogImport = api;
