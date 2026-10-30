"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { collectEnvironmentChecks, checkServiceWorkerRegistration } = require("../app-health");

function makeEnvironment(overrides = {}) {
  const ids = new Set([
    "productForm", "marketplaceSearchForm", "candidateForm", "catalogForm",
    "contentForm", "campaignReportForm", "socialAnalyticsForm", "videoMakerForm",
    "installAppButton", "generateVideoScript", "recordVoiceStart", "copyVideoCaption"
  ]);
  const values = new Map();
  const storage = {
    setItem(key, value) { values.set(key, String(value)); },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    removeItem(key) { values.delete(key); }
  };
  return {
    isSecureContext: true,
    location: { protocol: "https:", hostname: "example.github.io" },
    localStorage: storage,
    navigator: { serviceWorker: { getRegistration: async () => ({ active: {} }) } },
    MediaRecorder: function MediaRecorder() {},
    HTMLCanvasElement: { prototype: { captureStream() {} } },
    document: {
      getElementById(id) { return ids.has(id) ? { id } : null; },
      querySelector(selector) {
        return ['link[rel="manifest"]', 'script[src="video-maker.js"]', 'script[src="pwa-install.js"]', 'script[src="app.js"]', 'script[data-register-service-worker]'].includes(selector) ? {} : null;
      }
    },
    AICommerceProductUtils: { validateProduct() {} },
    AICommerceOfferEngine: { analyzeOffer() {}, createPromoCopy() {} },
    AICommerceDiscovery: { scoreCandidate() {}, createContentPack() {}, compareCandidatesByReadiness() {} },
    AICommerceCatalogImport: { rankCatalogCsv() {}, catalogRecordsToCsv() {} },
    AICommerceCampaignReport: { parseCampaignReport() {}, compareCampaignReports() {}, summarizeCampaignComparison() {} },
    AICommerceMarketplaceSearch: { buildMarketplaceSearches() {} },
    AICommerceSocialCenter: { analyzeSocialMetrics() {} },
    AICommerceVideoStudio: { generateScript() {} },
    ClipRewardCore: { parseBackup() {} },
    ...overrides
  };
}

test("self-check passes when secure context, storage, modules, and key forms are present", () => {
  const checks = collectEnvironmentChecks(makeEnvironment());
  assert.ok(checks.length >= 19);
  assert.ok(checks.every((check) => ["pass", "warn", "fail", "info"].includes(check.state)));
  assert.ok(checks.some((check) => check.title === "Secure browser context" && check.state === "pass"));
  assert.ok(checks.some((check) => check.title === "Browser storage" && check.state === "pass"));
  assert.ok(checks.some((check) => check.title === "Product discovery" && check.state === "pass"));
  assert.ok(checks.some((check) => check.title === "Marketplace search" && check.state === "pass"));
  assert.ok(checks.some((check) => check.title === "Social media workflow" && check.state === "pass"));
  assert.ok(checks.some((check) => check.title === "Reels & Shorts studio" && check.state === "pass"));
  assert.ok(checks.some((check) => check.title === "ClipReward backup validation" && check.state === "pass"));
  assert.ok(checks.some((check) => check.title === "Manual product discovery form/control" && check.state === "pass"));
  assert.ok(checks.some((check) => check.title === "Video maker script wiring" && check.state === "pass"));
  assert.ok(checks.some((check) => check.title === "PWA install script wiring" && check.state === "pass"));
  assert.ok(checks.some((check) => check.title === "Browser video export capability" && check.state === "pass"));
  assert.ok(checks.some((check) => check.title === "External integrations" && check.state === "info"));
});

test("self-check surfaces missing modules, missing forms and insecure context", () => {
  const environment = makeEnvironment({
    isSecureContext: false,
    location: { protocol: "http:", hostname: "example.com" },
    AICommerceDiscovery: undefined,
    AICommerceMarketplaceSearch: undefined,
    AICommerceSocialCenter: undefined,
    AICommerceVideoStudio: undefined,
    ClipRewardCore: undefined,
    document: {
      getElementById(id) { return id === "candidateForm" ? null : { id }; },
      querySelector() { return null; }
    }
  });
  const checks = collectEnvironmentChecks(environment);
  assert.ok(checks.some((check) => check.title === "Secure browser context" && check.state === "warn"));
  assert.ok(checks.some((check) => check.title === "Product discovery" && check.state === "fail"));
  assert.ok(checks.some((check) => check.title === "Marketplace search" && check.state === "fail"));
  assert.ok(checks.some((check) => check.title === "Social media workflow" && check.state === "fail"));
  assert.ok(checks.some((check) => check.title === "Reels & Shorts studio" && check.state === "fail"));
  assert.ok(checks.some((check) => check.title === "ClipReward backup validation" && check.state === "fail"));
  assert.ok(checks.some((check) => check.title === "Manual product discovery form/control" && check.state === "fail"));
  assert.ok(checks.some((check) => check.title === "PWA manifest" && check.state === "warn"));
});

test("self-check detects a loaded module with missing public functions", () => {
  const environment = makeEnvironment({
    AICommerceCatalogImport: { rankCatalogCsv() {} },
    AICommerceSocialCenter: {}
  });
  const checks = collectEnvironmentChecks(environment);
  assert.ok(checks.some((check) => check.title === "Catalogue importer" && check.state === "fail" && /catalogRecordsToCsv/.test(check.detail)));
  assert.ok(checks.some((check) => check.title === "Social media workflow" && check.state === "fail" && /analyzeSocialMetrics/.test(check.detail)));
});

test("self-check warns if browser local storage is blocked", () => {
  const environment = makeEnvironment({
    localStorage: { setItem() { throw new Error("blocked"); }, getItem() { return null; }, removeItem() {} }
  });
  const checks = collectEnvironmentChecks(environment);
  assert.ok(checks.some((check) => check.title === "Browser storage" && check.state === "warn"));
});

test("service-worker check distinguishes registered and missing offline setup", async () => {
  const active = await checkServiceWorkerRegistration(makeEnvironment());
  assert.equal(active.state, "pass");
  assert.match(active.detail, /service worker is active/i);
  const missing = await checkServiceWorkerRegistration(makeEnvironment({
    navigator: { serviceWorker: { getRegistration: async () => undefined } }
  }));
  assert.equal(missing.state, "warn");
  assert.match(missing.detail, /No service worker is registered/i);
});


test("self-check warns when browser video export APIs are unavailable", () => {
  const checks = collectEnvironmentChecks(makeEnvironment({ MediaRecorder: undefined, HTMLCanvasElement: undefined }));
  assert.ok(checks.some((check) => check.title === "Browser video export capability" && check.state === "warn"));
});

test("self-check catches missing video-maker and install helper script tags", () => {
  const environment = makeEnvironment({
    document: {
      getElementById(id) { return new Set(["productForm", "marketplaceSearchForm", "candidateForm", "catalogForm", "contentForm", "campaignReportForm", "socialAnalyticsForm", "videoMakerForm", "installAppButton"]).has(id) ? { id } : null; },
      querySelector(selector) { return ['link[rel="manifest"]', 'script[src="app.js"]', 'script[data-register-service-worker]'].includes(selector) ? {} : null; }
    }
  });
  const checks = collectEnvironmentChecks(environment);
  assert.ok(checks.some((check) => check.title === "Video maker script wiring" && check.state === "fail"));
  assert.ok(checks.some((check) => check.title === "PWA install script wiring" && check.state === "warn"));
});
