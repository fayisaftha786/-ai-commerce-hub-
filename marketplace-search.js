"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) api.init(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function buildMarketplaceSearches(query) {
    const term = String(query || "").replace(/[\\u0000-\\u001f]/g, " ").trim().slice(0, 120);
    if (!term) return { valid: false, error: "Choose a product category first." };
    const encoded = encodeURIComponent(term);
    return {
      valid: true,
      query: term,
      searches: [
        { platform: "Amazon", url: "https://www.amazon.in/s?k=" + encoded },
        { platform: "Flipkart", url: "https://www.flipkart.com/search?q=" + encoded },
        { platform: "Meesho", url: "https://www.meesho.com/search?q=" + encoded }
      ]
    };
  }

  function init(root) {
    const doc = root.document;
    const form = doc.getElementById("marketplaceSearchForm");
    if (!form) return;
    const input = doc.getElementById("marketplaceSearchQuery");
    const results = doc.getElementById("marketplaceSearchResults");
    const status = doc.getElementById("marketplaceSearchStatus");

    function runSearch(query) {
      const result = buildMarketplaceSearches(query);
      results.replaceChildren();
      if (!result.valid) {
        status.textContent = result.error;
        return;
      }

      const intro = doc.createElement("p");
      intro.textContent = "Your research links are ready. Open a marketplace, compare actual listings, then import an authorised catalogue CSV to analyse multiple products together.";
      results.append(intro);
      for (const item of result.searches) {
        const card = doc.createElement("article");
        card.className = "candidate-card";
        const title = doc.createElement("h3");
        title.textContent = item.platform;
        const link = doc.createElement("a");
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Open " + item.platform + " results for “" + result.query + "”";
        const scoreButton = doc.createElement("button");
        scoreButton.type = "button";
        scoreButton.className = "secondary";
        scoreButton.textContent = "Analyse a product from this search";
        scoreButton.addEventListener("click", () => {
          const fields = {
            candidateName: result.query,
            candidatePrice: "",
            candidateCommission: "",
            candidateRating: "",
            candidateReviews: "",
            candidateDemand: "",
            candidateCompetition: "",
            candidateUrl: "",
            candidateSource: "",
            candidateCheckedAt: "",
            candidateStock: ""
          };
          for (const [id, value] of Object.entries(fields)) {
            const field = doc.getElementById(id);
            if (field) field.value = value;
          }
          const candidateForm = doc.getElementById("candidateForm");
          if (candidateForm) {
            candidateForm.scrollIntoView({ behavior: "smooth", block: "start" });
            const name = doc.getElementById("candidateName");
            if (name) name.focus({ preventScroll: true });
          }
          status.textContent = "Research keyword transferred. Enter verified listing evidence before scoring; search links do not contain live listing data.";
        });
        card.append(title, link, scoreButton);
        results.append(card);
      }
      status.textContent = "One-tap discovery ready for “" + result.query + "”. These are live marketplace search pages, not product data imported into this app.";
    }

    doc.querySelectorAll(".keyword-preset").forEach((button) => {
      button.addEventListener("click", () => {
        input.value = button.dataset.keyword || "";
        runSearch(input.value);
        status.textContent = "Quick search prepared for “" + input.value + "”. Open a marketplace result to inspect current listings.";
      });
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      runSearch(input.value);
    });
  }

  return { buildMarketplaceSearches, init };
});
