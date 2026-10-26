"use strict";

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "ai-commerce-hub.products.v1";
const MAX_PRODUCTS = 100;
const products = loadProducts();
let clicks = 0;
let draftsCreated = 0;
let lastAnalyzedOffer = null;

function loadProducts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return [];

    const validator = window.AICommerceProductUtils?.validateProduct;
    if (typeof validator !== "function") return [];
    return saved
      .map((item) => validator(item))
      .filter((result) => result.valid)
      .slice(0, MAX_PRODUCTS)
      .map((result) => result.product);
  } catch {
    return [];
  }
}

function saveProducts() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
    return true;
  } catch {
    return false;
  }
}

function render() {
  $("products").textContent = String(products.length);
  $("campaigns").textContent = String(draftsCreated);
  $("clicks").textContent = String(clicks);
  $("productList").replaceChildren();

  for (const product of products) {
    const item = document.createElement("div");
    item.className = "product";
    const title = document.createElement("strong");
    title.textContent = product.name;
    const detail = document.createElement("p");
    detail.textContent = product.platform;
    const link = document.createElement("a");
    link.href = product.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer sponsored";
    link.textContent = "Open product link";
    link.addEventListener("click", () => {
      clicks += 1;
      $("clicks").textContent = String(clicks);
    });
    item.append(title, detail, link);
    $("productList").append(item);
  }
}

$("productForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const validator = window.AICommerceProductUtils?.validateProduct;
  if (typeof validator !== "function") {
    $("message").textContent = "Product validation could not load. Refresh and try again.";
    return;
  }

  const result = validator({
    name: $("productName").value,
    platform: $("platform").value,
    url: $("productUrl").value
  });
  if (!result.valid) {
    $("message").textContent = result.error;
    return;
  }
  if (products.length >= MAX_PRODUCTS) {
    $("message").textContent = "Prototype limit: 100 products.";
    return;
  }

  products.push(result.product);
  const saved = saveProducts();
  $("productName").value = "";
  $("productUrl").value = "";
  $("message").textContent = saved
    ? "Product added and saved on this device."
    : "Product added for this session, but browser storage is unavailable.";
  render();
});

function formatMoney(value) {
  return "₹" + Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

$("offerForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const engine = window.AICommerceOfferEngine;
  if (typeof engine?.analyzeOffer !== "function") {
    $("offerMessage").textContent = "Offer analysis could not load. Refresh and try again.";
    return;
  }

  const result = engine.analyzeOffer({
    productName: $("offerName").value,
    currentPrice: $("offerCurrentPrice").value,
    originalPrice: $("offerOriginalPrice").value,
    shipping: $("offerShipping").value,
    expiresAt: $("offerExpiry").value,
    url: $("offerUrl").value
  });

  $("offerResult").replaceChildren();
  $("offerDraft").value = "";
  lastAnalyzedOffer = null;
  if (!result.valid) {
    $("offerMessage").textContent = result.error;
    return;
  }

  lastAnalyzedOffer = result.offer;
  const summary = document.createElement("div");
  summary.className = "offer-summary";
  const heading = document.createElement("h3");
  heading.textContent = result.offer.scoreLabel + " · Readiness score " + result.offer.score + "/100";
  const numbers = document.createElement("p");
  numbers.textContent =
    "Listed discount: " + result.offer.discountPercent + "% · Listed saving: " +
    formatMoney(result.offer.savings) + " · Price incl. entered shipping: " +
    formatMoney(result.offer.deliveredPrice);
  const warning = document.createElement("p");
  warning.textContent = "This score checks entered details; it does not prove the deal is genuine or predict sales.";
  const list = document.createElement("ul");
  for (const recommendation of result.offer.recommendations) {
    const li = document.createElement("li");
    li.textContent = recommendation;
    list.append(li);
  }
  summary.append(heading, numbers, warning, list);
  $("offerResult").append(summary);

  const language = $("offerLanguage").value;
  const channel = $("offerChannel").value;
  let draft = engine.createPromoCopy(result.offer, language, channel);
  const rawUrl = $("offerUrl").value.trim();
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "https:" && url.hostname && !url.username && !url.password) {
      draft = draft.replace("[ഇവിടെ നിങ്ങളുടെ സ്ഥിരീകരിച്ച ഉൽപ്പന്ന ലിങ്ക് ചേർക്കുക]", url.href)
        .replace("[Add your verified product link here]", url.href);
    }
  } catch {
    // Keep the visible link placeholder if no valid HTTPS link was entered.
  }
  $("offerDraft").value = draft;
  draftsCreated += 1;
  $("campaigns").textContent = String(draftsCreated);
  $("offerMessage").textContent = "Offer analyzed. Verify all seller details before sharing.";
});

