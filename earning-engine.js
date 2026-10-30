"use strict";

const INDIA_PROVIDER_REGISTRY = Object.freeze([
  { id: "youtube", name: "YouTube", type: "creator", indiaAvailability: "available-subject-to-account-eligibility", earningTypes: ["YPP ads", "Shorts", "Memberships", "Shopping", "brand deals"], source: "https://support.google.com/youtube/answer/72851" },
  { id: "facebook", name: "Facebook", type: "creator", indiaAvailability: "program-and-account-dependent", earningTypes: ["Content Monetization", "Stars", "brand deals"], source: "https://www.facebook.com/business/learn" },
  { id: "instagram", name: "Instagram", type: "creator", indiaAvailability: "feature-and-account-dependent", earningTypes: ["brand deals", "Gifts where enabled", "Subscriptions where enabled"], source: "https://help.instagram.com/" },
  { id: "snapchat", name: "Snapchat", type: "creator", indiaAvailability: "country-and-invitation-dependent", earningTypes: ["Creator monetization", "Spotlight"], source: "https://help.snapchat.com/" },
  { id: "x", name: "X", type: "creator", indiaAvailability: "check-current-programme-eligibility", earningTypes: ["Original Content Rewards"], source: "https://help.x.com/" },
  { id: "amazon", name: "Amazon India", type: "affiliate", indiaAvailability: "programme-enrolment-and-api-approval-dependent", earningTypes: ["affiliate commission"], source: "https://affiliate-program.amazon.in/" },
  { id: "flipkart", name: "Flipkart", type: "affiliate", indiaAvailability: "affiliate-approval-and-terms-dependent", earningTypes: ["affiliate commission"], source: "https://affiliate.flipkart.com/" },
  { id: "meesho", name: "Meesho", type: "affiliate", indiaAvailability: "creator-program-and-account-dependent", earningTypes: ["creator/affiliate commission"], source: "https://affiliate.meesho.com/influencer-home" }
]);

const WEIGHTS = Object.freeze({ eligibility: 20, reward: 20, effort: 10, payout: 15, deadline: 10, risk: 10, sourceFreshness: 15 });
const MAX_OPPORTUNITIES = 300;
const ALLOWED_ELIGIBILITY = new Set(["eligible", "likely", "ineligible", "unknown"]);
const ALLOWED_PAYOUT = new Set(["verified", "official-terms", "unknown"]);
const ALLOWED_RISK = new Set(["low", "medium", "high", "unknown"]);

