"use strict";

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "ai-commerce-hub.products.v1";
const MAX_PRODUCTS = 100;
const products = loadProducts();
let clicks = 0;
let draftsCreated = 0;

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
    // Storage may be disabled, full, or contain invalid data.
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
    $("message").textContent =
      "Automatic copy is unavailable. The draft is selected; copy it manually.";
  }
});

render();
