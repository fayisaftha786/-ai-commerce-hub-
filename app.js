"use strict";

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "ai-commerce-hub.products.v1";
const MAX_PRODUCTS = 100;
const products = loadProducts();
let clicks = 0;
let draftsCreated = 0;
let lastAnalyzedOffer = null;
let latestCampaignReport = null;
const CAMPAIGN_KEY = "ai-commerce-hub.campaigns.v1";

const CLIPREWARD_STORAGE_KEY = "clipreward-studio-v1";
const BACKUP_KEYS = [
  "ai-commerce-hub.products.v1",
  "ai-commerce-hub.campaigns.v1",
  "ai-commerce-hub.candidates.v1",
  "ai-commerce-hub.catalog-import.v1",
  "ai-commerce-hub.earning-opportunities.v1",
  "ai-commerce-hub.earning-tasks.v1",
  "ai-commerce-hub.earning-records.v1",
  CLIPREWARD_STORAGE_KEY
];
const MAX_BACKUP_BYTES = 4 * 1024 * 1024;

function exportWorkspaceBackup() {
  const payload = { format: "ai-commerce-hub-backup", version: 1, exportedAt: new Date().toISOString(), data: {} };
  try {
    for (const key of BACKUP_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        // Refuse to export corrupt stored JSON rather than silently creating an incomplete backup.
        payload.data[key] = key === CAMPAIGN_KEY ? campaigns : JSON.parse(raw);
      }
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ai-commerce-hub-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("backupMessage").textContent = "Full workspace backup exported, including ClipReward Studio when it has saved data. Keep the file somewhere private and safe.";
  } catch {
    $("backupMessage").textContent = "Backup could not be created. Check browser storage and try again.";
  }
}

function validateBackup(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      payload.format !== "ai-commerce-hub-backup" || payload.version !== 1 ||
      !payload.data || typeof payload.data !== "object" || Array.isArray(payload.data)) {
    return { valid: false, error: "This is not a supported AI Commerce Hub backup file." };
  }

  const allowed = new Set(BACKUP_KEYS);
  const sections = payload.data;
  const invalid = (detail) => ({ valid: false, error: "Backup " + detail + "; nothing was restored." });
  const isRecord = (item) => Boolean(item && typeof item === "object" && !Array.isArray(item));
  for (const [key, value] of Object.entries(sections)) {
    if (!allowed.has(key)) return invalid("contains an unknown data section");
    if (key === CLIPREWARD_STORAGE_KEY) {
      const core = window.ClipRewardCore;
      if (!isRecord(value) || !core || typeof core.parseBackup !== "function") {
        return invalid("contains ClipReward Studio data that cannot be validated in this app version");
      }
      try {
        core.parseBackup({
          app: "ClipReward Studio",
          version: core.VERSION,
          campaigns: value.campaigns,
          timestamps: value.timestamps,
          account: value.account
        });
      } catch {
        return invalid("contains invalid ClipReward Studio campaigns, timestamps or account data");
      }
      continue;
    }
    if (!Array.isArray(value)) return invalid("contains a malformed data section");
  }

  const safeOptionalUrl = (value) => value == null || value === "" || Boolean(safeCampaignUrl(value));

  const products = sections["ai-commerce-hub.products.v1"] || [];
  if (products.length > MAX_PRODUCTS) return invalid("contains more than " + MAX_PRODUCTS + " products");
  const productValidator = window.AICommerceProductUtils?.validateProduct;
  if (products.length && typeof productValidator !== "function") return invalid("cannot be checked because product validation is unavailable");
  if (products.some((item) => !isRecord(item) || !productValidator(item).valid)) {
    return invalid("contains an invalid product record");
  }

  const campaignRecords = sections["ai-commerce-hub.campaigns.v1"] || [];
  if (campaignRecords.length > MAX_CAMPAIGNS) return invalid("contains more than " + MAX_CAMPAIGNS + " campaign records");
  const campaignIds = new Set();
  for (const item of campaignRecords) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim() || item.id.length > 100 ||
        campaignIds.has(item.id) || typeof item.productName !== "string" || !item.productName.trim() ||
        item.productName.length > 120 || typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt)) ||
        typeof item.platform !== "string" || item.platform.length > 40 ||
        typeof item.format !== "string" || item.format.length > 40 || !safeOptionalUrl(item.link)) {
      return invalid("contains an invalid or duplicate campaign record");
    }
    campaignIds.add(item.id);
  }

  const candidateRecords = sections["ai-commerce-hub.candidates.v1"] || [];
  if (candidateRecords.length > 50) return invalid("contains more than 50 shortlist candidates");
  for (const item of candidateRecords) {
    if (!isRecord(item) || typeof item.name !== "string" || !item.name.trim() || item.name.length > 120 ||
        !Number.isFinite(item.score) || item.score < 0 || item.score > 100 ||
        !Number.isFinite(item.price) || item.price <= 0 ||
        !(item.inStock === true || item.inStock === false || item.inStock == null) ||
        !safeOptionalUrl(item.url) ||
        (item.checks != null && (!Array.isArray(item.checks) || item.checks.some((entry) => typeof entry !== "string")))) {
      return invalid("contains an invalid shortlist candidate");
    }
    if (item.rating != null && (!Number.isFinite(item.rating) || item.rating < 0 || item.rating > 5)) return invalid("contains an invalid candidate rating");
    if (item.reviews != null && (!Number.isSafeInteger(item.reviews) || item.reviews < 0)) return invalid("contains an invalid candidate review count");
    if (item.commission != null && (!Number.isFinite(item.commission) || item.commission < 0 || item.commission > 100)) return invalid("contains an invalid candidate commission");
    if (item.demand != null && (!Number.isInteger(item.demand) || item.demand < 1 || item.demand > 5)) return invalid("contains an invalid candidate demand signal");
    if (item.competition != null && (!Number.isInteger(item.competition) || item.competition < 1 || item.competition > 5)) return invalid("contains an invalid candidate competition signal");
  }

  const catalogRecords = sections["ai-commerce-hub.catalog-import.v1"] || [];
  const catalogPlatforms = new Set(["Meesho", "Amazon", "Flipkart", "Other"]);
  if (catalogRecords.length > 5000) return invalid("contains more than 5,000 catalogue records");
  for (const item of catalogRecords) {
    if (!isRecord(item) || typeof item.name !== "string" || !item.name.trim() || item.name.length > 120 ||
        !catalogPlatforms.has(item.platform) || !Number.isFinite(item.price) || item.price <= 0 ||
        !Number.isFinite(item.score) || item.score < 0 || item.score > 100 ||
        !Number.isInteger(item.rowNumber) || item.rowNumber < 1 || !safeOptionalUrl(item.url) ||
        !Array.isArray(item.warnings) || item.warnings.some((entry) => typeof entry !== "string") ||
        !Array.isArray(item.recommendationReasons) || item.recommendationReasons.some((entry) => typeof entry !== "string")) {
      return invalid("contains an invalid ranked catalogue record");
    }
  }

  const earningOpportunities = sections["ai-commerce-hub.earning-opportunities.v1"] || [];
  if (earningOpportunities.length > 300) return invalid("contains more than 300 earning opportunities");
  const earningValidator = window.AIEarningEngine?.validateOpportunity;
  if (earningOpportunities.length && typeof earningValidator !== "function") return invalid("cannot be checked because earning validation is unavailable");
  const earningIds = new Set();
  for (const item of earningOpportunities) {
    const checked = isRecord(item) && earningValidator ? earningValidator(item) : { valid: false };
    if (!checked.valid || earningIds.has(item.id)) return invalid("contains an invalid or duplicate earning opportunity");
    earningIds.add(item.id);
  }

  const earningTasks = sections["ai-commerce-hub.earning-tasks.v1"] || [];
  if (earningTasks.length > 1000 || earningTasks.some(item => !isRecord(item) ||
      typeof item.id !== "string" || !item.id.trim() || typeof item.title !== "string" || !item.title.trim() ||
      !["todo", "done"].includes(item.status) || typeof item.requiresApproval !== "boolean")) {
    return invalid("contains invalid earning task records");
  }

  const earningRecords = sections["ai-commerce-hub.earning-records.v1"] || [];
  if (earningRecords.length > 1000 || earningRecords.some(item => !isRecord(item) ||
      typeof item.id !== "string" || !item.id.trim() || typeof item.title !== "string" || !item.title.trim() ||
      !Number.isFinite(item.amount) || item.amount <= 0 || item.amount > 100000000 ||
      item.currency !== "INR" || !["estimated", "confirmed", "paid"].includes(item.status) ||
      (item.evidenceUrl != null && item.evidenceUrl !== "" && !safeOptionalUrl(item.evidenceUrl)))) {
    return invalid("contains invalid earning records");
  }

  return { valid: true };
}

