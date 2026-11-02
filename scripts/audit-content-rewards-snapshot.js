#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function validDate(value) {
  if (!value || typeof value !== "string") return false;
  return Number.isFinite(Date.parse(value));
}

function campaignUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.hostname !== "contentrewards.com" ||
        !/^\/c\/campaigns\/[^/]+$/.test(url.pathname)) return "";
    return url.origin + url.pathname;
  } catch (_) {
    return "";
  }
}

function auditSnapshot(snapshot, now = Date.now()) {
  const errors = [];
  const warnings = [];
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { ok: false, errors: ["Snapshot root must be a JSON object."], warnings: [], metrics: {} };
  }
  if (snapshot.schemaVersion !== 1) errors.push("Unsupported or missing schemaVersion (expected 1).");
  if (!validDate(snapshot.generatedAt)) errors.push("generatedAt must be a valid ISO date.");
  if (!Array.isArray(snapshot.campaigns)) errors.push("campaigns must be an array.");
  if (!Array.isArray(snapshot.campaignDetails)) errors.push("campaignDetails must be an array.");
  if (errors.length) return { ok: false, errors, warnings, metrics: {} };

  const campaigns = snapshot.campaigns;
  const details = snapshot.campaignDetails;
  const ageHours = (now - Date.parse(snapshot.generatedAt)) / 3600000;
  if (ageHours < -1) warnings.push("Snapshot timestamp is more than one hour in the future.");
  if (ageHours > 24) warnings.push("Snapshot is older than 24 hours; treat all availability claims as unverified.");
  const ids = new Set();
  const urls = new Set();
  const detailUrls = new Set();
  let duplicateIds = 0;
  let duplicateUrls = 0;
  let invalidCampaignUrls = 0;
  let historical = 0;
  let current = 0;
  let staleCampaigns = 0;
  let missingDetail = 0;
  let lockedRequirements = 0;
  let missingDeadlines = 0;
  let currentHighInformation = 0;
  let readableCurrentDetails = 0;
  const detailByUrl = new Map();

  for (const detail of details) {
    const url = campaignUrl(detail && detail.url);
    if (!url) {
      warnings.push("A saved detail record has a non-canonical campaign URL.");
      continue;
    }
    if (detailUrls.has(url)) warnings.push("Duplicate saved detail URL: " + url);
    detailUrls.add(url);
    detailByUrl.set(url, detail);
  }

  for (const row of campaigns) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push("Every campaign record must be an object.");
      continue;
    }
    const id = String(row.id || row.discoveryKey || "").trim();
    if (!id) warnings.push("A campaign record has no stable ID.");
    else if (ids.has(id)) duplicateIds += 1;
    ids.add(id);

    const url = campaignUrl(row.officialUrl || row.sourceUrl);
    if (!url) invalidCampaignUrls += 1;
    else if (urls.has(url)) duplicateUrls += 1;
    if (url) urls.add(url);

    const isHistorical = row.notSeenInLatestScan === true ||
      Boolean(row.opportunity && row.opportunity.status === "not-seen-in-latest-scan");
    if (isHistorical) historical += 1;
    else {
      current += 1;
      if (row.freshness === "stale") staleCampaigns += 1;
      if (row.hiddenRequirements && row.hiddenRequirements.locked) lockedRequirements += 1;
      if (!row.deadline && !row.endDate) missingDeadlines += 1;
      if (row.opportunity && row.opportunity.tier === "high") currentHighInformation += 1;
      const detail = url && detailByUrl.get(url);
      if (!detail) missingDetail += 1;
      else if (detail.status === "ok" && typeof detail.pageText === "string" && detail.pageText.trim().length >= 20) {
        readableCurrentDetails += 1;
      }
    }
  }

  if (duplicateIds) warnings.push(duplicateIds + " duplicate campaign ID(s) detected.");
  if (duplicateUrls) warnings.push(duplicateUrls + " duplicate campaign URL(s) detected.");
  if (invalidCampaignUrls) warnings.push(invalidCampaignUrls + " campaign record(s) have missing or non-canonical official URLs.");
  if (historical) warnings.push(historical + " historical campaign(s) were not present in the latest public listing; do not treat them as currently open.");
  if (staleCampaigns) warnings.push(staleCampaigns + " current campaign record(s) are marked stale.");
  if (missingDetail) warnings.push(missingDetail + " current campaign(s) have no matching saved detail page.");
  if (lockedRequirements) warnings.push(lockedRequirements + " current campaign(s) have creator requirements hidden until joining.");
  if (missingDeadlines) warnings.push(missingDeadlines + " current campaign(s) have no detected deadline; verify current availability.");
  if (currentHighInformation) warnings.push(currentHighInformation + " current campaign(s) have a high information score; this is not an eligibility or earnings prediction.");

  const metrics = {
    generatedAt: snapshot.generatedAt,
    ageHours: Math.round(ageHours * 10) / 10,
    campaignCount: campaigns.length,
    currentCampaignCount: current,
    historicalCampaignCount: historical,
    detailCount: details.length,
    readableCurrentDetailCount: readableCurrentDetails,
    staleCurrentCampaignCount: staleCampaigns,
    missingCurrentDetailCount: missingDetail,
    lockedCurrentRequirementsCount: lockedRequirements,
    missingCurrentDeadlineCount: missingDeadlines,
    highInformationCurrentCount: currentHighInformation,
    duplicateCampaignIds: duplicateIds,
    duplicateCampaignUrls: duplicateUrls,
    invalidCampaignUrls
  };
  return { ok: errors.length === 0, errors, warnings: [...new Set(warnings)], metrics };
}

function formatReport(result) {
  const m = result.metrics || {};
  const lines = [
    "## Content Rewards snapshot quality audit",
    "",
    "- **Structural validation:** " + (result.ok ? "PASS" : "FAIL"),
    "- **Snapshot age:** " + (m.ageHours == null ? "unknown" : m.ageHours + " hours"),
    "- **Campaigns:** " + (m.currentCampaignCount || 0) + " current / " + (m.historicalCampaignCount || 0) + " historical",
    "- **Readable current detail pages:** " + (m.readableCurrentDetailCount || 0),
    "- **Stale current records:** " + (m.staleCurrentCampaignCount || 0),
    "- **Missing current detail pages:** " + (m.missingCurrentDetailCount || 0),
    "- **Locked creator requirements:** " + (m.lockedCurrentRequirementsCount || 0),
    "- **Current campaigns without detected deadline:** " + (m.missingCurrentDeadlineCount || 0),
    "- **High information score (not earnings):** " + (m.highInformationCurrentCount || 0)
  ];
  if (result.errors.length) lines.push("", "### Errors", ...result.errors.map((item) => "- " + item));
  if (result.warnings.length) lines.push("", "### Warnings", ...result.warnings.map((item) => "- " + item));
  return lines.join("\n") + "\n";
}

function main() {
  const filePath = path.resolve(process.argv[2] || path.join(__dirname, "..", "content-rewards-assistant", "discovery-snapshot.json"));
  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error("Snapshot audit could not read valid JSON: " + error.message);
    process.exitCode = 1;
    return;
  }
  const result = auditSnapshot(snapshot);
  const report = formatReport(result);
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  }
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { auditSnapshot, formatReport, campaignUrl };