function cleanText(value, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

function validateOpportunity(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { valid: false, error: "Opportunity details are required." };
  const id = cleanText(input.id, 80);
  const title = cleanText(input.title, 120);
  const platform = cleanText(input.platform, 40).toLowerCase();
  const description = cleanText(input.description, 1200);
  const sourceUrl = safeHttpsUrl(input.sourceUrl);
  const eligibility = ALLOWED_ELIGIBILITY.has(input.eligibility) ? input.eligibility : "unknown";
  const payoutConfidence = ALLOWED_PAYOUT.has(input.payoutConfidence) ? input.payoutConfidence : "unknown";
  const risk = ALLOWED_RISK.has(input.risk) ? input.risk : "unknown";
  const reward = input.reward == null || input.reward === "" ? null : Number(input.reward);
  const effortHours = input.effortHours == null || input.effortHours === "" ? null : Number(input.effortHours);
  const currency = cleanText(input.currency || "INR", 10).toUpperCase();
  const deadline = cleanText(input.deadline, 10);
  const sourceCheckedAt = cleanText(input.sourceCheckedAt, 10);
  if (sourceCheckedAt) {
    const checkedMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sourceCheckedAt);
    if (!checkedMatch) return { valid: false, error: "Source checked date must use YYYY-MM-DD." };
    const checkedDate = new Date(Date.UTC(Number(checkedMatch[1]), Number(checkedMatch[2]) - 1, Number(checkedMatch[3])));
    if (checkedDate.getUTCFullYear() !== Number(checkedMatch[1]) || checkedDate.getUTCMonth() !== Number(checkedMatch[2]) - 1 || checkedDate.getUTCDate() !== Number(checkedMatch[3])) {
      return { valid: false, error: "Source checked date must be a real calendar date." };
    }
  }
  const deliverables = Array.isArray(input.deliverables)
    ? input.deliverables.slice(0, 20).map(item => cleanText(item, 160)).filter(Boolean)
    : [];
  if (!id || !title || !platform || !sourceUrl) return { valid: false, error: "Add an ID, title, platform and a valid HTTPS source link." };
  if (reward !== null && (!Number.isFinite(reward) || reward < 0 || reward > 100000000)) return { valid: false, error: "Reward must be a non-negative amount up to 100,000,000." };
  if (effortHours !== null && (!Number.isFinite(effortHours) || effortHours <= 0 || effortHours > 10000)) return { valid: false, error: "Effort must be greater than zero and no more than 10,000 hours." };
  if (!/^[A-Z]{3}$/.test(currency)) return { valid: false, error: "Currency must be a 3-letter code such as INR." };
  if (deadline) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deadline);
    if (!match) return { valid: false, error: "Deadline must use YYYY-MM-DD." };
    const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (parsed.getUTCFullYear() !== Number(match[1]) || parsed.getUTCMonth() !== Number(match[2]) - 1 || parsed.getUTCDate() !== Number(match[3])) {
      return { valid: false, error: "Deadline must use a real calendar date." };
    }
  }
  return {
    valid: true,
    opportunity: {
      id, title, platform, description, sourceUrl, eligibility, payoutConfidence, risk,
      reward, effortHours, currency, deadline, deliverables,
      status: input.status === "closed" ? "closed" : "open",
      country: "IN",
      sourceCheckedAt: cleanText(input.sourceCheckedAt, 30),
      notes: cleanText(input.notes, 1000),
      createdAt: cleanText(input.createdAt, 40) || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };
}

function deadlinePoints(deadline, now = new Date()) {
  if (!deadline) return null;
  const end = new Date(deadline + "T23:59:59");
  if (!Number.isFinite(end.getTime())) return null;
  const days = Math.ceil((end.getTime() - now.getTime()) / 86400000);
  if (days < 0) return 0;
  if (days <= 2) return 10;
  if (days <= 7) return 8;
  if (days <= 14) return 6;
  if (days <= 30) return 4;
  return 2;
}