$("exportWorkspaceBackup").addEventListener("click", exportWorkspaceBackup);
$("importWorkspaceBackup").addEventListener("change", async () => {
  const file = $("importWorkspaceBackup").files?.[0];
  if (!file) return;
  if (file.size > MAX_BACKUP_BYTES) {
    $("backupMessage").textContent = "Backup file must be 4 MB or smaller.";
    $("importWorkspaceBackup").value = "";
    return;
  }
  try {
    const payload = JSON.parse(await file.text());
    const validation = validateBackup(payload);
    if (!validation.valid) {
      $("backupMessage").textContent = validation.error;
      return;
    }
    if (!window.confirm("Restore this backup? Included workspace data will be replaced. A legacy backup without ClipReward data keeps your current ClipReward workspace. Export a backup first if you want to keep all current data.")) return;
    // Save previous values so a storage failure cannot leave a partially restored workspace.
    const previous = new Map(BACKUP_KEYS.map((key) => [key, localStorage.getItem(key)]));
    try {
      for (const key of BACKUP_KEYS) {
        if (Object.prototype.hasOwnProperty.call(payload.data, key)) {
          localStorage.setItem(key, JSON.stringify(payload.data[key]));
        } else if (key !== CLIPREWARD_STORAGE_KEY) {
          // Backups created before the combined-workspace update did not contain ClipReward data.
          // Keep the current ClipReward workspace instead of deleting it during a legacy restore.
          localStorage.removeItem(key);
        }
      }
    } catch {
      for (const [key, value] of previous) {
        try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* best-effort rollback */ }
      }
      $("backupMessage").textContent = "Restore failed because browser storage is unavailable or full. Existing data was preserved where possible.";
      return;
    }
    $("backupMessage").textContent = "Backup restored. Reloading workspace…";
    window.location.reload();
  } catch {
    $("backupMessage").textContent = "Could not read this backup file. Check that it is valid JSON.";
  } finally {
    $("importWorkspaceBackup").value = "";
  }
});

const MAX_CAMPAIGNS = 200;
const campaignLoadResult = loadCampaigns();
const campaigns = campaignLoadResult.records;

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
  const list = $("productList");
  list.replaceChildren();
  list.classList.toggle("product-grid", products.length > 0);

  if (!products.length) {
    const empty = document.createElement("div");
    empty.className = "product-empty";
    const icon = document.createElement("span");
    icon.className = "product-empty-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "✦";
    const heading = document.createElement("strong");
    heading.textContent = "Your product studio starts here";
    const copy = document.createElement("p");
    copy.textContent = "Add a product and an optional image URL to build your visual shortlist.";
    empty.append(icon, heading, copy);
    list.append(empty);
    return;
  }

  for (const product of products) {
    const item = document.createElement("article");
    item.className = "product product-card";
    const media = document.createElement("div");
    media.className = "product-media";
    const fallback = document.createElement("div");
    fallback.className = "product-image-fallback";
    fallback.setAttribute("aria-label", "No product image supplied");
    fallback.innerHTML = '<span aria-hidden="true">✦</span><small>PRODUCT</small>';
    media.append(fallback);

    if (product.imageUrl) {
      const image = document.createElement("img");
      image.className = "product-image";
      image.src = product.imageUrl;
      image.alt = product.name;
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("load", () => fallback.remove());
      image.addEventListener("error", () => image.remove());
      media.append(image);
    }

    const body = document.createElement("div");
    body.className = "product-card-body";
    const platform = document.createElement("span");
    platform.className = "product-platform";
    platform.textContent = product.platform;
    const title = document.createElement("h3");
    title.textContent = product.name;
    const link = document.createElement("a");
    link.className = "product-open-link";
    link.href = product.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer sponsored";
    link.textContent = "View product ↗";
    link.addEventListener("click", () => {
      clicks += 1;
      $("clicks").textContent = String(clicks);
    });
    const contentButton = document.createElement("button");
    contentButton.type = "button";
    contentButton.className = "secondary product-content-button";
    contentButton.textContent = "Create content";
    contentButton.addEventListener("click", () => {
      // A saved product link is not evidence of current price, stock, benefits, or performance.
      useCatalogProductInContent({
        name: product.name || "",
        url: safeCampaignUrl(product.url),
        price: "",
        evidenceFreshness: "unknown",
        checkedAt: ""
      });
    });
    const videoButton = document.createElement("button");
    videoButton.type = "button";
    videoButton.className = "secondary product-video-button";
    videoButton.textContent = "Make a video";
    videoButton.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("commerce:prepare-video", {
        detail: {
          name: product.name || "",
          imageUrl: product.imageUrl || "",
          link: product.url || "",
          platform: product.platform || ""
        }
      }));
      $("videoMakerForm").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    const scoreButton = document.createElement("button");
    scoreButton.type = "button";
    scoreButton.className = "secondary";
    scoreButton.textContent = "Score this product";
    scoreButton.addEventListener("click", () => {
      $("candidateName").value = product.name || "";
      $("candidateUrl").value = product.url || "";
      // A saved product link is not proof of current price, commission, stock or demand.
      $("candidateSource").value = "";
      $("candidateCheckedAt").value = "";
      $("candidatePrice").focus();
      $("candidateForm").scrollIntoView({ behavior: "smooth", block: "start" });
      $("candidateName").dispatchEvent(new Event("input", { bubbles: true }));
      $("candidateUrl").dispatchEvent(new Event("input", { bubbles: true }));
      $("candidateSource").dispatchEvent(new Event("input", { bubbles: true }));
      $("candidateCheckedAt").dispatchEvent(new Event("input", { bubbles: true }));
      $("candidateForm").querySelector("button[type='submit']")?.focus({ preventScroll: true });
    });
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "secondary product-remove-button";
    removeButton.textContent = "Remove product";
    removeButton.setAttribute("aria-label", "Remove saved product " + product.name);
    removeButton.addEventListener("click", () => {
      const index = products.indexOf(product);
      if (index < 0) return;
      if (!window.confirm('Remove "' + product.name + '" from this device?')) return;
      products.splice(index, 1);
      if (!saveProducts()) {
        products.splice(index, 0, product);
        render();
        $("message").textContent = "Could not save the removal because browser storage is unavailable or full. The product was kept.";
        return;
      }
      render();
      $("message").textContent = "Product removed from this device.";
    });
    body.append(platform, title, link, contentButton, videoButton, scoreButton, removeButton);
    item.append(media, body);
    list.append(item);
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
    url: $("productUrl").value,
    imageUrl: $("productImageUrl").value
  });
  if (!result.valid) {
    $("message").textContent = result.error;
    return;
  }
  const duplicate = products.some((saved) =>
    saved.platform === result.product.platform && saved.url === result.product.url
  );
  if (duplicate) {
    $("message").textContent = "This product link is already saved for " + result.product.platform + ". Open the saved product instead of adding a duplicate.";
    return;
  }

  if (products.length >= MAX_PRODUCTS) {
    $("message").textContent = "Prototype limit: 100 products.";
    return;
  }

  products.push(result.product);
  if (!saveProducts()) {
    products.pop();
    $("message").textContent = "Browser storage is unavailable or full. Product was not added; your form details were kept so you can retry.";
    return;
  }
  $("productName").value = "";
  $("productUrl").value = "";
  $("productImageUrl").value = "";
  $("message").textContent = "Product added and saved on this device.";
  render();
});


