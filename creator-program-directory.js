(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) api.init(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const APPROVED_HOSTS = new Set(["support.google.com", "about.fb.com"]);

  function safeSourceUrl(value) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol !== "https:" || !APPROVED_HOSTS.has(url.hostname.toLowerCase()) ||
          url.username || url.password || (url.port && url.port !== "443")) return "";
      return url.href;
    } catch (_) {
      return "";
    }
  }

  function normalizeSnapshot(value) {
    if (!value || typeof value !== "object" || value.schemaVersion !== 1 ||
        value.country !== "IN" || !Array.isArray(value.sources) || value.sources.length > 12) {
      throw new Error("The official creator-program source report has an unrecognised format.");
    }
    const sources = value.sources.map((row) => {
      if (!row || typeof row !== "object") return null;
      const sourceUrl = safeSourceUrl(row.sourceUrl);
      const status = ["available", "unavailable", "not_checked"].includes(row.status) ? row.status : "not_checked";
      if (!sourceUrl || !/^[a-z0-9-]{2,80}$/i.test(String(row.id || ""))) return null;
      return {
        id: String(row.id).slice(0, 80),
        platform: String(row.platform || "").slice(0, 40),
        program: String(row.program || "").slice(0, 120),
        programType: String(row.programType || "").slice(0, 40),
        sourceUrl,
        sourceLabel: String(row.sourceLabel || "Official source").slice(0, 120),
        accountCheck: String(row.accountCheck || "").slice(0, 160),
        indiaNote: String(row.indiaNote || "").slice(0, 320),
        limitation: String(row.limitation || "").slice(0, 320),
        status,
        checkedAt: String(row.checkedAt || "").slice(0, 40),
        httpStatus: Number.isInteger(row.httpStatus) ? row.httpStatus : null,
        pageTitle: String(row.pageTitle || "").slice(0, 180),
        pageDescription: String(row.pageDescription || "").slice(0, 500),
        ruleEvidence: Array.isArray(row.ruleEvidence) ? row.ruleEvidence.slice(0, 12).filter((item) =>
          item && typeof item === "object" && /^[a-z0-9-]{2,80}$/i.test(String(item.key || ""))
        ).map((item) => ({
          key: String(item.key).slice(0, 80),
          label: String(item.label || "Public rule signal").slice(0, 100),
          excerpt: String(item.excerpt || "").slice(0, 360),
          interpretation: String(item.interpretation || "").slice(0, 320)
        })) : [],
        error: String(row.error || "").slice(0, 240)
      };
    }).filter(Boolean);
    if (!sources.length) throw new Error("The official creator-program source report has no valid sources.");
    const status = ["success", "partial", "failed", "pending"].includes(value.status) ? value.status : "pending";
    const generatedAt = typeof value.generatedAt === "string" ? value.generatedAt.slice(0, 40) : "";
    const summary = value.summary && typeof value.summary === "object" ? value.summary : {};
    return {
      status,
      generatedAt,
      summary: {
        sourcesAttempted: Number.isInteger(summary.sourcesAttempted) ? summary.sourcesAttempted : sources.length,
        sourcesAvailable: Number.isInteger(summary.sourcesAvailable) ? summary.sourcesAvailable : 0,
        sourcesUnavailable: Number.isInteger(summary.sourcesUnavailable) ? summary.sourcesUnavailable : 0,
        sourcesWithRuleEvidence: Number.isInteger(summary.sourcesWithRuleEvidence) ? summary.sourcesWithRuleEvidence : 0,
        ruleEvidenceCount: Number.isInteger(summary.ruleEvidenceCount) ? summary.ruleEvidenceCount : 0
      },
      sources
    };
  }

  function statusLabel(source) {
    if (source.status === "available") return "Official page reachable";
    if (source.status === "unavailable") return "Official page not reachable";
    return "Not checked yet";
  }

  function renderSnapshot(document, container, statusNode, rawSnapshot) {
    const snapshot = normalizeSnapshot(rawSnapshot);
    container.replaceChildren();
    for (const source of snapshot.sources) {
      const card = document.createElement("article");
      card.className = "candidate-card";
      const heading = document.createElement("h3");
      heading.textContent = source.platform + " · " + source.program;
      const state = document.createElement("p");
      state.textContent = statusLabel(source) + (source.checkedAt ? " · " + source.checkedAt : "");
      const title = document.createElement("p");
      title.textContent = source.pageTitle || source.sourceLabel;
      const note = document.createElement("p");
      note.textContent = source.indiaNote;
      const account = document.createElement("p");
      account.textContent = "Account check: " + source.accountCheck;
      const limitation = document.createElement("p");
      limitation.textContent = source.error || source.limitation;
      const evidenceHeading = document.createElement("p");
      evidenceHeading.textContent = "Public rule signals (" + source.ruleEvidence.length + ") · not account verified";
      const evidence = document.createElement("div");
      evidence.className = "creator-rule-evidence";
      if (source.ruleEvidence.length) {
        for (const item of source.ruleEvidence) {
          const signal = document.createElement("p");
          signal.textContent = item.label + ": " + item.excerpt + " " + item.interpretation;
          evidence.append(signal);
        }
      } else {
        const none = document.createElement("p");
        none.textContent = "No structured rule text was extracted from this page. Open the official source to review its full current terms; no missing rule is inferred.";
        evidence.append(none);
      }
      const link = document.createElement("a");
      link.href = source.sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open official source ↗";
      card.append(heading, state, title, note, account, evidenceHeading, evidence, limitation, link);
      container.append(card);
    }

    if (snapshot.status === "pending") {
      statusNode.textContent = "Official source scan has not run yet. The listed pages are source references, not verified account eligibility.";
    } else {
      statusNode.textContent = "Latest public-source check: " + snapshot.status + " · " +
        snapshot.summary.sourcesAvailable + "/" + snapshot.summary.sourcesAttempted +
        " pages reachable · " + (snapshot.generatedAt || "time not recorded") +
        ". Account eligibility and payout remain unverified.";
    }
    return snapshot;
  }

  async function init(root) {
    const document = root.document;
    const container = document.getElementById("creatorProgramDirectory");
    const statusNode = document.getElementById("creatorProgramScanStatus");
    if (!container || !statusNode || typeof root.fetch !== "function") return;
    try {
      const response = await root.fetch("./creator-programs-snapshot.json", {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        headers: { Accept: "application/json" }
      });
      if (!response || !response.ok) throw new Error("The latest source-check snapshot is not available.");
      renderSnapshot(document, container, statusNode, await response.json());
    } catch (error) {
      statusNode.textContent = (error && error.message ? error.message : "Source report could not be loaded.") +
        " Official eligibility must still be checked in the platform account.";
    }
  }

  return { safeSourceUrl, normalizeSnapshot, renderSnapshot, init };
});
