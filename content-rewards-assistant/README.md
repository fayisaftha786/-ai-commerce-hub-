# ClipReward Studio

A standalone, mobile-friendly creator workspace intended to reduce administrative work around clipping campaigns. It is added as a separate sub-app and does not alter the existing AI Commerce Hub screens.

## Open the app

When the repository's GitHub Pages workflow succeeds and Pages is enabled, open:

\`https://fayisaftha786.github.io/-ai-commerce-hub-/content-rewards-assistant/\`

Or run the existing root project as usual and open \`content-rewards-assistant/index.html\` through a static local server. A secure HTTPS/localhost context is needed for service-worker installation and clipboard permissions.

## What works in this version

- Create, edit, search, filter, and delete campaign records for Content Rewards, Whop and other creator programs.
- Account Center with official Content Rewards/Whop/help links, a local creator label, saved social handles and a manual workflow-readiness checklist.
- A 30-minute clip submission countdown from the user-entered post time, with visible overdue and locally marked-submitted states.
- Record deadlines, campaign rules, public post links, and manual review status.
- Generate English, Malayalam, or bilingual caption/script scaffolds from local templates.
- Save and sort mm:ss or hh:mm:ss editing notes.
- Export and validate a versioned JSON backup, with duplicate-ID, date, timestamp, URL-scheme, size and record-count checks; account-center records are included, and older backups without them still import.
- Responsive dark dashboard, mobile navigation, local-first storage and best-effort static-asset caching.
- Node.js regression tests for the core data validation and backup format.

## Content Rewards submission workflow

The in-app submission guide now separates the two official routes: standard campaigns (publish a public clip, then submit its link within 30 minutes) and pre-approval campaigns (upload a draft first, wait for approval, publish from an approved connected account, then submit the live link within 30 minutes). The local reminder timer applies only to Content Rewards campaigns; it does not impose Content Rewards' 30-minute rule on other programmes.

When a Content Rewards campaign is marked Submitted in the local tracker, a public HTTPS post URL and the time the post went live are required. This checks the local record only; it does not confirm that the link was actually submitted on the Content Rewards site. Rejected is labelled as Rejected, not as a request for changes.

The current official flow requires the exact posting account to be connected and verified in Content Rewards (a Whop account connection alone does not count), and each submission is checked for a connected account, duplicate submission to the same campaign and post age under 30 minutes. Pre-approval drafts are reviewed before posting and the final live post is reviewed again. See the official [submission guide](https://help.contentrewards.com/en/articles/15319814-submit-a-video), [account connection guide](https://help.contentrewards.com/en/articles/16746780-connect-your-social-accounts), and [approval and review guide](https://help.contentrewards.com/en/articles/15319801-approval-and-review).

## Important limitations — read before using

This is **not an official Content Rewards or Whop integration**. The Account Center only opens official pages and saves local reminders; it does not sign in, control the session, read account data, or verify that a social account is really connected. The 30-minute countdown is a local reminder, not a platform submission or verified receipt. No account login/OAuth connection, live campaign feed, reward eligibility verification, video rendering, social publishing, views ingestion, payout tracking, or connected AI API is implemented in this MVP. The content generator is a local template helper, not a claim that an AI model has been connected. A true AI API requires a secure server-side integration; do not put secret API keys in frontend code or GitHub.

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

## Instagram Creator account setup

The Account Center includes an Instagram Creator setup guide for Meta's **Instagram API with Instagram Login**. This login path supports professional Creator and Business accounts and does not require a linked Facebook Page. Start at [Meta for Developers](https://developers.facebook.com/apps/) and configure Instagram Login in the app dashboard. Use the official [Meta Instagram API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api) as the API reference.

The backend readiness endpoint recognizes these server-only environment variables:

- `INSTAGRAM_APP_ID`
- `INSTAGRAM_APP_SECRET`
- `INSTAGRAM_REDIRECT_URI` (must be HTTPS)

The exact redirect URI must be registered in Meta and must point to a separately hosted HTTPS backend. Do not guess the URI or enter a placeholder before backend hosting is selected. Never put the App Secret in browser code, GitHub, a Pages build, or a client-side environment variable.

**Important status:** this setup guide and configuration-readiness check do not implement OAuth authorization, callback handling, token exchange/refresh, encrypted token persistence, profile/insights retrieval, publishing, or disconnect. A configuration status of `credentials_present_oauth_not_verified` is not an account connection. The current static GitHub Pages deployment cannot safely host OAuth secrets or perform server-side token exchange. A secure backend deployment and the complete OAuth/session/token lifecycle must be implemented and tested before connecting a real account.
