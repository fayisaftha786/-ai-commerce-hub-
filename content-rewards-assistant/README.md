# ClipReward Studio

A standalone, mobile-friendly creator workspace intended to reduce administrative work around clipping campaigns. It is added as a separate sub-app and does not alter the existing AI Commerce Hub screens.

## Open the app

When the repository's GitHub Pages workflow succeeds and Pages is enabled, open:

\`https://fayisaftha786.github.io/-ai-commerce-hub-/content-rewards-assistant/\`

Or run the existing root project as usual and open \`content-rewards-assistant/index.html\` through a static local server. A secure HTTPS/localhost context is needed for service-worker installation and clipboard permissions.

## What works in this version

- Create, edit, search, filter, and delete campaign records for Content Rewards, Whop and other creator programs.
- Record deadlines, campaign rules, public post links, and manual review status.
- Generate English, Malayalam, or bilingual caption/script scaffolds from local templates.
- Save and sort mm:ss or hh:mm:ss editing notes.
- Export and validate a versioned JSON backup, with duplicate-ID, date, timestamp, URL-scheme, size and record-count checks.
- Responsive dark dashboard, mobile navigation, local-first storage and best-effort static-asset caching.
- Node.js regression tests for the core data validation and backup format.

## Important limitations — read before using

This is **not an official Content Rewards or Whop integration**. No account login, live campaign feed, reward eligibility verification, video rendering, social publishing, views ingestion, payout tracking, or connected AI API is implemented in this MVP. The content generator is a local template helper, not a claim that an AI model has been connected. A true AI API requires a secure server-side integration; do not put secret API keys in frontend code or GitHub.

Submission and approval status are user-maintained notes. A status marked “Approved” is not independently verified, and the app does not guarantee views, campaign acceptance, or payment. Use official platform workflows, verify deadlines and terms, respect music/media licenses, and include any required sponsorship or affiliate disclosure. Do not automate CAPTCHA, bypass access restrictions, create fake engagement, or use accounts without permission.

## Local data & privacy

Campaign data is stored in this browser's local storage on this device. It is not synchronized across devices or uploaded to a server. Clearing browser data can erase it; use **Export backup** regularly and keep backups private. Import replaces the current workspace only after a confirmation prompt. Treat public URLs and campaign notes as potentially sensitive.

## Development checks

From the repository root:

\`\`\`sh
node --check content-rewards-assistant/core.js
node --check content-rewards-assistant/app.js
node --test content-rewards-assistant/tests/*.test.js
npm run check
npm test
\`\`\`