function safeCampaignUrl(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return "";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname && !parsed.username && !parsed.password
      ? parsed.href
      : "";
  } catch {
    return "";
  }
}

function sanitizeCampaignRecords(saved) {
  if (!Array.isArray(saved)) return { records: [], discarded: 0 };
  const seenIds = new Set();
  const records = [];
  let discarded = 0;
  for (const item of saved) {
    if (!item || typeof item.id !== "string" || !item.id.trim() || item.id.length > 100 ||
        typeof item.productName !== "string" || !item.productName.trim() ||
        item.productName.length > 120 || typeof item.createdAt !== "string" ||
        !Number.isFinite(Date.parse(item.createdAt)) ||
        typeof item.platform !== "string" || item.platform.length > 40 ||
        typeof item.format !== "string" || item.format.length > 40) {
      discarded += 1;
      continue;
    }
    if (seenIds.has(item.id)) {
      discarded += 1;
      continue;
    }
    seenIds.add(item.id);
    if (records.length >= MAX_CAMPAIGNS) {
      discarded += 1;
      continue;
    }
    records.push({
      id: item.id,
      createdAt: item.createdAt,
      productName: item.productName.trim(),
      platform: item.platform,
      format: item.format,
      link: safeCampaignUrl(item.link)
    });
  }
  return { records, discarded };
}

function loadCampaigns() {
  try {
    const raw = localStorage.getItem(CAMPAIGN_KEY);
    if (raw === null) return { records: [], discarded: 0, corrupt: false };
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return { records: [], discarded: 0, corrupt: true };
    return { ...sanitizeCampaignRecords(saved), corrupt: false };
  } catch {
    return { records: [], discarded: 0, corrupt: true };
  }
}

function saveCampaigns() {
  try {
    localStorage.setItem(CAMPAIGN_KEY, JSON.stringify(campaigns));
    return true;
  } catch {
    return false;
  }
}

function persistCampaignMigration() {
  if (campaignLoadResult.corrupt) {
    $("campaignMessage").textContent = "The saved campaign register could not be read. It was not overwritten; restore a known-good workspace backup before adding campaigns.";
    return;
  }
  try {
    const raw = localStorage.getItem(CAMPAIGN_KEY);
    if (raw === null || JSON.stringify(JSON.parse(raw)) === JSON.stringify(campaigns)) return;
    if (saveCampaigns()) {
      if (campaignLoadResult.discarded > 0) {
        $("campaignMessage").textContent = campaignLoadResult.discarded +
          " duplicate or invalid old campaign row(s) were removed from the saved register.";
      }
    } else {
      $("campaignMessage").textContent = campaignLoadResult.discarded +
        " duplicate or invalid old campaign row(s) were filtered for this session, but browser storage could not save the cleanup. Full backup export will use the cleaned register.";
    }
  } catch {
    $("campaignMessage").textContent = "The saved campaign register could not be migrated safely. It was not overwritten; export a backup before continuing.";
  }
}
persistCampaignMigration();

function createCampaignId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return "ACH-" + window.crypto.randomUUID();
  }
  return "ACH-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function renderCampaigns() {
  const root = $("campaignList");
  root.replaceChildren();
  if (!campaigns.length) {
    const empty = document.createElement("p");
    empty.textContent = "No campaign records saved yet. Create content, then save it here.";
    root.append(empty);
    return;
  }
  const query = $("campaignSearch").value.trim().toLocaleLowerCase();
  const visibleCampaigns = [...campaigns].reverse().filter((campaign) =>
    [campaign.productName, campaign.platform, campaign.format, campaign.id]
      .some((value) => String(value || "").toLocaleLowerCase().includes(query))
  );
  if (!visibleCampaigns.length) {
    const empty = document.createElement("p");
    empty.textContent = "No campaigns match this search. Try a product name, platform, format or campaign ID.";
    root.append(empty);
    return;
  }
  for (const campaign of visibleCampaigns) {
    const card = document.createElement("article");
    card.className = "candidate-card";
    const heading = document.createElement("h3");
    heading.textContent = campaign.productName + " · " + campaign.format;
    const detail = document.createElement("p");
    detail.textContent = campaign.platform + " · " + new Date(campaign.createdAt).toLocaleString() + " · ID: " + campaign.id;
    const idButton = document.createElement("button");
    idButton.type = "button";
    idButton.className = "secondary";
    idButton.textContent = "Copy campaign ID";
    idButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(campaign.id);
        $("campaignMessage").textContent = "Campaign ID copied. Use it only in an approved campaign/sub-ID field if your programme supports one.";
      } catch {
        $("campaignMessage").textContent = "Campaign ID: " + campaign.id + " (select and copy manually if needed).";
      }
    });
    card.append(heading, detail);
    const safeLink = safeCampaignUrl(campaign.link);
    if (safeLink) {
      const link = document.createElement("a");
      link.href = safeLink;
      link.target = "_blank";
      link.rel = "noopener noreferrer sponsored";
      link.textContent = "Open saved affiliate link";
      card.append(link);
      const copyLinkButton = document.createElement("button");
      copyLinkButton.type = "button";
      copyLinkButton.className = "secondary";
      copyLinkButton.textContent = "Copy affiliate link";
      copyLinkButton.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(safeLink);
          $("campaignMessage").textContent = "Affiliate link copied. Check that the destination and disclosure are correct before publishing.";
        } catch {
          const temporary = document.createElement("textarea");
          temporary.value = safeLink;
          temporary.setAttribute("readonly", "");
          temporary.style.position = "fixed";
          temporary.style.opacity = "0";
          document.body.append(temporary);
          temporary.select();
          let copied = false;
          try {
            copied = document.execCommand("copy");
          } catch {
            copied = false;
          }
          temporary.remove();
          $("campaignMessage").textContent = copied
            ? "Affiliate link copied. Check the destination and disclosure before publishing."
            : "Clipboard unavailable. Open the saved affiliate link and copy its address manually.";
        }
      });
      card.append(copyLinkButton);
    }
    card.append(idButton);
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "secondary";
    deleteButton.textContent = "Delete campaign";
    deleteButton.addEventListener("click", () => {
      if (!window.confirm("Delete this campaign record? Export the register first if you may need it later.")) return;
      const index = campaigns.findIndex((item) => item.id === campaign.id);
      if (index < 0) return;
      campaigns.splice(index, 1);
      const saved = saveCampaigns();
      if (!saved) {
        campaigns.splice(index, 0, campaign);
        renderCampaigns();
        $("campaignMessage").textContent = "Could not save the deletion to browser storage. The campaign was kept.";
        return;
      }
      renderCampaigns();
      $("campaignMessage").textContent = "Campaign record deleted from this device.";
    });
    card.append(deleteButton);
    root.append(card);
  }
}

$("campaignSearch").addEventListener("input", renderCampaigns);

function parseCampaignCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field.length === 0) {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (quoted) throw new Error("The CSV has an unclosed quoted field.");
  if (field.length || row.length) {
    row.push(field);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }
  if (!rows.length) throw new Error("The selected CSV is empty.");
  const headers = rows.shift().map((value) => value.trim().replace(/^\uFEFF/, "").toLowerCase());
  const required = ["campaign_id", "created_at", "product_name", "platform", "format", "affiliate_link"];
  if (headers.length !== required.length || required.some((header, index) => headers[index] !== header)) {
    throw new Error("CSV columns do not match the exported campaign register format.");
  }
  const records = [];
  let skipped = 0;
  for (const values of rows) {
    if (values.length !== required.length) {
      skipped += 1;
      continue;
    }
    const [id, createdAt, productName, platform, format, link] = values;
    if (!id.trim() || id.length > 100 || !productName.trim() || productName.trim().length > 120 ||
        !Number.isFinite(Date.parse(createdAt)) || platform.length > 40 || format.length > 40) {
      skipped += 1;
      continue;
    }
    records.push({
      id: id.trim(),
      createdAt: new Date(createdAt).toISOString(),
      productName: productName.trim(),
      platform: platform.trim(),
      format: format.trim(),
      link: safeCampaignUrl(link.trim())
    });
  }
  return { records, skipped };
}

