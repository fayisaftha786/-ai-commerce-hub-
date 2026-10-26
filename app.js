
"use strict";

const $ = (id) => document.getElementById(id);
const products = [];
let clicks = 0;

function render() {
  $("products").textContent = products.length;
  $("campaigns").textContent = "0";
  $("clicks").textContent = clicks;

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
      clicks++;
      $("clicks").textContent = clicks;
    });

    item.append(title, detail, link);
    $("productList").append(item);
  }
}

$("productForm").addEventListener("submit", (event) => {
  event.preventDefault();

  const name = $("productName").value.trim();
  const platform = $("platform").value;
  let url;

  try {
    url = new URL($("productUrl").value.trim());
  } catch {
    $("message").textContent = "Please enter a valid product URL.";
    return;
  }

  if (!["https:", "http:"].includes(url.protocol)) {
    $("message").textContent = "Only HTTP/HTTPS links are allowed.";
    return;
  }

  if (products.length >= 100) {
    $("message").textContent = "Prototype limit: 100 products.";
    return;
  }

  products.push({ name, platform, url: url.href });
  $("productName").value = "";
  $("productUrl").value = "";
  $("message").textContent =
    "Product added to this session. Data is not yet saved permanently.";
  render();
});

$("generate").addEventListener("click", () => {
  const topic = $("topic").value.trim();
  const language = $("language").value;

  if (!topic) {
    $("draft").value = "Enter a product or topic first.";
    return;
  }

  const intro = language === "English"
    ? `Discover ${topic}.`
    : language === "Both"
      ? `${topic} — കണ്ടെത്തൂ / Discover ${topic}.`
      : `${topic} പരിചയപ്പെടൂ.`;

  $("draft").value =
    `${intro}\n\n` +
    `പ്രധാന സവിശേഷതകൾ വാങ്ങുന്നതിന് മുമ്പ് പരിശോധിക്കുക.\n` +
    `വിലയും ലഭ്യതയും മാറാം. ഈ ലിങ്ക് affiliate link ആണെങ്കിൽ ` +
    `அதைத் தெளிவாக அறிவிக்கவும்.\n\n` +
    `#ProductFinds #Shopping`;
});

$("copyDraft").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("draft").value);
    $("message").textContent = "Draft copied.";
  } catch {
    $("message").textContent =
      "Copy is unavailable here. Select and copy the draft manually.";
  }
});

render();

