"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) api.init(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function buildMarketplaceSearches(query) {
    const term = String(query || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 120);
    if (!term) return { valid: false, error: "Enter a product category or keyword first." };
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
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const result = buildMarketplaceSearches(input.value);
      results.replaceChildren();
      if (!result.valid) {
        status.textContent = result.error;
        return;
      }
      const intro = doc.createElement("p");
      intro.textContent = "Compare the same keyword across all three marketplaces. Open each result and collect only information you can verify.";
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
        link.textContent = "Search " + item.platform + " for “" + result.query + "”";
        const scoreButton = doc.createElement("button");
        scoreButton.type = "button";
        scoreButton.className = "secondary";
        scoreButton.textContent = "Start scoring this keyword";
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
          const form = doc.getElementById("candidateForm");
          if (form) {
            form.scrollIntoView({ behavior: "smooth", block: "start" });
            const name = doc.getElementById("candidateName");
            if (name) name.focus({ preventScroll: true });
          }
          status.textContent = "Keyword transferred. Enter verified product details before scoring; marketplace search links do not provide verified evidence.";
        });
        card.append(title, link, scoreButton);
        results.append(card);
      }
      status.textContent = "Search links ready. These links open marketplace pages; they do not fetch live listings into the app.";
    });
  }

  return { buildMarketplaceSearches, init };
});