function csvCell(value) {
  let text = String(value == null ? "" : value);
  // Neutralize spreadsheet formulas in untrusted text before CSV quoting.
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

$("saveContentCampaign").addEventListener("click", () => {
  const content = $("contentOutput").value.trim();
  const productName = $("contentName").value.trim();
  if (!content || !productName) {
    $("campaignMessage").textContent = "Create a content pack and enter its product name before saving a campaign.";
    return;
  }
  if (!requireContentReview("save this campaign")) {
    $("campaignMessage").textContent = "Review and check all four Content Studio checklist items before saving this campaign.";
    return;
  }
  if (campaigns.length >= MAX_CAMPAIGNS) {
    $("campaignMessage").textContent = "Campaign register limit is 200. Export your register before clearing old entries.";
    return;
  }
  const rawLink = $("contentLink").value.trim();
  let safeLink = "";
  if (rawLink) {
    try {
      const parsed = new URL(rawLink);
      if (parsed.protocol === "https:" && parsed.hostname && !parsed.username && !parsed.password) safeLink = parsed.href;
    } catch {
      // Invalid or unsafe links are omitted from the campaign record.
    }
  }
  const campaign = {
    id: createCampaignId(),
    createdAt: new Date().toISOString(),
    productName,
    platform: $("contentPlatform").value,
    format: $("contentType").value,
    link: safeLink
  };
  campaigns.push(campaign);
  if (!saveCampaigns()) {
    campaigns.pop();
    renderCampaigns();
    $("campaignMessage").textContent = "Browser storage is unavailable or full. No campaign was added; your content remains in Content Studio so you can retry.";
    return;
  }
  renderCampaigns();
  $("campaignMessage").textContent = "Campaign saved on this device. ID: " + campaign.id;
});

function uniqueCampaignRecords(records, existingIds) {
  const seenIds = new Set(existingIds || []);
  const unique = [];
  let duplicates = 0;
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record.id !== "string" || !record.id.trim() || seenIds.has(record.id)) {
      duplicates += 1;
      continue;
    }
    seenIds.add(record.id);
    unique.push(record);
  }
  return { records: unique, duplicates };
}

$("importCampaigns").addEventListener("click", async () => {
  const file = $("importCampaignsCsv").files && $("importCampaignsCsv").files[0];
  if (!file) {
    $("campaignMessage").textContent = "Choose a campaign register CSV file first.";
    return;
  }
  if (file.size > 1024 * 1024) {
    $("campaignMessage").textContent = "CSV is larger than 1 MB. Split the export into smaller files and retry.";
    return;
  }
  let parsed;
  try {
    parsed = parseCampaignCsv(await file.text());
  } catch (error) {
    $("campaignMessage").textContent = error.message || "Could not read this campaign CSV.";
    return;
  }
  const deduplicated = uniqueCampaignRecords(parsed.records, campaigns.map((item) => item.id));
  const unique = deduplicated.records;
  const available = Math.max(0, MAX_CAMPAIGNS - campaigns.length);
  const accepted = unique.slice(0, available);
  const duplicates = deduplicated.duplicates;
  if (!accepted.length) {
    $("campaignMessage").textContent = "No new valid campaign records to import. Duplicates: " + duplicates + "; skipped invalid rows: " + parsed.skipped + ".";
    return;
  }
  if (!window.confirm("Import " + accepted.length + " new campaign records? Existing records will be kept.")) return;
  campaigns.push(...accepted);
  if (!saveCampaigns()) {
    const importedIds = new Set(accepted.map((item) => item.id));
    for (let index = campaigns.length - 1; index >= 0; index -= 1) {
      if (importedIds.has(campaigns[index].id)) campaigns.splice(index, 1);
    }
    renderCampaigns();
    $("campaignMessage").textContent = "Import could not be saved to browser storage. Existing records were preserved.";
    return;
  }
  renderCampaigns();
  $("campaignMessage").textContent = "Imported " + accepted.length + " campaign records. Duplicates: " + duplicates +
    "; skipped invalid rows: " + parsed.skipped + (unique.length > accepted.length ? "; register limit reached, some records were not imported." : "") +
    ". Imported data is campaign metadata, not sales analytics.";
  $("importCampaignsCsv").value = "";
});

$("exportCampaigns").addEventListener("click", () => {
  const header = ["campaign_id", "created_at", "product_name", "platform", "format", "affiliate_link"];
  const rows = campaigns.map((item) => [item.id, item.createdAt, item.productName, item.platform, item.format, item.link || ""]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ai-commerce-hub-campaign-register.csv";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $("campaignMessage").textContent = "Exported " + campaigns.length + " campaign records. This file contains campaign metadata, not actual performance results.";
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
  $("exportCandidatesCsv").disabled = candidates.length === 0;
  if (!candidates.length) {
    const empty = document.createElement("p");
    empty.textContent = "No saved candidates yet. Score a product and save it to your shortlist.";
    root.append(empty);
    return;
  }
  const compareCandidates = window.AICommerceDiscovery?.compareCandidatesByReadiness;
  const sortedCandidates = [...candidates].sort(typeof compareCandidates === "function" ? compareCandidates : (a, b) => b.score - a.score);
  for (const candidate of sortedCandidates) {
    const card = document.createElement("div");
    card.className = "candidate-card";
    const title = document.createElement("strong");
    title.textContent = candidate.name + " — " + candidate.score + "/100";
    const details = document.createElement("p");
    details.textContent = candidate.label + " · ₹" + Number(candidate.price).toLocaleString("en-IN") + " · demand " + (Number.isFinite(candidate.demand) ? candidate.demand + "/5" : "not checked") + " · competition " + (Number.isFinite(candidate.competition) ? candidate.competition + "/5" : "not checked") + " · commission " + (Number.isFinite(candidate.commission) && candidate.commission > 0 ? candidate.commission + "%" : "not confirmed");
    const provenance = document.createElement("p");
    provenance.textContent = "Stock: " + (candidate.inStock === true ? "confirmed in stock" : candidate.inStock === false ? "out of stock" : "not checked") + " · Evidence: " + (candidate.evidenceFreshness || "unknown") + " · Source: " + (candidate.source || "not recorded") + " · Checked: " + (candidate.checkedAt || "not recorded");
    const evidence = document.createElement("p");
    evidence.className = "candidate-evidence";
    evidence.textContent = Number.isFinite(candidate.evidenceCoverage) && Number.isFinite(candidate.evidenceCount) && Number.isFinite(candidate.evidenceTotal)
      ? "Evidence coverage: " + candidate.evidenceCoverage + "% (" + candidate.evidenceCount + "/" + candidate.evidenceTotal + " fields) · Confidence: " + (candidate.confidence || "Not available") + ". This is based on entered information, not independently verified marketplace data."
      : "Evidence coverage unavailable for this older saved record. Re-score the product to update its evidence details.";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      const index = candidates.indexOf(candidate);
      if (index < 0) return;
      candidates.splice(index, 1);
      const saved = saveCandidates();
      if (!saved) candidates.splice(index, 0, candidate);
      renderCandidates();
      $("candidateResult").textContent = saved
        ? "Candidate removed and saved on this device."
        : "Could not remove candidate because browser storage is unavailable. The shortlist was restored; try again after freeing storage space.";
    });
    card.append(title, details, provenance, evidence);
    const savedUrl = safeCampaignUrl(candidate.url);
    if (savedUrl) {
      const productLink = document.createElement("a");
      productLink.href = savedUrl;
      productLink.target = "_blank";
      productLink.rel = "noopener noreferrer sponsored";
      productLink.textContent = "Open supplied product link";
      card.append(productLink);
    }
    const recheckButton = document.createElement("button");
    recheckButton.type = "button";
    recheckButton.className = "secondary";
    recheckButton.textContent = "Recheck evidence";
    recheckButton.addEventListener("click", () => {
      // Keep only identity/link; all changeable evidence must be checked again by the user.
      $("candidateName").value = candidate.name || "";
      $("candidateUrl").value = safeCampaignUrl(candidate.url);
      $("candidatePrice").value = "";
      $("candidateCommission").value = "";
      $("candidateRating").value = "";
      $("candidateReviews").value = "";
      $("candidateDemand").value = "";
      $("candidateCompetition").value = "";
      $("candidateStock").value = "";
      $("candidateSource").value = "";
      $("candidateCheckedAt").value = "";
      $("candidateResult").replaceChildren();
      latestCandidate = null;
      $("candidateForm").scrollIntoView({ behavior: "smooth", block: "start" });
      $("candidatePrice").focus({ preventScroll: true });
      $("candidateResult").textContent = "Recheck the current listing and affiliate dashboard. Previous price, commission, rating, reviews, demand, competition, stock, source and date were cleared so old evidence is not reused.";
    });
    const contentButton = document.createElement("button");
    contentButton.type = "button";
    contentButton.className = "secondary";
    contentButton.textContent = "Use in Content Studio";
    contentButton.addEventListener("click", () => useCandidateInContent(candidate));
    card.append(recheckButton, contentButton, remove);
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
    inStock: $("candidateStock").value === "yes" ? true : $("candidateStock").value === "no" ? false : null,
    url: $("candidateUrl").value,
    source: $("candidateSource").value,
    checkedAt: $("candidateCheckedAt").value
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
  const provenance = document.createElement("p");
  provenance.textContent = "Evidence freshness: " + result.candidate.evidenceFreshness + " · Source: " +
    (result.candidate.source || "not recorded") + " · Checked: " + (result.candidate.checkedAt || "not recorded") +
    " · Stock: " + (result.candidate.inStock === true ? "confirmed in stock" : result.candidate.inStock === false ? "out of stock" : "not checked");
  const list = document.createElement("ul");
  for (const check of result.candidate.checks) {
    const item = document.createElement("li");
    item.textContent = check;
    list.append(item);
  }
  card.append(heading, commission, provenance);
  const candidateUrl = safeCampaignUrl(result.candidate.url);
  if (candidateUrl) {
    const productLink = document.createElement("a");
    productLink.href = candidateUrl;
    productLink.target = "_blank";
    productLink.rel = "noopener noreferrer sponsored";
    productLink.textContent = "Open supplied product link";
    card.append(productLink);
  }
  const contentButton = document.createElement("button");
  contentButton.type = "button";
  contentButton.className = "secondary";
  contentButton.textContent = "Use in Content Studio";
  contentButton.addEventListener("click", () => useCandidateInContent(result.candidate));
  card.append(contentButton, list);
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
  if (!saveCandidates()) {
    candidates.pop();
    renderCandidates();
    $("candidateResult").append(document.createTextNode(" Could not save because browser storage is unavailable or full. The shortlist was not changed; this score remains available so you can retry."));
    return;
  }
  renderCandidates();
  $("candidateResult").append(document.createTextNode(" Saved to this device."));
});

