# AI Commerce Hub

A lightweight affiliate workspace prototype for evaluating offer details, shortlisting product candidates and preparing responsible promotional posts and video plans.

## Current features

- Add product entries for Amazon, Flipkart and Meesho
- HTTPS product URL validation and local-only product storage
- Smart Offer Intelligence: calculate listed discount, savings and entered shipping-inclusive price
- Product Discovery shortlist: score candidate products using user-entered demand evidence, rating, review count, confirmed commission, price band, competition and stock status
- CSV catalogue/performance import: rank products using supplied orders, clicks, reporting period, rating, commission, price and availability; unsafe links are ignored
- Explainable catalogue guidance with period-normalized order comparisons, next-step recommendations and illustrative commission estimates
- Send an imported catalogue product into Content Studio with its available name, price and link; product-specific claims are cleared so you must enter verified benefits yourself
- Save and sort a local shortlist of up to 50 product candidates
- Generate Malayalam, English or bilingual product captions
- Generate a short vertical-video plan with hook, shot guidance, voice-over, CTA and affiliate disclosure
- Generate three distinct hook options and three CTA options for simple creative testing; compare results manually because the prototype does not track conversions
- Save a local campaign register with a unique ID per content variant and export campaign metadata as CSV
- Import authorised campaign-performance CSVs, group by exact campaign ID and reporting period, detect exact duplicate rows and overlapping date windows, and calculate conversion only when click/order counts are plausible
- Export/restore a versioned JSON backup of local products, campaigns, shortlist and imported catalogue data
- Copy content for Instagram, Facebook, WhatsApp and YouTube Shorts workflows
- Automated Node.js regression tests and GitHub Actions CI

## Installable Android app (PWA)

This repository includes a Progressive Web App manifest and a service worker for caching the static app shell. To install it on Android, it must first be hosted over **HTTPS**; opening `index.html` directly as a local file does not enable service workers.

### Publish on free GitHub Pages

1. Open this repository on GitHub and choose **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, select branch `main` and folder `/(root)`, then save.
3. Wait until GitHub Pages shows the live site URL. For this repository the expected address is `https://fayisaftha786.github.io/-ai-commerce-hub-/`; use the URL that GitHub Pages actually reports.
4. Open that HTTPS site in Chrome on Android, load it once while online, then use Chrome's menu and choose **Install app** or **Add to Home screen** (wording depends on the browser version).

After the first successful online visit, the static HTML, CSS, JavaScript, manifest and icon can be served from the service-worker cache when offline. Marketplace search pages, current product data, external APIs, social login and publishing still need a connection and valid permissions. Saved workspace data remains in the browser's local storage on that device; keep using the backup/restore feature.

If the service worker cannot cache one of the static assets, clear site storage only after exporting a workspace backup, then revisit the site online.

## Run locally

Requires Node.js 24 or a compatible modern Node.js release.

```sh
npm run check
npm test
```

Open `index.html` in a modern browser to try the frontend. Clipboard access depends on browser security settings.

## CSV import validation

The importer rejects malformed quoting, duplicate normalised headers, mismatched row widths, invalid numeric values, non-integer count metrics and files larger than 2 MB or 5,000 product rows. Quoted thousands separators such as `\"1,299\"` are supported. Unknown stock status receives no stock bonus and produces a warning. Date-only offer expiry is interpreted in the viewer's local calendar time and impossible calendar dates are rejected.

## Campaign performance report

The campaign report importer accepts a user-supplied CSV with `campaign_id` (or `sub_id`), `period_start`, `period_end`, `clicks` and `orders`; `commission` and `returns` are optional. It validates dates and counts, groups only rows with the same campaign ID and exact reporting period, and matches only exact IDs in the local campaign registry. It does not infer attribution from product names, dates or similar-looking IDs. If the affiliate programme does not export a campaign/sub-ID that was actually attached to the link, attribution is unavailable. Missing commission/return values are not treated as zero; implausible click/order counts suppress conversion calculations. Imported reports are shown in the current page and are not independently verified or saved as official payout records. Exact duplicate rows are skipped to reduce double-counting risk; overlapping date ranges are flagged rather than silently treated as independent periods. These checks cannot establish that a report is complete or truthful.