$("copyOfferDraft").addEventListener("click", async () => {
  const draft = $("offerDraft").value;
  if (!draft.trim()) {
    $("offerMessage").textContent = "Analyze an offer first.";
    return;
  }
  try {
    await navigator.clipboard.writeText(draft);
    $("offerMessage").textContent = "Offer draft copied.";
  } catch {
    $("offerDraft").focus();
    $("offerDraft").select();
    $("offerMessage").textContent = "Automatic copy is unavailable. The draft is selected; copy it manually.";
  }
});

$("generate").addEventListener("click", () => {
  const topic = $("topic").value.trim();
  const language = $("language").value;
  if (!topic) {
    $("draft").value = "ആദ്യം ഒരു ഉൽപ്പന്നമോ വിഷയമോ നൽകുക.";
    return;
  }
  const intro = language === "English"
    ? `Discover ${topic}.`
    : language === "Both"
      ? `${topic} — പരിചയപ്പെടൂ / Discover ${topic}.`
      : `${topic} പരിചയപ്പെടൂ.`;
  const disclosure = language === "English"
    ? "If this is an affiliate link, clearly disclose that relationship. Prices and availability may change."
    : language === "Both"
      ? "Affiliate link ആണെങ്കിൽ അത് വ്യക്തമായി അറിയിക്കുക. Prices and availability may change."
      : "ഇത് affiliate link ആണെങ്കിൽ ആ കാര്യം വ്യക്തമായി അറിയിക്കുക. വിലയും ലഭ്യതയും മാറാം.";
  $("draft").value =
    `${intro}\n\n` +
    "വാങ്ങുന്നതിന് മുമ്പ് ഉൽപ്പന്നത്തിന്റെ സവിശേഷതകളും വിലയും വിൽപ്പനക്കാരന്റെ വിവരങ്ങളും പരിശോധിക്കുക.\n\n" +
    `${disclosure}\n\n` +
    "#ProductFinds #Shopping";
  draftsCreated += 1;
  $("campaigns").textContent = String(draftsCreated);
  $("message").textContent = "Template draft created. This is not AI-generated content yet.";
});

$("copyDraft").addEventListener("click", async () => {
  const draft = $("draft").value;
  if (!draft.trim()) {
    $("message").textContent = "Create a draft first.";
    return;
  }
  try {
    await navigator.clipboard.writeText(draft);
    $("message").textContent = "Draft copied.";
  } catch {
    $("draft").focus();
    $("draft").select();
    $("message").textContent = "Automatic copy is unavailable. The draft is selected; copy it manually.";
  }
});


const CANDIDATE_KEY = "ai-commerce-hub.candidates.v1";
let latestCandidate = null;

function loadCandidates() {
  try {
    const value = JSON.parse(localStorage.getItem(CANDIDATE_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item) => item && typeof item.name === "string" && Number.isFinite(item.score)).slice(0, 50) : [];
  } catch { return []; }
}
const candidates = loadCandidates();

function saveCandidates() {
  try { localStorage.setItem(CANDIDATE_KEY, JSON.stringify(candidates)); return true; }
  catch { return false; }
}

function renderCandidates() {
  const root = $("candidateList");
  root.replaceChildren();
  if (!candidates.length) {
    const empty = document.createElement("p");
    empty.textContent = "No saved candidates yet. Score a product and save it to your shortlist.";
    root.append(empty);
    return;
  }
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    const card = document.createElement("div");
    card.className = "candidate-card";
    const title = document.createElement("strong");
    title.textContent = candidate.name + " — " + candidate.score + "/100";
    const details = document.createElement("p");
    details.textContent = candidate.label + " · ₹" + Number(candidate.price).toLocaleString("en-IN") + " · entered demand " + candidate.demand + "/5 · commission " + candidate.commission + "%";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      const index = candidates.findIndex((item) => item.name === candidate.name && item.price === candidate.price);
      if (index >= 0) candidates.splice(index, 1);
      saveCandidates();
      renderCandidates();
    });
    card.append(title, details, remove);
    root.append(card);
  }
}