function analyzeOpportunity(input, now = new Date()) {
  const checked = validateOpportunity(input);
  if (!checked.valid) return checked;
  const item = checked.opportunity;
  const signals = {};
  if (item.eligibility !== "unknown") signals.eligibility = item.eligibility === "eligible" ? 20 : item.eligibility === "likely" ? 12 : 0;
  if (item.reward !== null) signals.reward = item.reward > 0 ? Math.min(20, 6 + Math.log10(item.reward + 1) * 5.6) : 0;
  if (item.effortHours !== null) signals.effort = Math.max(0, 10 - Math.min(10, Math.log2(item.effortHours + 1) * 2.7));
  if (item.payoutConfidence !== "unknown") signals.payout = item.payoutConfidence === "verified" ? 15 : 10;
  const deadline = deadlinePoints(item.deadline, now);
  if (deadline !== null) signals.deadline = deadline;
  if (item.risk !== "unknown") signals.risk = item.risk === "low" ? 10 : item.risk === "medium" ? 5 : 0;
  if (item.sourceCheckedAt) {
    const checkedDate = new Date(item.sourceCheckedAt + "T00:00:00Z");
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const ageDays = Math.floor((today - checkedDate.getTime()) / 86400000);
    if (ageDays >= 0) signals.sourceFreshness = ageDays <= 7 ? 15 : ageDays <= 30 ? 8 : 0;
  }

  const knownWeight = Object.keys(signals).reduce((sum, key) => sum + WEIGHTS[key], 0);
  const raw = Object.entries(signals).reduce((sum, [key, value]) => sum + value, 0);
  const score = knownWeight ? Math.max(0, Math.min(100, Math.round(raw / knownWeight * 100))) : 0;
  const coverage = Math.round(knownWeight / 100 * 100);
  const blocked = item.status !== "open" || item.eligibility === "ineligible" || item.risk === "high" || (item.deadline && deadline === 0);
  const label = blocked ? "Do not prioritise" : coverage < 60 ? "Need more evidence" : score >= 75 ? "High-priority review" : score >= 55 ? "Review next" : "Research more";
  const estimatedHourlyReward = item.reward !== null && item.effortHours ? Math.round(item.reward / item.effortHours * 100) / 100 : null;
  return {
    valid: true,
    analysis: {
      id: item.id, title: item.title, platform: item.platform, score, coverage,
      knownSignals: Object.keys(signals), signals, label, blocked,
      estimatedHourlyReward, currency: item.currency,
      limitations: [
        "Score is a prioritisation heuristic, not a probability of earning or a payout promise.",
        "Eligibility and programme access must be confirmed in the official account dashboard.",
        "Reward and effort values are user-entered unless the source explicitly verifies them."
      ]
    }
  };
}

function createTaskPlan(input) {
  const checked = validateOpportunity(input);
  if (!checked.valid) return checked;
  const item = checked.opportunity;
  const tasks = [
    { id: item.id + "-verify", title: "Verify current programme rules and India availability", status: "todo", requiresApproval: true },
    { id: item.id + "-eligibility", title: "Check account eligibility in the official platform dashboard", status: "todo", requiresApproval: true },
    { id: item.id + "-brief", title: "Read deliverables, prohibited content and deadline", status: "todo", requiresApproval: false },
    ...item.deliverables.map((title, index) => ({ id: item.id + "-deliverable-" + (index + 1), title, status: "todo", requiresApproval: false })),
    { id: item.id + "-publish", title: "Review and publish using an approved platform workflow", status: "todo", requiresApproval: true },
    { id: item.id + "-evidence", title: "Save the public post URL and submission evidence", status: "todo", requiresApproval: false },
    { id: item.id + "-payout", title: "Verify payout and reconcile confirmed earnings from the official report", status: "todo", requiresApproval: true }
  ];
  return { valid: true, tasks };
}

function summarizeEarnings(records) {
  const totals = { estimated: 0, confirmed: 0, paid: 0, currency: "INR", count: 0 };
  if (!Array.isArray(records)) return totals;
  for (const record of records) {
    if (!record || record.currency !== "INR" || !["estimated", "confirmed", "paid"].includes(record.status)) continue;
    const amount = Number(record.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) continue;
    totals[record.status] += amount;
    totals.count += 1;
  }
  for (const key of ["estimated", "confirmed", "paid"]) totals[key] = Math.round(totals[key] * 100) / 100;
  return totals;
}

function rankOpportunities(items, now = new Date()) {
  if (!Array.isArray(items)) return [];
  return items.map(item => ({ item, result: analyzeOpportunity(item, now) }))
    .filter(entry => entry.result.valid)
    .sort((a, b) => Number(a.result.analysis.blocked) - Number(b.result.analysis.blocked) ||
      b.result.analysis.coverage - a.result.analysis.coverage ||
      b.result.analysis.score - a.result.analysis.score)
    .map(entry => ({ ...entry.item, analysis: entry.result.analysis }));
}

const api = { INDIA_PROVIDER_REGISTRY, MAX_OPPORTUNITIES, validateOpportunity, analyzeOpportunity, createTaskPlan, summarizeEarnings, rankOpportunities };
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.AIEarningEngine = api;
