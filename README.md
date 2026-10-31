# AI Commerce Hub

A lightweight affiliate workspace prototype for evaluating offer details, shortlisting product candidates and preparing responsible promotional posts and video plans.

## Current features

- Standalone ClipReward Studio with a Content Rewards public Discover shortcut, clipboard-based campaign brief findings/autofill, submission preflight, content drafts, clip timestamps and local backup/restore: [open the assistant source](content-rewards-assistant/README.md)

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
- AI-assisted Reels & Shorts Studio: create editable Malayalam, English or bilingual 4–6 scene scripts and captions; render animated 9:16 WebM locally from up to 8 authorised images; record or upload voice-over and optionally mix licensed background music
- Social Desk: preview up to 5 selected image/video files locally (50 MB each), copy captions, open official social platforms for manual publishing, and calculate metrics from manually entered insights
- Generate three distinct hook options and three CTA options for simple creative testing; compare results manually because the prototype does not track conversions
- Save a local campaign register with a unique ID per content variant and export campaign metadata as CSV
- Import authorised campaign-performance CSVs, group by exact campaign ID and reporting period, detect exact duplicate rows and overlapping date windows, and calculate conversion only when click/order counts are plausible
- Export/restore one versioned full-workspace JSON backup covering products, campaigns, shortlist, imported catalogue data, Earning Hub opportunities/tasks/earnings, and ClipReward Studio campaigns/timestamps/account checklist
- Copy content for Instagram, Facebook, WhatsApp and YouTube Shorts workflows
- Automated Node.js regression tests and GitHub Actions CI
- App Self-Check: local diagnostics for secure context, browser storage, critical modules, required forms and service-worker readiness; it clearly distinguishes local checks from live API connectivity

## Marketplace API access and automation status

The Discover panel links to the official partner routes and states their prerequisites. The app does **not** currently fetch live listings, prices, stock, commissions, order reports or private creator analytics from any marketplace.

