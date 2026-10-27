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
        { platform: "Amazon India", purpose: "Marketplace listings", url: "https://www.amazon.in/s?k=" + encoded },
        { platform: "Flipkart", purpose: "Marketplace listings", url: "https://www.flipkart.com/search?q=" + encoded },
        { platform: "Meesho", purpose: "Marketplace listings", url: "https://www.meesho.com/search?q=" + encoded },
        { platform: "Google Trends India", purpose: "Compare interest over time", url: "https://trends.google.com/trends/explore?geo=IN&q=" + encoded },
        { platform: "YouTube", purpose: "See demonstrations and audience questions", url: "https://www.youtube.com/results?search_query=" + encoded },
        { platform: "Google Shopping", purpose: "Compare visible offers", url: "https://www.google.com/search?tbm=shop&q=" + encoded }
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
      intro.textContent = "Research pack ready: compare marketplace listings, interest over time, demonstrations and visible offers. These links open external pages; this app does not scrape them or import live rankings.";
      results.append(intro);
      for (const item of result.searches) {
        const card = doc.createElement("article");
        card.className = "candidate-card";
        const title = doc.createElement("h3");
        title.textContent = item.platform;
        const purpose = doc.createElement("p");
        purpose.textContent = item.purpose || "Research source";
        const link = doc.createElement("a");
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Search " + item.platform + " for “" + result.query + "”";
        card.append(title, purpose, link);
        results.append(card);
      }
      status.textContent = "Research pack ready: 6 external sources. Record the source and date for any facts you use; no live listing data was imported.";
    });
  }

  return { buildMarketplaceSearches, init };
});
