"use strict";

(function initWorkflowGuide(root) {
  const STORAGE_KEYS = {
    products: "ai-commerce-hub.products.v1",
    candidates: "ai-commerce-hub.candidates.v1",
    campaigns: "ai-commerce-hub.campaigns.v1"
  };

  function readArray(storage, key) {
    try {
      const value = JSON.parse(storage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function summarizeWorkspace(storage) {
    return {
      products: readArray(storage, STORAGE_KEYS.products).length,
      candidates: readArray(storage, STORAGE_KEYS.candidates).length,
      campaigns: readArray(storage, STORAGE_KEYS.campaigns).length
    };
  }

  function getNextStep(summary) {
    if (summary.products === 0) return { title: "Discover a product", target: "marketplaceSearchForm", reason: "Start with a category search, then check current details on the marketplace." };
    if (summary.candidates === 0) return { title: "Score your product", target: "candidateForm", reason: "Enter the verified price, commission and evidence source before ranking it." };
    if (summary.campaigns === 0) return { title: "Create reviewed content", target: "contentForm", reason: "Turn a product into a caption or video plan, review claims and disclose affiliate links." };
    return { title: "Review campaign evidence", target: "campaignReportForm", reason: "Compare authorised reporting data using the same date range and campaign IDs." };
  }

  function render(storage, document) {
    const summary = summarizeWorkspace(storage);
    const next = getNextStep(summary);
    const summaryRoot = document.getElementById("workflowGuideSummary");
    const stepsRoot = document.getElementById("workflowGuideSteps");
    if (!summaryRoot || !stepsRoot) return summary;

    summaryRoot.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = "Recommended next step: " + next.title;
    const explanation = document.createElement("p");
    explanation.textContent = next.reason;
    const jump = document.createElement("a");
    jump.href = "#" + next.target;
    jump.textContent = "Go to next step ↓";
    summaryRoot.append(heading, explanation, jump);

    stepsRoot.replaceChildren();
    const steps = [
      { label: "Saved products", count: summary.products, target: "productForm", detail: "Product links saved on this device." },
      { label: "Shortlist candidates", count: summary.candidates, target: "candidateForm", detail: "Candidate records saved locally; evidence still needs checking." },
      { label: "Campaign records", count: summary.campaigns, target: "campaignList", detail: "Saved content campaign metadata, not verified sales." }
    ];
    for (const step of steps) {
      const card = document.createElement("article");
      card.className = "workflow-guide-card";
      const title = document.createElement("h3");
      title.textContent = step.label;
      const count = document.createElement("strong");
      count.textContent = String(step.count);
      const detail = document.createElement("p");
      detail.textContent = step.detail;
      const link = document.createElement("a");
      link.href = "#" + step.target;
      link.textContent = "Open section ↗";
      card.append(title, count, detail, link);
      stepsRoot.append(card);
    }
    return { ...summary, next };
  }

  function init() {
    const document = root.document;
    if (!document || !document.getElementById("workflowGuide")) return;
    const refresh = () => render(root.localStorage, document);
    const button = document.getElementById("refreshWorkflowGuide");
    if (button) button.addEventListener("click", refresh);
    root.addEventListener("focus", refresh);
    root.addEventListener("storage", refresh);
    refresh();
  }

  const api = { summarizeWorkspace, getNextStep, render };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", init, { once: true });
    else init();
    root.AICommerceWorkflowGuide = api;
  }
})(typeof window === "object" ? window : globalThis);