let selectedCatalogContentEvidence = null;

function catalogEvidenceSummary(record) {
  const freshness = record.evidenceFreshness || "unknown";
  const source = record.source && record.source.trim() ? record.source.trim() : "not supplied";
  const checkedAt = record.checkedAt || "not supplied";
  const warnings = Array.isArray(record.warnings) ? record.warnings : [];
  return [
    "CATALOG EVIDENCE REVIEW — supplied CSV data only; not independently verified",
    "Evidence freshness: " + freshness,
    "Source: " + source,
    "Date checked: " + checkedAt,
    "Promotion guidance: " + (record.promotionReadiness || "verify before promotion"),
    "Price handling: " + (freshness === "current" && checkedAt !== "not supplied" ? "entered price from supplied catalogue; re-check before posting" : "price omitted because evidence is stale, future-dated or undated"),
    "Do not infer stock, discounts, product benefits or guarantees from this report.",
    warnings.length ? "Catalogue warnings: " + warnings.join("; ") : "Catalogue warnings: none recorded; this is not proof of verification."
  ].join("\n");
}

$("contentName").addEventListener("input", () => {
  if (selectedCatalogContentEvidence && $("contentName").value.trim() !== selectedCatalogContentEvidence.name) {
    selectedCatalogContentEvidence = null;
    $("contentEvidenceStatus").textContent = "Manual product name entered. Catalogue evidence context cleared; verify all details yourself.";
  }
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
    const variants = [
      "HOOK OPTIONS (test one at a time)",
      ...pack.hooks.map((hook, index) => (index + 1) + ". " + hook),
      "",
      "CALL-TO-ACTION OPTIONS",
      ...pack.ctas.map((cta, index) => (index + 1) + ". " + cta)
    ].join("\n");
    const contentDraft = $("contentType").value === "Post"
      ? pack.post + "\n\n---------------- VIDEO PLAN ----------------\n\n" + pack.video + "\n\n---------------- TESTABLE VARIANTS ----------------\n\n" + variants
      : pack.video + "\n\n---------------- POST CAPTION ----------------\n\n" + pack.post + "\n\n---------------- TESTABLE VARIANTS ----------------\n\n" + variants;
    $("contentOutput").value = contentDraft + (selectedCatalogContentEvidence
      ? "\n\n---------------- PRODUCT EVIDENCE GUARDRAILS ----------------\n\n" + catalogEvidenceSummary(selectedCatalogContentEvidence)
      : "\n\nPRODUCT EVIDENCE REMINDER: User-entered details are not independently verified. Confirm current price, stock, features, rights to media and affiliate disclosure before publishing.");
    resetContentReview("New draft created. Review all claims, current price, affiliate disclosure and link, then check all four items before copying, downloading, or saving.");
    draftsCreated += 1;
    $("campaigns").textContent = String(draftsCreated);
    $("contentMessage").textContent = "Draft prepared. Review every product claim and link before posting.";
  } catch (error) {
    $("contentMessage").textContent = error instanceof Error ? error.message : "Could not create content.";
  }
});

function parseBulkContentRows(text) {
  const lines = String(text || "").split(/\\r?\\n/).map((line) => line.trimEnd()).filter((line) => line.trim());
  if (!lines.length) throw new TypeError("Paste at least one product row.");
  if (lines.length > 50) throw new RangeError("Use batches of 50 products or fewer.");
  return lines.map((line, index) => {
    const columns = line.split("\\t").map((value) => value.trim());
    if (columns.length < 2) throw new TypeError("Row " + (index + 1) + " needs a product name and benefit separated by a tab.");
    return { name: columns[0], benefit: columns[1], audience: columns[2] || "", proof: columns[3] || "", price: columns[4] || "", link: columns[5] || "" };
  });
}

$("bulkContentRows").addEventListener("input", () => {
  $("contentOutput").value = "";
  resetContentReview("Bulk product rows changed. Generate the batch again, review the complete draft, then check all four items.");
  $("bulkContentStatus").textContent = "Rows changed. Generate the batch again before exporting.";
});

