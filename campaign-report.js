"use strict";

const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const MAX_REPORT_ROWS = 5000;

function parseRows(text) {
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
        if (row.some((v) => v.trim())) rows.push(row);
        row = [];
      } else if (ch !== " " && ch !== "\t") return { valid: false, error: "Unexpected character after a quoted CSV field." };
      continue;
    }
    if (ch === '"') {
      if (field.length) return { valid: false, error: "Unexpected quote inside an unquoted CSV field." };
      quoted = true;
    } else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (quoted) return { valid: false, error: "CSV has an unclosed quoted field." };
  row.push(field);
  if (row.some((v) => v.trim())) rows.push(row);
  return { valid: true, rows };
}

function parseCampaignReport(csvText, savedCampaigns = []) {
  if (typeof csvText !== "string" || !csvText.trim()) return { valid: false, error: "Choose a non-empty performance CSV." };
  if (new TextEncoder().encode(csvText).length > MAX_REPORT_BYTES) return { valid: false, error: "Performance CSV must be 2 MB or smaller." };
  const parsed = parseRows(csvText.replace(/^\uFEFF/, ""));
  if (!parsed.valid) return parsed;
  if (parsed.rows.length < 2) return { valid: false, error: "CSV needs a header row and at least one data row." };
  if (parsed.rows.length - 1 > MAX_REPORT_ROWS) return { valid: false, error: "CSV may contain at most 5,000 rows." };

  const aliases = {
    campaign: "campaign_id", sub_id: "campaign_id", subid: "campaign_id", tracking_id: "campaign_id",
    date_from: "period_start", start_date: "period_start", date_to: "period_end", end_date: "period_end",
    click_count: "clicks", order_count: "orders", commission_amount: "commission",
    earnings: "commission", return_count: "returns"
  };
  const columns = parsed.rows[0].map((v) => {
    const key = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
    return aliases[key] || key;
  });
  if (new Set(columns).size !== columns.length) return { valid: false, error: "CSV contains duplicate column names after normalisation." };
  const required = ["campaign_id", "period_start", "period_end", "clicks", "orders"];
  if (!required.every((key) => columns.includes(key))) {
    return { valid: false, error: "CSV must include campaign_id (or sub_id), period_start, period_end, clicks and orders. Commission and returns are optional." };
  }
  const value = (cells, key) => {
    const index = columns.indexOf(key);
    return index < 0 ? "" : String(cells[index] ?? "").trim();
  };
  const integer = (raw) => {
    if (!/^(0|[1-9]\d*)$/.test(raw)) return null;
    const number = Number(raw);
    return Number.isSafeInteger(number) ? number : null;
  };
  const money = (raw) => {
    if (!raw) return null;
    const cleaned = raw.replace(/[₹\s]/g, "");
    const normal = cleaned.includes(",")
      ? (/^\d{1,3}(,\d{3})*(\.\d{1,2})?$/.test(cleaned) ? cleaned.replace(/,/g, "") : "")
      : cleaned;
    if (!normal || !/^\d+(\.\d{1,2})?$/.test(normal)) return NaN;
    const n = Number(normal);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  const validDate = (raw) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
    const date = new Date(raw + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw;
  };

  const groups = new Map();
  const errors = [];
  const seenRows = new Set();
  let duplicateRows = 0;
  for (let i = 1; i < parsed.rows.length; i += 1) {
    const cells = parsed.rows[i];
    if (cells.length !== columns.length) { errors.push("Row " + (i + 1) + ": wrong number of columns; skipped."); continue; }
    const rowSignature = JSON.stringify(cells.map((cell) => String(cell).trim()));
    if (seenRows.has(rowSignature)) {
      duplicateRows += 1;
      errors.push("Row " + (i + 1) + ": exact duplicate of an earlier row; skipped to avoid double-counting.");
      continue;
    }
    seenRows.add(rowSignature);
    const campaignId = value(cells, "campaign_id");
    const start = value(cells, "period_start");
    const end = value(cells, "period_end");
    const clicks = integer(value(cells, "clicks"));
    const orders = integer(value(cells, "orders"));
    const commissionRaw = value(cells, "commission");
    const returnsRaw = value(cells, "returns");
    const commission = commissionRaw === "" ? null : money(commissionRaw);
    const returns = returnsRaw === "" ? null : integer(returnsRaw);
    if (!campaignId || campaignId.length > 200 || !validDate(start) || !validDate(end) || start > end ||
        clicks === null || orders === null || (commission !== null && !Number.isFinite(commission)) ||
        (returnsRaw !== "" && returns === null)) {
      errors.push("Row " + (i + 1) + ": invalid campaign ID, date range, click/order count, commission or return count; skipped.");
      continue;
    }
    const key = JSON.stringify([campaignId, start, end]);
    if (!groups.has(key)) groups.set(key, { campaignId, periodStart: start, periodEnd: end, clicks: 0, orders: 0, returns: null, commission: null, rows: 0, commissionRows: 0, returnRows: 0, warnings: [] });
    const group = groups.get(key);
    group.clicks += clicks;
    group.orders += orders;
    group.rows += 1;
    if (returns !== null) { group.returns = (group.returns ?? 0) + returns; group.returnRows += 1; }
    if (commission !== null) { group.commission = (group.commission ?? 0) + commission; group.commissionRows += 1; }
  }
  if (!groups.size) return { valid: false, error: "No valid campaign performance rows found.", errors };

  const knownIds = new Set((Array.isArray(savedCampaigns) ? savedCampaigns : []).filter((item) => item && typeof item.id === "string").map((item) => item.id));
  const reports = [...groups.values()].map((group) => {
    const matched = knownIds.has(group.campaignId);
    if (group.commissionRows !== group.rows) group.commission = null;
    if (group.returnRows !== group.rows) group.returns = null;
    if (!Number.isSafeInteger(group.clicks) || !Number.isSafeInteger(group.orders) ||
        (group.returns !== null && !Number.isSafeInteger(group.returns))) group.warnings.push("Aggregated count exceeds safe numeric precision; verify source rows.");
    if (!matched) group.warnings.push("Attribution unavailable: this campaign ID does not match a saved campaign in this browser.");
    if (group.clicks === 0 && group.orders > 0) group.warnings.push("Orders are positive but clicks are zero; verify the source report.");
    if (group.clicks > 0 && group.orders > group.clicks) group.warnings.push("Orders exceed clicks; conversion rate is not shown until metrics are verified.");
    if (group.returns !== null && group.returns > group.orders) group.warnings.push("Returns exceed orders; confirm the source report's date windows.");
    const conversionRate = group.clicks > 0 && group.orders <= group.clicks ? group.orders / group.clicks : null;
    const returnRate = group.returns !== null && group.orders > 0 && group.returns <= group.orders ? group.returns / group.orders : null;
    return { ...group, matched, conversionRate, returnRate };
  }).sort((a, b) => a.periodStart.localeCompare(b.periodStart) || a.campaignId.localeCompare(b.campaignId));
  const byCampaign = new Map();
  for (const report of reports) {
    if (!byCampaign.has(report.campaignId)) byCampaign.set(report.campaignId, []);
    byCampaign.get(report.campaignId).push(report);
  }
  for (const periods of byCampaign.values()) {
    periods.sort((a, b) => a.periodStart.localeCompare(b.periodStart) || a.periodEnd.localeCompare(b.periodEnd));
    for (let i = 1; i < periods.length; i += 1) {
      if (periods[i].periodStart <= periods[i - 1].periodEnd) {
        periods[i - 1].warnings.push("Reporting periods overlap for this campaign; do not compare or add these periods without checking the source.");
        periods[i].warnings.push("Reporting periods overlap for this campaign; do not compare or add these periods without checking the source.");
      }
    }
  }
  return {
    valid: true, reports, errors, duplicateRows,
    importedRows: reports.reduce((sum, item) => sum + item.rows, 0),
    totalRows: parsed.rows.length - 1,
    dataQuality: {
      status: errors.length || reports.some((item) => item.warnings.length) ? "review" : "clean",
      validRows: reports.reduce((sum, item) => sum + item.rows, 0),
      skippedRows: errors.length,
      duplicateRows,
      warningCount: reports.reduce((sum, item) => sum + item.warnings.length, 0)
    }
  };
}

function compareCampaignReports(reports) {
  if (!Array.isArray(reports)) return [];
  const groups = new Map();
  for (const report of reports) {
    if (!report || report.matched !== true ||
        typeof report.periodStart !== "string" || typeof report.periodEnd !== "string" ||
        typeof report.campaignId !== "string") continue;
    const key = JSON.stringify([report.periodStart, report.periodEnd]);
    if (!groups.has(key)) groups.set(key, { periodStart: report.periodStart, periodEnd: report.periodEnd, campaigns: [] });
    groups.get(key).campaigns.push(report);
  }
  return [...groups.values()]
    .filter((group) => group.campaigns.length >= 2)
    .map((group) => ({
      ...group,
      campaigns: group.campaigns.slice().sort((a, b) => a.campaignId.localeCompare(b.campaignId))
    }))
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart) || a.periodEnd.localeCompare(b.periodEnd));
}

