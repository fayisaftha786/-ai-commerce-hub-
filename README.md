# AI Commerce Hub

A lightweight affiliate workspace prototype for evaluating offer details, shortlisting product candidates and preparing responsible promotional posts and video plans.

## Current features

- Add product entries for Amazon, Flipkart and Meesho
- HTTPS product URL validation and local-only product storage
- Smart Offer Intelligence: calculate listed discount, savings and entered shipping-inclusive price
- Product Discovery shortlist: score candidate products using user-entered demand evidence, rating, review count, confirmed commission, price band, competition and stock status
- CSV catalogue/performance import: rank products using supplied orders, clicks, reporting period, rating, commission, price and availability; unsafe links are ignored
- Save and sort a local shortlist of up to 50 product candidates
- Generate Malayalam, English or bilingual product captions
- Generate a short vertical-video plan with hook, shot guidance, voice-over, CTA and affiliate disclosure
- Copy content for Instagram, Facebook, WhatsApp and YouTube Shorts workflows
- Automated Node.js regression tests and GitHub Actions CI

## Run locally

Requires Node.js 24 or a compatible modern Node.js release.

```sh
npm run check
npm test
```

Open `index.html` in a modern browser to try the frontend. Clipboard access depends on browser security settings.

## CSV import validation

The importer rejects malformed quoting, duplicate normalised headers, mismatched row widths, invalid numeric values, non-integer count metrics and files larger than 2 MB or 5,000 product rows. Quoted thousands separators such as `\"1,299\"` are supported. Unknown stock status receives no stock bonus and produces a warning. Date-only offer expiry is interpreted in the viewer's local calendar time and impossible calendar dates are rejected.

## Product discovery: important limitations

The manual candidate score is a transparent shortlist heuristic based on data entered by the user. The CSV importer can use real orders/clicks from a dashboard export you are authorised to access, but it does **not** scrape Meesho, fetch live trending products, read real-time search volume, or predict future sales. Use comparable reporting periods and verify what each metric means. If orders/clicks are missing, the app clearly warns that a score is catalogue quality rather than sales evidence. Supplied return counts reduce the score when the return rate is high. Verify commission and availability before promotion. An entered commission estimate is not guaranteed earnings. CSV files are processed in the browser and stored locally; they are not uploaded to a server.

## Video and media rights

The content studio generates a storyboard/script and caption; it does not render a finished video or download media from Meesho. Use original footage you film or product assets/video explicitly supplied for your permitted promotional use. Do not assume that a listing image or video can be reused commercially. Check the current Meesho creator/affiliate programme terms and any platform-specific rules before publishing. A future media-import integration should use an authorised source or official API, not scrape private or protected media.

## Known limitations

- This is a prototype, not a production affiliate platform.
- Product and shortlist data are stored only in the current browser's local storage; there is no account, cloud backup or cross-device sync.
- The click counter records link-click events in the current page session. It does not confirm successful page loads, purchases, conversions or commissions.
- Content is template-generated; no live AI API is connected.
- Live product feeds, affiliate link creation, commission data, video rendering and social publishing are not connected.
- CSV imports are user-supplied only; the app does not authenticate to marketplace dashboards or fetch current sales data.
- The app cannot verify that a URL is an official marketplace listing or that the user is approved for an affiliate programme.

## Safety and compliance

Use affiliate links only after approval by the relevant programme. Follow marketplace and social platform rules, clearly disclose affiliate relationships, and do not make unsupported product or discount claims. Never commit API keys, access tokens or passwords. Before public production use, add server-side validation, privacy controls, backups and security review.
