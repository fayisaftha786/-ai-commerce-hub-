(function initAppHealth(root, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) api.init(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function createAppHealth() {
  "use strict";

  const MODULES = [
    ["Product validation", "AICommerceProductUtils"],
    ["Offer analysis", "AICommerceOfferEngine"],
    ["Product discovery", "AICommerceDiscovery"],
    ["Catalogue importer", "AICommerceCatalogImport"],
    ["Campaign reporting", "AICommerceCampaignReport"]
  ];
  const CONTROLS = [
    ["Product workspace", "productForm"],
    ["Marketplace search", "marketplaceSearchForm"],
    ["Manual product discovery", "candidateForm"],
    ["Catalogue import", "catalogForm"],
    ["Content Studio", "contentForm"],
    ["Campaign report", "campaignReportForm"],
    ["Social analytics", "socialAnalyticsForm"],
    ["Browser video maker", "videoMakerForm"],
    ["PWA install control", "installAppButton"]
  ];

  function collectEnvironmentChecks(environment) {
    const root = environment || {};
    const document = root.document || {};
    const checks = [];
    const add = (state, title, detail) => checks.push({ state, title, detail });

    const location = root.location || {};
    const isSecure = root.isSecureContext === true ||
      location.protocol === "https:" ||
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1" ||
      location.hostname === "[::1]";
    add(isSecure ? "pass" : "warn", "Secure browser context",
      isSecure
        ? "This page is in a secure context; PWA and service-worker features may be available."
        : "This page is not HTTPS/localhost. Publish over HTTPS to enable PWA installation and offline caching.");

    try {
      const storage = root.localStorage;
      const key = "__aiCommerceSelfCheck__";
      if (!storage || typeof storage.setItem !== "function" || typeof storage.getItem !== "function") {
        throw new Error("Browser storage is not available.");
      }
      storage.setItem(key, "ok");
      const roundTrip = storage.getItem(key);
      storage.removeItem(key);
      if (roundTrip !== "ok") throw new Error("Stored test value did not round-trip.");
      add("pass", "Browser storage", "Local storage accepted and returned a temporary test value.");
    } catch {
      try { root.localStorage?.removeItem?.("__aiCommerceSelfCheck__"); } catch { /* best effort cleanup */ }
      add("warn", "Browser storage", "Local storage is blocked or full. Saved items may not persist; export a backup when storage works.");
    }

    for (const [label, name] of MODULES) {
      add(root[name] ? "pass" : "fail", label,
        root[name] ? "The main JavaScript module is available." : "The module is missing. Refresh the page online and check its script file.");
    }

    for (const [label, id] of CONTROLS) {
      add(document.getElementById && document.getElementById(id) ? "pass" : "fail", label + " form/control",
        document.getElementById && document.getElementById(id)
          ? "The required interface element exists."
          : "The interface element is missing from this page.");
    }

    const manifest = document.querySelector && document.querySelector('link[rel="manifest"]');
    add(manifest ? "pass" : "warn", "PWA manifest",
      manifest ? "The page links to its web app manifest." : "The manifest link is missing; installability may be reduced.");

    const serviceWorkerSupported = Boolean(root.navigator &&
      root.navigator.serviceWorker &&
      typeof root.navigator.serviceWorker.getRegistration === "function");
    add(serviceWorkerSupported ? "pass" : "warn", "Service-worker support",
      serviceWorkerSupported
        ? "This browser exposes the service-worker API; registration still needs to be confirmed."
        : "This browser or page context does not expose service workers.");

    add("info", "External integrations",
      "Live marketplace data APIs, a live AI text API, and automatic social publishing are not connected by this self-check. Search links and user-supplied CSV imports are the current data workflow.");
    return checks;
  }

  async function checkServiceWorkerRegistration(root) {
    if (!root.navigator?.serviceWorker ||
        typeof root.navigator.serviceWorker.getRegistration !== "function") {
      return {
        state: "warn",
        title: "Offline cache registration",
        detail: "No service-worker registration API is available in this browser context."
      };
    }
    try {
      const registration = await root.navigator.serviceWorker.getRegistration();
      if (!registration) {
        return {
          state: "warn",
          title: "Offline cache registration",
          detail: "No service worker is registered yet. Open the published HTTPS site online and reload it."
        };
      }
      if (registration.active) {
        return {
          state: "pass",
          title: "Offline cache registration",
          detail: "A service worker is active. Offline availability still depends on the required files having cached successfully."
        };
      }
      return {
        state: "warn",
        title: "Offline cache registration",
        detail: "The service worker exists but is not active yet. Keep the page online and reload after installation completes."
      };
    } catch {
      return {
        state: "warn",
        title: "Offline cache registration",
        detail: "The browser could not inspect the service-worker registration. Check secure-context and browser settings."
      };
    }
  }

  function renderChecks(root, checks) {
    const document = root.document;
    const results = document.getElementById("appHealthResults");
    const summary = document.getElementById("appHealthSummary");
    results.replaceChildren();

    const totals = {
      pass: checks.filter((check) => check.state === "pass").length,
      warn: checks.filter((check) => check.state === "warn").length,
      fail: checks.filter((check) => check.state === "fail").length,
      info: checks.filter((check) => check.state === "info").length
    };
    for (const check of checks) {
      const item = document.createElement("li");
      item.className = "health-" + check.state;
      const heading = document.createElement("strong");
      heading.textContent = (check.state === "pass" ? "PASS" :
        check.state === "warn" ? "CHECK" :
        check.state === "fail" ? "ISSUE" : "INFO") + " — " + check.title + ": ";
      item.append(heading, document.createTextNode(check.detail));
      results.append(item);
    }
    summary.textContent = totals.fail === 0
      ? "Self-check complete: " + totals.pass + " passed, " + totals.warn + " warnings, " + totals.info + " information notes."
      : "Self-check found " + totals.fail + " issue(s): " + totals.pass + " passed, " + totals.warn + " warnings. Fix the issues and run it again.";
    return totals;
  }

  async function runSelfCheck(root) {
    const checks = collectEnvironmentChecks(root);
    checks.push(await checkServiceWorkerRegistration(root));
    return renderChecks(root, checks);
  }

  function init(root) {
    const button = root.document.getElementById("runAppHealthCheck");
    const summary = root.document.getElementById("appHealthSummary");
    if (!button || !summary) return;
    button.addEventListener("click", async () => {
      button.disabled = true;
      summary.textContent = "Checking browser and app readiness…";
      try {
        await runSelfCheck(root);
      } catch {
        summary.textContent = "Self-check could not finish. Reload the app and try again.";
      } finally {
        button.disabled = false;
      }
    });
  }

  return { collectEnvironmentChecks, checkServiceWorkerRegistration, renderChecks, runSelfCheck, init };
});