function summarizeCampaignComparison(group) {
  if (!group || !Array.isArray(group.campaigns) || group.campaigns.length < 2) return [];
  const campaigns = group.campaigns;
  const observations = [];
  const conversion = campaigns.filter((item) =>
    Number.isFinite(item.conversionRate) && item.clicks > 0 &&
    Number.isFinite(item.orders) && item.orders <= item.clicks
  );
  if (conversion.length >= 2) {
    const bestRate = Math.max(...conversion.map((item) => item.conversionRate));
    const leaders = conversion.filter((item) => item.conversionRate === bestRate);
    observations.push(
      "Highest observed orders/clicks: " + leaders.map((item) => item.campaignId).join(", ") +
      " (" + (bestRate * 100).toFixed(2) + "%). Compare click volume too; this is a signal, not proof of a winner."
    );
  } else {
    observations.push("Not enough valid conversion-rate values to compare this period.");
  }

  if (campaigns.every((item) => Number.isFinite(item.commission) && item.commission >= 0)) {
    const maxCommission = Math.max(...campaigns.map((item) => item.commission));
    const leaders = campaigns.filter((item) => item.commission === maxCommission);
    observations.push(
      "Highest reported commission: " + leaders.map((item) => item.campaignId).join(", ") +
      " (₹" + maxCommission.toLocaleString("en-IN", { maximumFractionDigits: 2 }) +
      "). Commission alone does not establish profitability or causal performance."
    );
  } else {
    observations.push("Commission comparison withheld because one or more campaign reports have incomplete commission data.");
  }

  const returns = campaigns.filter((item) =>
    Number.isFinite(item.returnRate) && Number.isFinite(item.returns) &&
    Number.isFinite(item.orders) && item.orders > 0 && item.returns <= item.orders
  );
  if (returns.length >= 2) {
    const lowestRate = Math.min(...returns.map((item) => item.returnRate));
    const leaders = returns.filter((item) => item.returnRate === lowestRate);
    observations.push(
      "Lowest observed return rate among reports with valid return data: " +
      leaders.map((item) => item.campaignId).join(", ") +
      " (" + (lowestRate * 100).toFixed(2) + "%). Confirm returns use the same attribution window."
    );
  } else {
    observations.push("Return-rate comparison unavailable: at least two campaigns need valid return data.");
  }
  return observations;
}

const api = { parseCampaignReport, compareCampaignReports, summarizeCampaignComparison };
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.AICommerceCampaignReport = api;