$("generateBulkContent").addEventListener("click", () => {
  const engine = window.AICommerceDiscovery;
  if (typeof engine?.createBulkContentPacks !== "function") {
    $("bulkContentStatus").textContent = "Bulk content module is unavailable. Refresh the app and try again.";
    return;
  }
  try {
    const rows = parseBulkContentRows($("bulkContentRows").value);
    const packs = engine.createBulkContentPacks(rows, {
      language: $("contentLanguage").value,
      platform: $("contentPlatform").value,
      type: $("contentType").value
    });
    $("contentName").value = "Bulk content batch (" + packs.length + " products)";
    $("contentBenefit").value = "";
    $("contentAudience").value = "";
    $("contentProof").value = "";
    $("contentPrice").value = "";
    $("contentLink").value = "";
    $("contentOutput").value = packs.map(({ name, pack }, index) => {
      const hooks = pack.hooks.map((hook, hookIndex) => (hookIndex + 1) + ". " + hook).join("\\n");
      const ctas = pack.ctas.map((cta, ctaIndex) => (ctaIndex + 1) + ". " + cta).join("\\n");
      return "========== PRODUCT " + (index + 1) + ": " + name + " ==========\\n\\nPOST CAPTION\\n" + pack.post + "\\n\\nVIDEO PLAN\\n" + pack.video + "\\n\\nHOOK OPTIONS\\n" + hooks + "\\n\\nCALL-TO-ACTION OPTIONS\\n" + ctas;
    }).join("\\n\\n\\n");
    resetContentReview("Bulk batch generated. Review every product claim, price, disclosure and link, then check all four items before copying or downloading.");
    draftsCreated += packs.length;
    $("campaigns").textContent = String(draftsCreated);
    $("bulkContentStatus").textContent = "Prepared " + packs.length + " product drafts. Check the full output below and complete the four safety checks before exporting.";
    $("contentMessage").textContent = "Bulk content is ready for review. No footage was generated and nothing was posted.";
    $("contentOutput").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    $("bulkContentStatus").textContent = error instanceof Error ? error.message : "Could not prepare the batch.";
  }
});



const CONTENT_REVIEW_IDS = ["reviewClaims", "reviewPrice", "reviewAffiliate", "reviewLink"];

function contentReviewComplete() {
  const complete = CONTENT_REVIEW_IDS.every((id) => $(id).checked);
  $("contentReviewStatus").textContent = complete
    ? "Checklist marked complete by you. This does not independently verify claims, prices or links."
    : "Review all four items before copying, downloading, or saving this draft. This checklist does not independently verify them.";
  return complete;
}

function resetContentReview(message) {
  CONTENT_REVIEW_IDS.forEach((id) => {
    $(id).checked = false;
  });
  contentReviewComplete();
  if (message) $("contentReviewStatus").textContent = message;
}

function invalidateContentDraftOnInput() {
  const hasDraft = Boolean($("contentOutput").value.trim());
  const hadChecks = CONTENT_REVIEW_IDS.some((id) => $(id).checked);
  if (!hasDraft && !hadChecks) return;
  if (hasDraft) {
    $("contentOutput").value = "";
    $("contentMessage").textContent = "Content inputs changed. Generate a fresh draft before copying, downloading, or saving.";
  }
  resetContentReview("Content details changed. Generate or review the current draft, then check all four items before copying, downloading, or saving.");
}

$("contentForm").addEventListener("input", invalidateContentDraftOnInput);
$("contentForm").addEventListener("change", invalidateContentDraftOnInput);
$("contentOutput").addEventListener("input", () => {
  resetContentReview("Draft text changed. Review the full edited draft and re-check all four items before copying, downloading, or saving.");
});

function requireContentReview(action) {
  if (contentReviewComplete()) return true;
  $("contentMessage").textContent = "Cannot " + action + " yet. Review and check all four items first.";
  const firstUnchecked = CONTENT_REVIEW_IDS.find((id) => !$(id).checked);
  if (firstUnchecked) $(firstUnchecked).focus();
  return false;
}

CONTENT_REVIEW_IDS.forEach((id) => {
  $(id).addEventListener("change", contentReviewComplete);
});

$("copyContent").addEventListener("click", async () => {
  const output = $("contentOutput").value;
  if (!output.trim()) {
    $("contentMessage").textContent = "Create a post or video plan first.";
    return;
  }
  if (!requireContentReview("copy this content")) return;
  try {
    await navigator.clipboard.writeText(output);
    $("contentMessage").textContent = "Content pack copied.";
  } catch {
    $("contentOutput").focus();
    $("contentOutput").select();
    $("contentMessage").textContent = "Automatic copy is unavailable. The text is selected; copy it manually.";
  }
});

