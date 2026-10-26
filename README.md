# AI Commerce Hub

A lightweight affiliate workspace prototype for evaluating offer details, shortlisting product candidates and preparing responsible promotional posts and video plans.

## Current features

- Add product entries for Amazon, Flipkart and Meesho
- HTTPS product URL validation and local-only product storage
- Smart Offer Intelligence: calculate listed discount, savings and entered shipping-inclusive price
- Product Discovery shortlist: score candidate products using user-entered demand evidence, rating, review count, confirmed commission, price band, competition and stock status
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

## Product discovery: important limitations

The candidate score is a transparent shortlist heuristic based on data entered by the user. This version does **not** scrape Meesho, fetch live trending products, read real-time search volume, verify product popularity or predict sales. Use data you are authorised to access from your marketplace/affiliate dashboard, recent reviews, buyer questions and audience feedback. Verify commission and availability before promotion. An entered commission estimate is not guaranteed earnings.

## Video and media rights

The content studio generates a storyboard/script and caption; it does not render a finished video or download media from Meesho. Use original footage you film or product assets/video explicitly supplied for your permitted promotional use. Do not assume that a listing image or video can be reused commercially. Check the current Meesho creator/affiliate programme terms and any platform-specific rules before publishing. A future media-import integration should use an authorised source or official API, not scrape private or protected media.

## Known limitations

- This is a prototype, not a production affiliate platform.
- Product and shortlist data are stored only in the current browser's local storage; there is no account, cloud backup or cross-device sync.
- The click counter records link-click events in the current page session. It does not confirm successful page loads, purchases, conversions or commissions.
- Content is template-generated; no live AI API is connected.
- Live product feeds, affiliate link creation, commission data, video rendering and social publishing are not connected.
- The app cannot verify that a URL is an official marketplace listing or that the user is approved for an affiliate programme.

## Safety and compliance

Use affiliate links only after approval by the relevant programme. Follow marketplace and social platform rules, clearly disclose affiliate relationships, and do not make unsupported product or discount claims. Never commit API keys, access tokens or passwords. Before public production use, add server-side validation, privacy controls, backups and security review.
