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

render();