- **Amazon India:** New product-catalog integrations should use the Creators API, not the deprecated PA-API 5.0. Amazon's current guide requires an Associates account, API registration and at least 10 qualifying sales in the previous 30 days. Credentials use OAuth 2.0 and belong on a private backend. [Creators API introduction](https://affiliate-program.amazon.in/creatorsapi/docs/en-us/introduction) · [Authentication guide](https://affiliate-program.amazon.in/creatorsapi/docs/en-us/get-started/using-curl).
- **Flipkart:** Registered affiliates can request a private API token and access product, offer and report APIs. Keyword search returns up to 10 products per request; the documented rate limit is 20 calls per second per affiliate. [Registration and token setup](https://affiliate.flipkart.com/api-docs/af_register.html) · [Product API reference](https://affiliate.flipkart.com/api-docs/af_prod_ref.html).
- **Meesho:** The official Creator Program is available at [affiliate.meesho.com](https://affiliate.meesho.com/influencer-home). This app does not authenticate to that portal or access private creator metrics. Use only integration credentials or exports explicitly provided for your account; do not scrape private pages or rely on undocumented endpoints.

GitHub Pages serves static files and must never contain API secrets. Live marketplace retrieval needs a separately deployed private backend with server-side credential storage. Until that exists and the account has approved access, use marketplace search links and user-supplied CSV imports. No account connection or API capability is implied by the links in the app.

## Installable Android app (PWA)

This repository includes a Progressive Web App manifest and a service worker for caching the static app shell. To install it on Android, it must first be hosted over **HTTPS**; opening `index.html` directly as a local file does not enable service workers.

### Publish on free GitHub Pages

1. Open this repository on GitHub and choose **Settings → Pages**.
2. Under **Build and deployment → Source**, select **GitHub Actions** and save. This is the one-time setting an owner must enable; repository code cannot turn it on by itself.
3. After that, every successful push to `main` triggers `.github/workflows/deploy-pages.yml`. Its tested `scripts/pages-build.js` assembler discovers every local script, stylesheet, manifest and icon referenced by `index.html`, copies the service worker, and includes the Content Rewards sub-app. The CI suite checks that the published bundle contains all referenced files (including the earning intelligence modules). Check the **Actions** tab for deployment status.
4. Wait until GitHub Pages shows the live HTTPS site URL. The expected address is `https://fayisaftha786.github.io/-ai-commerce-hub-/`; trust the actual URL reported by GitHub if it differs.
5. Open that HTTPS site in Chrome on Android, load it once while online, then tap the app's **Install app** button. If the browser doesn't offer a prompt, use Chrome's menu and choose **Install app** or **Add to Home screen**.

After the first successful online visit, the static HTML, CSS, JavaScript, manifest and icon can be served from the service-worker cache when offline. Marketplace search pages, current product data, external APIs, social login and publishing still need a connection and valid permissions. Saved workspace data remains in the browser's local storage on that device; keep using the backup/restore feature.

If the service worker cannot cache one of the static assets, clear site storage only after exporting a workspace backup, then revisit the site online.

## Run locally

Requires Node.js 24 or a compatible modern Node.js release.

```sh
npm run check
npm test
```

Open `index.html` in a modern browser to try the frontend. Clipboard access depends on browser security settings.

The private Node.js API can be run with `npm start`. It includes an optional server-side Content Rewards public-snapshot discovery worker, persistent JSON store and read-only discovery endpoints when explicitly enabled; it is not an OAuth or social-publishing backend. See [docs/BACKEND.md](docs/BACKEND.md) before deploying it.

## CSV import validation

The importer rejects malformed quoting, duplicate normalised headers, mismatched row widths, invalid numeric values, non-integer count metrics and files larger than 2 MB or 5,000 product rows. Quoted thousands separators such as `\"1,299\"` are supported. Unknown stock status receives no stock bonus and produces a warning. Date-only offer expiry is interpreted in the viewer's local calendar time and impossible calendar dates are rejected.

## App Self-Check

Use the **Run self-check** button in the app to inspect HTTPS/secure-context support, browser storage, critical JavaScript modules, key forms, manifest presence and service-worker registration. The diagnostic reports local readiness only. It does not authenticate to marketplace programmes, test live API credentials, or verify sales predictions. A green self-check is not proof that every external service is connected.

## Campaign performance report

The campaign report importer accepts a user-supplied CSV with `campaign_id` (or `sub_id`), `period_start`, `period_end`, `clicks` and `orders`; `commission` and `returns` are optional. It validates dates and counts, groups only rows with the same campaign ID and exact reporting period, and matches only exact IDs in the local campaign registry. It does not infer attribution from product names, dates or similar-looking IDs. If the affiliate programme does not export a campaign/sub-ID that was actually attached to the link, attribution is unavailable. Missing commission/return values are not treated as zero; implausible click/order counts suppress conversion calculations. Imported reports are shown in the current page and are not independently verified or saved as official payout records. Exact duplicate rows are skipped to reduce double-counting risk; overlapping date ranges are flagged rather than silently treated as independent periods. These checks cannot establish that a report is complete or truthful.

## Evidence freshness and shortlist gate

Imported catalogue rows now retain the user-entered evidence source and `checked_at` date. A product cannot be marked **Shortlist for a small test** unless its source is recorded and the date is valid, not in the future, and no more than 7 days old. Missing, invalid, future-dated or stale provenance means **Verify before promotion**, even if the performance numbers look strong. This is a data-quality gate—not verification that the named source is genuine. Re-check source data before publishing.

## Product discovery: important limitations

The manual candidate score is a transparent shortlist heuristic based on data entered by the user. The CSV importer can use real orders/clicks from a dashboard export you are authorised to access, but it does **not** scrape Meesho, fetch live trending products, read real-time search volume, or predict future sales. Use comparable reporting periods and verify what each metric means. If orders/clicks are missing, the app clearly warns that a score is catalogue quality rather than sales evidence. Supplied return counts reduce the score when the return rate is high. Verify commission and availability before promotion. An entered commission estimate is not guaranteed earnings. CSV files are processed in the browser and stored locally; they are not uploaded to a server.

## Video and media rights

The Reels & Shorts Studio creates editable Malayalam, English or bilingual template-based scripts and captions; records microphone narration or accepts uploaded audio; optionally mixes user-supplied licensed music; and renders a vertical 720×1280 WebM locally from authorised images. It does not generate original footage, clone voices, create MP4, fetch marketplace media or publish posts. Use only original footage or media you are permitted to use. A product listing image is not automatically licensed for reuse. Verify campaign rules, claims, prices and disclosure before publishing.

## Marketplace API permission gate

Live marketplace access will be enabled only after account eligibility, current API terms, intended-use permission, and credentials have been verified. The project is a cross-marketplace product-comparison tool, so the current Flipkart Affiliate API terms must be reviewed carefully before this use is enabled. Amazon Creators API access is conditional on current programme requirements. For Meesho, use authorised exports or documented/approved feeds only; do not scrape pages or reuse listing media without permission. See [docs/ROADMAP.md](docs/ROADMAP.md) for the provider-by-provider gate.

## Known limitations

- This is a prototype, not a production affiliate platform.
- All workspace data, including ClipReward Studio, is stored only in this browser's local storage; there is no account or automatic cloud sync. Use the main **Export full backup** / **Restore from backup** controls to export or restore all workspace sections in one file. Older main-app backups that do not contain ClipReward data preserve the current ClipReward data during restore. Keep backups private and store them safely.
- The click counter records link-click events in the current page session. It does not confirm successful page loads, purchases, conversions or commissions.
- Campaign IDs are organisational labels only. The registry does not track external clicks or sales and does not modify affiliate URLs with tracking parameters. Use programme-approved campaign/sub-ID fields only if available, then compare authorised performance reports.
- Content is template-generated; no live AI API is connected.
- Live product feeds, automated affiliate-link creation, live commission/payout data, generative AI video creation, and automatic social publishing are not connected. The local WebM Video Maker and manual Social Desk are separate browser features.
- CSV imports are user-supplied only; the app does not authenticate to marketplace dashboards or fetch current sales data.
- The app cannot verify that a URL is an official marketplace listing or that the user is approved for an affiliate programme.

## Safety and compliance

Use affiliate links only after approval by the relevant programme. Follow marketplace and social platform rules, clearly disclose affiliate relationships, and do not make unsupported product or discount claims. Never commit API keys, access tokens or passwords. Before public production use, add server-side validation, privacy controls, backups and security review.


### Product shortlist evidence checks

The product discovery score is a transparent heuristic based on entered information, not a live trend feed or sales prediction. Blank rating, review count, commission, demand or competition fields are treated as unknown and do not earn score points. When key evidence is missing, the result is labelled **Need more evidence** instead of recommending the product for promotion. Estimated commission is shown only when a positive commission rate has been entered; it is not a payout guarantee. Verify current stock, price, eligibility and programme terms before publishing.


## ClipReward Studio sub-app

A separate early-stage creator workspace is in [`content-rewards-assistant/`](content-rewards-assistant/). Once the updated GitHub Pages deployment workflow runs successfully, its expected public path is `https://fayisaftha786.github.io/-ai-commerce-hub-/content-rewards-assistant/`. The app tracks campaigns and submissions and generates local template drafts; it is **not** connected to Content Rewards or Whop APIs and does not auto-publish videos or verify payouts. Read its README for limitations and privacy details.

## Development roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for phased delivery, marketplace API prerequisites, acceptance criteria, and the strategy for reducing rework.


## Multi-platform Earning Intelligence (first release)

The Earning Hub adds an India-first provider registry for YouTube, Facebook, Instagram, Snapchat, X, Amazon India, Flipkart and Meesho. TikTok is intentionally excluded for the India-focused workflow.

- Add an opportunity with an official HTTPS source, platform, eligibility, reward (if known), effort, payout evidence, risk, deadline, deliverables and source-check date.
- Rank opportunities using explainable weighted signals and evidence coverage. Unknown fields do not receive positive points; stale source checks reduce the score; ineligible, high-risk, closed and expired opportunities are blocked from priority.
- Generate a local task plan with explicit user approval gates for account eligibility, publishing and payout reconciliation.
- Record estimated, confirmed and paid INR amounts separately. Confirmed and paid records require an HTTPS evidence link, but the link and amount remain user-entered and are not independently verified by this app.
- Opportunity, task and earnings records are included in the validated workspace backup and restore.

**Integration boundary:** this is automatic analysis after a user adds a source-backed opportunity, not a live campaign discovery feed. No social account login, API connection, automatic publishing, platform submission or payout verification is implemented. Provider availability and account eligibility must be checked in the official account dashboard. All Earning Hub records are stored locally in the current browser until you export a backup.


## AI-assisted Reels & Shorts Studio

The browser studio supports Malayalam, English and bilingual script/caption drafts, editable 4–6 scene subtitles, 9:16 720×1280 animated WebM export, up to 8 authorised images (10 MB each), microphone-recorded or uploaded narration, and optional user-supplied background music (25 MB each). Voice and music are mixed locally in the browser using Web Audio APIs; music is reduced to a lower level. Output is WebM; MP4 conversion is not implemented.

The script generator is deterministic template-based assistance using the user's topic and stated benefit. It is not a connected generative AI model and cannot research or fact-check claims. The user must edit and verify every line. No text-to-speech, voice cloning, AI-generated footage, marketplace image import, cloud processing, social account connection or automatic publishing is implemented. Microphone access requires HTTPS/localhost and permission. Audio codec support varies by browser/device; try current Chrome if export fails. Files are processed locally by this feature and are not uploaded. Use only original or licensed images, voice and music, and retain required campaign/affiliate disclosure.
