"use strict";

(function () {
  const engine = window.AIEarningEngine;
  const $ = (id) => document.getElementById(id);
  if (!engine || !$("earningOpportunityForm")) return;

  const STORAGE_KEY = "ai-commerce-hub.earning-opportunities.v1";
  const TASK_KEY = "ai-commerce-hub.earning-tasks.v1";
  const MAX_RECORDS = engine.MAX_OPPORTUNITIES;
  let opportunities = loadArray(STORAGE_KEY);
  let tasks = loadArray(TASK_KEY);

  function loadArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value.slice(0, MAX_RECORDS) : [];
    } catch { return []; }
  }

  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  }

  function money(value, currency = "INR") {
    try { return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value); }
    catch { return currency + " " + value; }
  }

  function render() {
    const ranked = engine.rankOpportunities(opportunities);
    const summary = engine.summarizeEarnings(tasks.filter(item => item.kind === "earning"));
    $("earningOpportunityCount").textContent = String(opportunities.filter(item => item.status === "open").length);
    $("earningConfirmedTotal").textContent = money(summary.confirmed);
    $("earningPaidTotal").textContent = money(summary.paid);
    const list = $("earningOpportunityList");
    list.replaceChildren();
    if (!ranked.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "ഇപ്പോൾ അവസരങ്ങളില്ല. ഔദ്യോഗികമായി പരിശോധിച്ച opportunity ചേർത്ത് വിശകലനം ആരംഭിക്കാം.";
      list.append(empty);
      return;
    }
    for (const item of ranked) {
      const card = document.createElement("article");
      card.className = "candidate-card";
      const heading = document.createElement("h3");
      heading.textContent = item.title + " · " + item.platform.toUpperCase();
      const score = document.createElement("p");
      score.textContent = item.analysis.label + " · Score " + item.analysis.score + "/100 · Evidence " + item.analysis.coverage + "%";
      const detail = document.createElement("p");
      detail.textContent = "Eligibility: " + item.eligibility + " · Payout evidence: " + item.payoutConfidence + " · Risk: " + item.risk;
      const reward = document.createElement("p");
      reward.textContent = "Reward: " + (item.reward == null ? "Not entered" : money(item.reward, item.currency)) +
        " · Effort: " + (item.effortHours == null ? "Unknown" : item.effortHours + " hours") +
        " · Hourly estimate: " + (item.analysis.estimatedHourlyReward == null ? "Unavailable" : money(item.analysis.estimatedHourlyReward, item.currency));
      const source = document.createElement("a");
      source.href = item.sourceUrl;
      source.target = "_blank";
      source.rel = "noopener noreferrer";
      source.textContent = "Open source / campaign rules ↗";
      const actions = document.createElement("div");
      actions.className = "form-grid";
      const plan = document.createElement("button");
      plan.type = "button";
      plan.className = "secondary";
      plan.textContent = "Create task plan";
      plan.addEventListener("click", () => createPlan(item));
      const close = document.createElement("button");
      close.type = "button";
      close.className = "secondary";
      close.textContent = item.status === "closed" ? "Closed" : "Mark closed";
      close.disabled = item.status === "closed";
      close.addEventListener("click", () => closeOpportunity(item.id));
      actions.append(plan, close);
      card.append(heading, score, detail, reward, source, actions);
      list.append(card);
    }
  }

  function createPlan(item) {
    const result = engine.createTaskPlan(item);
    if (!result.valid) { $("earningHubMessage").textContent = result.error; return; }
    const existing = new Set(tasks.map(task => task.id));
    const additions = result.tasks.filter(task => !existing.has(task.id));
    tasks = [...tasks, ...additions].slice(-1000);
    if (!save(TASK_KEY, tasks)) { $("earningHubMessage").textContent = "Storage failed. Task plan was not saved."; return; }
    $("earningHubMessage").textContent = additions.length + " tasks saved locally. Account checks and publishing still need your approval.";
  }

  function closeOpportunity(id) {
    opportunities = opportunities.map(item => item.id === id ? { ...item, status: "closed" } : item);
    if (!save(STORAGE_KEY, opportunities)) { $("earningHubMessage").textContent = "Storage failed. Opportunity status was not changed."; return; }
    render();
    $("earningHubMessage").textContent = "Opportunity marked closed on this device.";
  }

  $("earningOpportunityForm").addEventListener("submit", event => {
    event.preventDefault();
    const raw = {
      id: "opp-" + Date.now().toString(36),
      title: $("earningTitle").value,
      platform: $("earningPlatform").value,
      description: $("earningDescription").value,
      sourceUrl: $("earningSourceUrl").value,
      eligibility: $("earningEligibility").value,
      reward: $("earningReward").value,
      effortHours: $("earningEffort").value,
      payoutConfidence: $("earningPayout").value,
      risk: $("earningRisk").value,
      deadline: $("earningDeadline").value,
      deliverables: $("earningDeliverables").value.split("\n").map(value => value.trim()).filter(Boolean)
    };
    const checked = engine.validateOpportunity(raw);
    if (!checked.valid) { $("earningHubMessage").textContent = checked.error; return; }
    if (opportunities.some(item => item.sourceUrl === checked.opportunity.sourceUrl && item.title.toLowerCase() === checked.opportunity.title.toLowerCase())) {
      $("earningHubMessage").textContent = "ഈ opportunity ഇതിനകം ചേർത്തിട്ടുണ്ട്.";
      return;
    }
    if (opportunities.length >= MAX_RECORDS) { $("earningHubMessage").textContent = "Opportunity limit reached. Close or export older records first."; return; }
    opportunities.push(checked.opportunity);
    if (!save(STORAGE_KEY, opportunities)) {
      opportunities.pop();
      $("earningHubMessage").textContent = "Browser storage failed. Opportunity was not saved.";
      return;
    }
    $("earningOpportunityForm").reset();
    $("earningHubMessage").textContent = "Opportunity saved. Score is a review priority, not guaranteed earnings.";
    render();
  });

  render();
  window.addEventListener("storage", event => {
    if (event.key === STORAGE_KEY) { opportunities = loadArray(STORAGE_KEY); render(); }
  });
})();