$("candidateForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const engine = window.AICommerceDiscovery;
  if (typeof engine?.scoreCandidate !== "function") {
    $("candidateResult").textContent = "Product discovery module did not load. Refresh and try again.";
    return;
  }
  const result = engine.scoreCandidate({
    name: $("candidateName").value,
    price: $("candidatePrice").value,
    commission: $("candidateCommission").value,
    rating: $("candidateRating").value,
    reviews: $("candidateReviews").value,
    demand: $("candidateDemand").value,
    competition: $("candidateCompetition").value,
    inStock: $("candidateStock").checked
  });
  $("candidateResult").replaceChildren();
  latestCandidate = null;
  if (!result.valid) {
    $("candidateResult").textContent = result.error;
    return;
  }
  latestCandidate = result.candidate;
  const card = document.createElement("div");
  card.className = "candidate-card";
  const heading = document.createElement("h3");
  heading.textContent = result.candidate.label + " · " + result.candidate.score + "/100";
  const commission = document.createElement("p");
  commission.textContent = "Estimated commission at entered rate: " + formatMoney(result.candidate.estimatedCommission) + " per qualifying order, before returns or adjustments.";
  const list = document.createElement("ul");
  for (const check of result.candidate.checks) {
    const item = document.createElement("li");
    item.textContent = check;
    list.append(item);
  }
  card.append(heading, commission, list);
  $("candidateResult").append(card);
});

$("saveCandidate").addEventListener("click", () => {
  if (!latestCandidate) {
    $("candidateResult").textContent = "Score a valid product candidate first.";
    return;
  }
  if (candidates.some((item) => item.name.toLowerCase() === latestCandidate.name.toLowerCase())) {
    $("candidateResult").textContent = "This product is already in your shortlist.";
    return;
  }
  if (candidates.length >= 50) {
    $("candidateResult").textContent = "Shortlist limit is 50 products.";
    return;
  }
  candidates.push(latestCandidate);
  const saved = saveCandidates();
  renderCandidates();
  $("candidateResult").append(document.createTextNode(saved ? " Saved to this device." : " Added for this session only; browser storage is unavailable."));
});

$("contentForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const engine = window.AICommerceDiscovery;
  if (typeof engine?.createContentPack !== "function") {
    $("contentMessage").textContent = "Content studio could not load. Refresh and try again.";
    return;
  }
  try {
    const pack = engine.createContentPack({
      name: $("contentName").value,
      benefit: $("contentBenefit").value,
      audience: $("contentAudience").value,
      proof: $("contentProof").value,
      price: $("contentPrice").value,
      link: $("contentLink").value,
      language: $("contentLanguage").value,
      platform: $("contentPlatform").value,
      type: $("contentType").value
    });
    $("contentOutput").value = $("contentType").value === "Post"
      ? pack.post + "\n\n---------------- VIDEO PLAN ----------------\n\n" + pack.video
      : pack.video + "\n\n---------------- POST CAPTION ----------------\n\n" + pack.post;
    draftsCreated += 1;
    $("campaigns").textContent = String(draftsCreated);
    $("contentMessage").textContent = "Draft prepared. Review every product claim and link before posting.";
  } catch (error) {
    $("contentMessage").textContent = error instanceof Error ? error.message : "Could not create content.";
  }
});

$("copyContent").addEventListener("click", async () => {
  const output = $("contentOutput").value;
  if (!output.trim()) {
    $("contentMessage").textContent = "Create a post or video plan first.";
    return;
  }
  try {
    await navigator.clipboard.writeText(output);
    $("contentMessage").textContent = "Content pack copied.";
  } catch {
    $("contentOutput").focus();
    $("contentOutput").select();
    $("contentMessage").textContent = "Automatic copy is unavailable. The text is selected; copy it manually.";
  }
});


