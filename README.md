# AI Commerce Hub

A low-cost product-link and affiliate-content workspace prototype.

## Current features

- Add product entries for Amazon, Flipkart and Meesho
- Shared product validation used by the browser and Node.js tests
- HTTPS-only URLs, bounded input lengths, and rejection of embedded URL credentials
- Save the product list in the current browser on the current device
- Malayalam, English and bilingual template drafts
- Affiliate disclosure reminder in generated drafts
- Automated Node.js regression tests and GitHub Actions CI

## Run locally

Requires Node.js 24 or a compatible modern Node.js release.

```sh
npm run check
npm test
```

Open `index.html` in a modern browser to try the frontend. Some browser features, including clipboard access, depend on browser security settings.

## Known limitations

- This is a prototype, not a production affiliate platform.
- Product data is stored only in this browser's local storage; there is no account, cloud backup or cross-device sync.
- The click counter records link-click events in the current page session. It does not confirm successful page loads, purchases, conversions or commissions.
- Draft generation uses templates. No AI API is connected.
- Live product feeds, affiliate link creation, commission data and social publishing are not connected.
- Validation cannot prove that a URL is an official marketplace listing or that the user is approved for an affiliate program.

## Safety and compliance

Use affiliate links only after approval by the relevant program. Follow marketplace and social platform rules, and clearly disclose affiliate relationships. Never commit API keys, access tokens or passwords. Before public production use, add server-side validation, privacy controls, backups and security review.