## Evidence freshness and shortlist gate

Imported catalogue rows now retain the user-entered evidence source and `checked_at` date. A product cannot be marked **Shortlist for a small test** unless its source is recorded and the date is valid, not in the future, and no more than 7 days old. Missing, invalid, future-dated or stale provenance means **Verify before promotion**, even if the performance numbers look strong. This is a data-quality gate—not verification that the named source is genuine. Re-check source data before publishing.

## Product discovery: important limitations

The manual candidate score is a transparent shortlist heuristic based on data entered by the user. The CSV importer can use real orders/clicks from a dashboard export you are authorised to access, but it does **not** scrape Meesho, fetch live trending products, read real-time search volume, or predict future sales. Use comparable reporting periods and verify what each metric means. If orders/clicks are missing, the app clearly warns that a score is catalogue quality rather than sales evidence. Supplied return counts reduce the score when the return rate is high. Verify commission and availability before promotion. An entered commission estimate is not guaranteed earnings. CSV files are processed in the browser and stored locally; they are not uploaded to a server.

## Video and media rights

The content studio generates a storyboard/script and caption; it does not render a finished video or download media from Meesho. Use original footage you film or product assets/video explicitly supplied for your permitted promotional use. Do not assume that a listing image or video can be reused commercially. Check the current Meesho creator/affiliate programme terms and any platform-specific rules before publishing. A future media-import integration should use an authorised source or official API, not scrape private or protected media.

## Marketplace API permission gate

Live marketplace access will be enabled only after account eligibility, current API terms, intended-use permission, and credentials have been verified. The project is a cross-marketplace product-comparison tool, so the current Flipkart Affiliate API terms must be reviewed carefully before this use is enabled. Amazon Creators API access is conditional on current programme requirements. For Meesho, use authorised exports or documented/approved feeds only; do not scrape pages or reuse listing media without permission. See [docs/ROADMAP.md](docs/ROADMAP.md) for the provider-by-provider gate.

## Known limitations

- This is a prototype, not a production affiliate platform.
- Product, campaign and shortlist data are stored only in the current browser's local storage; there is no account or automatic cloud sync. You can manually export and restore a JSON backup; keep it private and store it safely.
- The click counter records link-click events in the current page session. It does not confirm successful page loads, purchases, conversions or commissions.
- Campaign IDs are organisational labels only. The registry does not track external clicks or sales and does not modify affiliate URLs with tracking parameters. Use programme-approved campaign/sub-ID fields only if available, then compare authorised performance reports.
- Content is template-generated; no live AI API is connected.
- Live product feeds, affiliate link creation, commission data, video rendering and social publishing are not connected.
- CSV imports are user-supplied only; the app does not authenticate to marketplace dashboards or fetch current sales data.
- The app cannot verify that a URL is an official marketplace listing or that the user is approved for an affiliate programme.

## Safety and compliance

Use affiliate links only after approval by the relevant programme. Follow marketplace and social platform rules, clearly disclose affiliate relationships, and do not make unsupported product or discount claims. Never commit API keys, access tokens or passwords. Before public production use, add server-side validation, privacy controls, backups and security review.


### Product shortlist evidence checks

The product discovery score is a transparent heuristic based on entered information, not a live trend feed or sales prediction. Blank rating, review count, commission, demand or competition fields are treated as unknown and do not earn score points. When key evidence is missing, the result is labelled **Need more evidence** instead of recommending the product for promotion. Estimated commission is shown only when a positive commission rate has been entered; it is not a payout guarantee. Verify current stock, price, eligibility and programme terms before publishing.


## Development roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for phased delivery, marketplace API prerequisites, acceptance criteria, and the strategy for reducing rework.
