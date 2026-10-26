# AI Commerce Hub

A low-cost product-link and affiliate-content workspace prototype focused on evaluating offer details and preparing responsible promotional drafts.

## Current features

- Add product entries for Amazon, Flipkart and Meesho
- Shared product validation used by the browser and Node.js tests
- HTTPS-only URLs, bounded input lengths, and rejection of embedded URL credentials
- Save the product list in the current browser on the current device
- Smart Offer Intelligence: calculate listed discount, listed savings and price including entered shipping
- Offer-readiness score with transparent checks and recommendations
- Flag expired dates and avoid adding urgency when no expiry date was supplied
- Prepare Malayalam, English or bilingual promotional drafts for WhatsApp, Instagram and Facebook
- Affiliate disclosure reminder in offer drafts
- Automated Node.js regression tests and GitHub Actions CI

## Run locally

Requires Node.js 24 or a compatible modern Node.js release.

```sh
npm run check
npm test
```

Open `index.html` in a modern browser to try the frontend. Some browser features, including clipboard access, depend on browser security settings.

## Offer score: important caveats

The score is a transparent heuristic to help prioritize review, not an AI prediction and not a guarantee of sales. Price inputs are supplied by the user. The app does not verify the seller's price history, stock, product authenticity, delivery promises or whether a deal is genuinely better than usual. Always check the live seller page before publishing. An expiry date should be entered only when the seller confirms it.

## Known limitations

- This is a prototype, not a production affiliate platform.
- Product data is stored only in this browser's local storage; there is no account, cloud backup or cross-device sync.
- The click counter records link-click events in the current page session. It does not confirm successful page loads, purchases, conversions or commissions.
- Drafts are template-generated; no live AI API is connected.
- Live product feeds, affiliate link creation, commission data and social publishing are not connected.
- Validation cannot prove that a URL is an official marketplace listing or that the user is approved for an affiliate program.

## Safety and compliance

Use affiliate links only after approval by the relevant program. Follow marketplace and social platform rules, and clearly disclose affiliate relationships. Never commit API keys, access tokens or passwords. Before public production use, add server-side validation, privacy controls, backups and security review.