$("downloadContent").addEventListener("click", () => {
  const output = $("contentOutput").value;
  if (!output.trim()) {
    $("contentMessage").textContent = "Create a post or video plan before downloading.";
    return;
  }
  if (!requireContentReview("download this content")) return;
  const rawName = $("contentName").value.trim() || "content-pack";
  const safeName = rawName.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "content-pack";
  const blob = new Blob([output + "\n"], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "ai-commerce-" + safeName + ".txt";
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $("contentMessage").textContent = "Content pack downloaded as a text file. Review claims and affiliate disclosure before posting.";
});


const CATALOG_KEY = "ai-commerce-hub.catalog-import.v1";
let latestImportedCatalogRecords = [];
function useCatalogProductInContent(record) {
  selectedCatalogContentEvidence = { ...record, name: record.name || "" };
  $("contentName").value = record.name || "";
  const priceEvidenceIsCurrent = record.evidenceFreshness === "current" && Boolean(record.checkedAt);
  $("contentPrice").value = priceEvidenceIsCurrent && record.price != null ? String(record.price) : "";
  $("contentEvidenceStatus").textContent = catalogEvidenceSummary(record);
  $("contentLink").value = record.url || "";
  // Clear product-specific claims so text from a previously selected item cannot carry over.
  $("contentBenefit").value = "";
  $("contentAudience").value = "";
  $("contentProof").value = "";
  $("contentOutput").value = "";
  resetContentReview("Product selection changed. Generate a fresh draft, then review and check all four items before exporting.");
  $("contentMessage").textContent = priceEvidenceIsCurrent
    ? "Product name and link copied. The supplied price is marked current by its check date, but re-check it before posting; add verified benefits/features."
    : "Product name and link copied. Price left blank because the supplied evidence is stale or undated; re-check price, stock and features before publishing.";
  $("contentForm").scrollIntoView({ behavior: "smooth", block: "start" });
  $("contentBenefit").focus({ preventScroll: true });
}

function exportCandidateShortlistCsv() {
  const status = $("candidateExportStatus");
  if (!candidates.length) {
    status.textContent = "Score and save at least one candidate before exporting the shortlist.";
    return;
  }
  const compareCandidates = window.AICommerceDiscovery?.compareCandidatesByReadiness;
  const ordered = [...candidates].sort(typeof compareCandidates === "function" ? compareCandidates : (a, b) => Number(b.score || 0) - Number(a.score || 0));
  const columns = [
    ["rank", (candidate, index) => index + 1],
    ["product_name", (candidate) => candidate.name],
    ["price", (candidate) => candidate.price],
    ["product_url", (candidate) => safeCampaignUrl(candidate.url)],
    ["commission_percent", (candidate) => Number(candidate.commission) > 0 ? candidate.commission : ""],
    ["rating", (candidate) => candidate.rating == null ? "" : candidate.rating],
    ["review_count", (candidate) => candidate.reviews == null ? "" : candidate.reviews],
    ["demand_signal_1_to_5", (candidate) => candidate.demand == null ? "" : candidate.demand],
    ["competition_1_to_5", (candidate) => candidate.competition == null ? "" : candidate.competition],
    ["stock", (candidate) => candidate.inStock === true ? "yes" : candidate.inStock === false ? "no" : ""],
    ["evidence_source", (candidate) => candidate.source],
    ["checked_at", (candidate) => candidate.checkedAt],
    ["evidence_age_days", (candidate) => candidate.evidenceAgeDays == null ? "" : candidate.evidenceAgeDays],
    ["evidence_freshness", (candidate) => candidate.evidenceFreshness || "unknown"],
    ["evidence_traceable", (candidate) => candidate.evidenceTraceable === true ? "yes" : "no"],
    ["score_out_of_100", (candidate) => candidate.score],
    ["evidence_coverage_percent", (candidate) => candidate.evidenceCoverage],
    ["confidence", (candidate) => candidate.confidence],
    ["review_guidance", (candidate) => candidate.label || "Need more evidence"],
    ["estimated_commission_per_order", (candidate) => candidate.estimatedCommission == null ? "" : candidate.estimatedCommission],
    ["checks_and_warnings", (candidate) => Array.isArray(candidate.checks) ? candidate.checks.join(" | ") : ""]
  ];
  const lines = [
    columns.map(([name]) => csvCell(name)).join(","),
    ...ordered.map((candidate, index) => columns.map(([, value]) => csvCell(value(candidate, index))).join(","))
  ];
  const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ai-commerce-hub-product-shortlist.csv";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = "Product shortlist exported. It contains entered evidence and rule-based guidance, not verified sales predictions.";
}

$("exportCandidatesCsv").addEventListener("click", exportCandidateShortlistCsv);

function useCandidateInContent(candidate) {
  if (!candidate || typeof candidate !== "object") return;
  // Reuse the existing safe hand-off so previous product claims and review checks are cleared.
  useCatalogProductInContent({
    name: typeof candidate.name === "string" ? candidate.name : "",
    price: candidate.price == null || !Number.isFinite(Number(candidate.price)) ? "" : Number(candidate.price),
    url: safeCampaignUrl(candidate.url)
  });
}

function renderImportedCatalog(records, errors = []) {
  latestImportedCatalogRecords = Array.isArray(records) ? records : [];
  const root = $("catalogResults");
  root.replaceChildren();
  $("exportCatalogReport").disabled = !Array.isArray(records) || records.length === 0;
  const summary = document.createElement("p");
  summary.textContent = "Ranked " + records.length + " valid products. Highest evidence-readiness first; scores are not a sales guarantee.";
  root.append(summary);
  const importer = window.AICommerceCatalogImport;
  if (importer && typeof importer.summarizeCatalogRecords === "function") {
    const audit = importer.summarizeCatalogRecords(records);
    const auditPanel = document.createElement("section");
    auditPanel.className = "notice";
    const auditHeading = document.createElement("h3");
    auditHeading.textContent = "Catalogue evidence audit";
    const auditDetails = document.createElement("p");
    auditDetails.textContent =
      "Ready for a small test: " + audit.readyForSmallTest +
      " · Test cautiously: " + audit.testCautiously +
      " · Verify before promotion: " + audit.verifyBeforePromotion +
      " · Do not promote yet: " + audit.doNotPromoteYet +
      " · Stale evidence: " + audit.staleEvidence +
      " · Future-dated evidence: " + audit.futureDatedEvidence +
      " · Unknown freshness: " + audit.unknownFreshness +
      " · Possible duplicate URLs: " + audit.duplicateUrls +
      " · Possible duplicate names: " + audit.duplicateNames +
      " · Rows with orders: " + audit.withOrders +
      " · Clicks but no orders: " + audit.clicksWithoutOrders +
      " · No sales metrics: " + audit.withoutSalesMetrics +
      " · Out of stock: " + audit.outOfStock +
      " · Missing source: " + audit.missingSource +
      " · Missing link: " + audit.missingLink + ".";
    const auditAction = document.createElement("p");
    auditAction.textContent = audit.staleEvidence + audit.futureDatedEvidence + audit.unknownFreshness > 0
      ? "Priority action: re-check stale, future-dated or undated evidence before making a promotion decision."
      : audit.withoutSalesMetrics > 0
        ? "Priority action: collect comparable click/order data where available; catalogue quality alone does not establish buyer demand."
        : audit.duplicateUrls + audit.duplicateNames > 0
          ? "Priority action: review possible duplicates and confirm whether rows are variants or separate seller offers."
          : "Priority action: review row warnings and verify current price, stock and commission before promotion.";
    auditPanel.append(auditHeading, auditDetails, auditAction);
    root.append(auditPanel);
  }
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
      (record.periodDays ? " · " + record.periodDays + "-day period" : " · period not confirmed") + returnsText +
      (record.source ? " · Source: " + record.source : " · Source not recorded") +
      (record.checkedAt ? " · Checked: " + record.checkedAt : " · Check date not recorded") +
      " · Evidence freshness: " + (record.evidenceFreshness || "unknown");
    const evidence = document.createElement("p");
    const qualityLabels = {
      Complete: "Data completeness: complete (clicks, orders and period supplied)",
      Partial: "Data completeness: partial (reporting period missing)",
      Limited: "Data completeness: limited (metrics missing or need verification)",
      Unverified: "Data completeness: unverified (no clicks/orders supplied)"
    };
    const dailyMetrics = [];
    if (record.ordersPerDay !== null && record.ordersPerDay !== undefined) {
      dailyMetrics.push((Math.round(record.ordersPerDay * 100) / 100) + " orders/day");
    }
    if (record.clicksPerDay !== null && record.clicksPerDay !== undefined) {
      dailyMetrics.push((Math.round(record.clicksPerDay * 100) / 100) + " clicks/day");
    }
    if (record.conversionRate !== null && record.conversionRate !== undefined && record.clicks > 0 && record.orders <= record.clicks) {
      dailyMetrics.push((Math.round(record.conversionRate * 1000) / 10) + "% orders/clicks");
    }
    evidence.textContent = (qualityLabels[record.evidenceQuality] || qualityLabels.Limited) +
      (dailyMetrics.length ? " · " + dailyMetrics.join(" · ") : "");
    const readiness = document.createElement("p");
    readiness.textContent = "Promotion guidance: " + record.promotionReadiness +
      ". This is a rule-based caution, not a sales prediction.";
    const estimate = document.createElement("p");
    estimate.textContent = "Estimated commission per qualifying order: ₹" +
      Number(record.estimatedCommissionPerOrder || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 }) +
      (record.estimatedCommissionAfterReturns !== null && record.estimatedCommissionAfterReturns !== undefined
        ? " · Illustrative estimate after supplied returns: ₹" + Number(record.estimatedCommissionAfterReturns).toLocaleString("en-IN", { maximumFractionDigits: 2 })
        : " · After-return estimate unavailable");
    const estimateNote = document.createElement("p");
    estimateNote.textContent = "Estimates use entered price and commission; actual payouts depend on affiliate rules, cancellations and attribution.";
    const rationaleHeading = document.createElement("strong");
    rationaleHeading.textContent = "Why this guidance?";
    const rationale = document.createElement("ul");
    for (const reason of (record.recommendationReasons || [])) {
      const li = document.createElement("li");
      li.textContent = reason;
      rationale.append(li);
    }
    const nextAction = document.createElement("p");
    nextAction.textContent = "Next step: " + (record.nextAction || "Verify the product details before promotion.");
    const warnings = document.createElement("ul");
    for (const warning of record.warnings) {
      const li = document.createElement("li");
      li.textContent = warning;
      warnings.append(li);
    }
    card.append(heading, details, evidence, readiness, estimate, estimateNote, rationaleHeading, rationale, nextAction);
    if (record.url) {
      const link = document.createElement("a");
      link.href = record.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer sponsored";
      link.textContent = "Open supplied product link";
      card.append(link);
    }
    card.append(warnings);
    const contentButton = document.createElement("button");
    contentButton.type = "button";
    contentButton.className = "secondary";
    contentButton.textContent = "Use in Content Studio";
    contentButton.addEventListener("click", () => useCatalogProductInContent(record));
    card.append(contentButton);
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

function exportRankedCatalogReport() {
  const button = $("exportCatalogReport");
  try {
    const records = latestImportedCatalogRecords.length
      ? latestImportedCatalogRecords
      : JSON.parse(localStorage.getItem(CATALOG_KEY) || "[]");
    const exporter = window.AICommerceCatalogImport?.catalogRecordsToCsv;
    if (!Array.isArray(records) || records.length === 0 || typeof exporter !== "function") {
      $("catalogMessage").textContent = "Import and rank a valid product CSV before exporting a report.";
      if (button) button.disabled = true;
      return;
    }
    const csv = exporter(records);
    if (!csv) {
      $("catalogMessage").textContent = "No ranked product data is available to export.";
      return;
    }
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ai-commerce-hub-ranked-catalog-report.csv";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("catalogMessage").textContent = "Ranked catalog report downloaded. It contains supplied data and rule-based guidance, not a sales guarantee.";
  } catch {
    $("catalogMessage").textContent = "Could not export the ranked catalog report. Re-import the CSV and try again.";
  }
}

$("exportCatalogReport").addEventListener("click", exportRankedCatalogReport);

$("downloadCatalogTemplate").addEventListener("click", () => {
  const template = "name,platform,url,price,commission,rating,reviews,clicks,orders,returns,period_days,stock,source,checked_at\n";
  const blob = new Blob([template], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ai-commerce-hub-catalog-template.csv";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$("catalogForm").addEventListener("submit", (event) => {
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
      latestImportedCatalogRecords = [];
      $("exportCatalogReport").disabled = true;
      $("catalogMessage").textContent = result.error;
      return;
    }
    renderImportedCatalog(result.records, result.errors);
  };
  reader.onerror = () => { latestImportedCatalogRecords = []; $("exportCatalogReport").disabled = true; $("catalogMessage").textContent = "Could not read the selected CSV file."; };
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
renderCampaigns();

render();


$("campaignReportForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  latestCampaignReport = null;
  $("exportCampaignReport").disabled = true;
  const file = $("campaignReportCsv").files?.[0];
  const root = $("campaignReportResults");
  root.replaceChildren();
  if (!file) {
    $("campaignReportMessage").textContent = "Choose a performance CSV first.";
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    $("campaignReportMessage").textContent = "Performance CSV must be 2 MB or smaller.";
    return;
  }
  try {
    const importer = window.AICommerceCampaignReport;
    if (typeof importer?.parseCampaignReport !== "function") {
      $("campaignReportMessage").textContent = "Campaign report importer did not load. Refresh and try again.";
      return;
    }
    const result = importer.parseCampaignReport(await file.text(), campaigns);
    if (!result.valid) {
      $("campaignReportMessage").textContent = result.error;
      return;
    }
    latestCampaignReport = result;
    $("exportCampaignReport").disabled = false;
    $("campaignReportMessage").textContent =
      "Data quality: " + (result.dataQuality.status === "clean" ? "no detected issues" : "review recommended") +
      ". Imported " + result.importedRows + " valid rows across " + result.reports.length +
      " campaign/period group(s). " + result.dataQuality.duplicateRows + " exact duplicate row(s) skipped; " +
      result.dataQuality.skippedRows + " row(s) skipped; " + result.dataQuality.warningCount +
      " campaign warning(s). Results come from your CSV and are not independently verified.";
    for (const report of result.reports) {
      const card = document.createElement("article");
      card.className = "candidate-card";
      const heading = document.createElement("h3");
      heading.textContent = report.campaignId;
      const attribution = document.createElement("p");
      attribution.textContent = report.matched
        ? "Attribution match: exact ID found in this workspace."
        : "Attribution unavailable: no exact match to a saved campaign.";
      const period = document.createElement("p");
      period.textContent = "Reporting period: " + report.periodStart + " to " + report.periodEnd;
      const metrics = document.createElement("p");
      metrics.textContent = "Clicks: " + report.clicks + " · Orders: " + report.orders +
        (report.conversionRate !== null ? " · Orders/clicks: " + (report.conversionRate * 100).toFixed(2) + "%" : " · Conversion: unavailable / requires verification") +
        (report.commission !== null ? " · Reported commission: ₹" + report.commission.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : " · Commission: not fully supplied") +
        (report.returns !== null ? " · Returns: " + report.returns : " · Returns: not fully supplied") +
        (report.returnRate !== null ? " · Return rate: " + (report.returnRate * 100).toFixed(2) + "%" : "");
      card.append(heading, attribution, period, metrics);
      if (report.warnings.length) {
        const list = document.createElement("ul");
        for (const warning of report.warnings) {
          const item = document.createElement("li");
          item.textContent = warning;
          list.append(item);
        }
        card.append(list);
      }
      root.append(card);
    }
    const comparisons = importer.compareCampaignReports(result.reports);
    if (comparisons.length) {
      const comparisonHeading = document.createElement("h3");
      comparisonHeading.textContent = "Comparable campaign periods";
      const comparisonNote = document.createElement("p");
      comparisonNote.textContent = "Only exact matching date ranges and campaign IDs saved in this workspace are shown. This is a side-by-side comparison, not proof that one campaign caused better results.";
      root.append(comparisonHeading, comparisonNote);
      for (const comparison of comparisons) {
        const section = document.createElement("section");
        section.className = "candidate-card";
        const title = document.createElement("h4");
        title.textContent = comparison.periodStart + " to " + comparison.periodEnd;
        const table = document.createElement("table");
        const head = document.createElement("thead");
        const headerRow = document.createElement("tr");
        for (const label of ["Campaign ID", "Clicks", "Orders", "Orders/clicks", "Reported commission", "Returns"]) {
          const cell = document.createElement("th");
          cell.scope = "col";
          cell.textContent = label;
          headerRow.append(cell);
        }
        head.append(headerRow);
        const body = document.createElement("tbody");
        for (const report of comparison.campaigns) {
          const row = document.createElement("tr");
          const values = [
            report.campaignId,
            String(report.clicks),
            String(report.orders),
            report.conversionRate === null ? "Unavailable" : (report.conversionRate * 100).toFixed(2) + "%",
            report.commission === null ? "Incomplete / unavailable" : "₹" + report.commission.toLocaleString("en-IN", { maximumFractionDigits: 2 }),
            report.returns === null ? "Incomplete / unavailable" : String(report.returns)
          ];
          for (const value of values) {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.append(cell);
          }
          body.append(row);
        }
        table.append(head, body);
        section.append(title, table);
        const insightHeading = document.createElement("h5");
        insightHeading.textContent = "Data-based observations";
        const insightList = document.createElement("ul");
        for (const observation of importer.summarizeCampaignComparison(comparison)) {
          const item = document.createElement("li");
          item.textContent = observation;
          insightList.append(item);
        }
        section.append(insightHeading, insightList);
        root.append(section);
      }
    } else {
      const note = document.createElement("p");
      note.textContent = "Campaign comparison will appear when at least two saved campaign IDs have reports for the exact same start and end dates. Unmatched IDs and different date ranges are not compared.";
      root.append(note);
    }
    if (result.errors.length) {
      const heading = document.createElement("h3");
      heading.textContent = "Rows needing attention";
      const list = document.createElement("ul");
      for (const error of result.errors.slice(0, 20)) {
        const item = document.createElement("li");
        item.textContent = error;
        list.append(item);
      }
      root.append(heading, list);
    }
  } catch {
    $("campaignReportMessage").textContent = "Could not read this performance CSV. Check the file and try again.";
  } finally {
    $("campaignReportCsv").value = "";
  }
});

$("exportCampaignReport").addEventListener("click", () => {
  if (!latestCampaignReport || !Array.isArray(latestCampaignReport.reports)) {
    $("campaignReportMessage").textContent = "Import a valid campaign report before exporting results.";
    return;
  }
  const header = ["campaign_id", "period_start", "period_end", "matched_saved_campaign", "clicks", "orders", "conversion_rate_percent", "commission", "returns", "return_rate_percent", "warnings"];
  const rows = latestCampaignReport.reports.map((report) => [
    report.campaignId,
    report.periodStart,
    report.periodEnd,
    report.matched ? "yes" : "no",
    report.clicks,
    report.orders,
    report.conversionRate === null ? "" : (report.conversionRate * 100).toFixed(2),
    report.commission === null ? "" : report.commission,
    report.returns === null ? "" : report.returns,
    report.returnRate === null ? "" : (report.returnRate * 100).toFixed(2),
    report.warnings.join(" | ")
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\\r\\n") + "\\r\\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ai-commerce-hub-campaign-performance.csv";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $("campaignReportMessage").textContent = "Exported the imported report analysis. Values come from your CSV; unmatched attribution and warnings remain visible in the export.";
});