const CATALOG_KEY = "ai-commerce-hub.catalog-import.v1";
function renderImportedCatalog(records, errors = []) {
  const root = $("catalogResults");
  root.replaceChildren();
  const summary = document.createElement("p");
  summary.textContent = "Ranked " + records.length + " valid products. Highest scores first. Check any row warnings below; scores are not a sales guarantee.";
  root.append(summary);
  for (const record of records) {
    const card = document.createElement("article");
    card.className = "candidate-card";
    const heading = document.createElement("h3");
    heading.textContent = record.name + " — " + record.score + "/100";
    const details = document.createElement("p");
    const performance = record.orders !== null
      ? record.orders + " orders" + (record.clicks !== null ? " / " + record.clicks + " clicks" : "")
      : record.clicks !== null ? record.clicks + " clicks; orders not supplied" : "No sales metrics supplied";
    const returnsText = record.returnRate !== null && record.returnRate !== undefined
      ? " · " + Math.round(record.returnRate * 100) + "% returns" : "";
    details.textContent = record.platform + " · ₹" + record.price.toLocaleString("en-IN") + " · " + performance +
      (record.periodDays ? " · " + record.periodDays + "-day period" : " · period not confirmed") + returnsText;
    const warnings = document.createElement("ul");
    for (const warning of record.warnings) {
      const li = document.createElement("li");
      li.textContent = warning;
      warnings.append(li);
    }
    card.append(heading, details);
    if (record.url) {
      const link = document.createElement("a");
      link.href = record.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer sponsored";
      link.textContent = "Open supplied product link";
      card.append(link);
    }
    card.append(warnings);
    root.append(card);
  }
  if (errors.length) {
    const list = document.createElement("ul");
    for (const error of errors.slice(0, 20)) {
      const item = document.createElement("li");
      item.textContent = error;
      list.append(item);
    }
    const heading = document.createElement("h3");
    heading.textContent = "Rows needing attention";
    root.append(heading, list);
  }
  try {
    localStorage.setItem(CATALOG_KEY, JSON.stringify(records));
    $("catalogMessage").textContent = "Ranked on this device only. Keep the original CSV safe; this page does not upload it.";
  } catch {
    $("catalogMessage").textContent = "Ranked for this session; browser storage was unavailable.";
  }
}

$("downloadCatalogTemplate").addEventListener("click", () => {\n  const template = "name,platform,url,price,commission,rating,reviews,clicks,orders,returns,period_days,stock\\n";\n  const blob = new Blob([template], { type: "text/csv;charset=utf-8" });\n  const url = URL.createObjectURL(blob);\n  const link = document.createElement("a");\n  link.href = url;\n  link.download = "ai-commerce-hub-catalog-template.csv";\n  document.body.append(link);\n  link.click();\n  link.remove();\n  setTimeout(() => URL.revokeObjectURL(url), 1000);\n});\n\n$("catalogForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const file = $("catalogCsv").files?.[0];
  if (!file) {
    $("catalogMessage").textContent = "Choose a CSV export first.";
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    $("catalogMessage").textContent = "CSV must be 2 MB or smaller.";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const importer = window.AICommerceCatalogImport;
    if (typeof importer?.rankCatalogCsv !== "function") {
      $("catalogMessage").textContent = "CSV importer did not load. Refresh and try again.";
      return;
    }
    const result = importer.rankCatalogCsv(String(reader.result || ""));
    if (!result.valid) {
      $("catalogResults").replaceChildren();
      $("catalogMessage").textContent = result.error;
      return;
    }
    renderImportedCatalog(result.records, result.errors);
  };
  reader.onerror = () => { $("catalogMessage").textContent = "Could not read the selected CSV file."; };
  reader.readAsText(file);
});

try {
  const previousCatalog = JSON.parse(localStorage.getItem(CATALOG_KEY) || "[]");
  if (Array.isArray(previousCatalog) && previousCatalog.length) {
    renderImportedCatalog(previousCatalog);
    $("catalogMessage").textContent = "Loaded the last imported shortlist from this device.";
  }
} catch {
  // Ignore corrupted local cache; importing a fresh CSV remains available.
}

renderCandidates();

render();
