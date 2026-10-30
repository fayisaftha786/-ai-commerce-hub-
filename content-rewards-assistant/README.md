# ClipReward Studio

A standalone, mobile-friendly creator workspace intended to reduce administrative work around clipping campaigns. It is added as a separate sub-app and does not alter the existing AI Commerce Hub screens.

## Open the app

When the repository's GitHub Pages workflow succeeds and Pages is enabled, open:

\`https://fayisaftha786.github.io/-ai-commerce-hub-/content-rewards-assistant/\`

Or run the existing root project as usual and open \`content-rewards-assistant/index.html\` through a static local server. A secure HTTPS/localhost context is needed for service-worker installation and clipboard permissions.

## What works in this version

- Create, edit, search, filter, and delete campaign records for Content Rewards, Whop and other creator programs.
- Account Center with official Content Rewards/Whop/help links, a local creator label, saved social handles and a manual workflow-readiness checklist.
- A 30-minute Content Rewards submission countdown, plus a preflight check that the selected posting platform matches the HTTPS post-link host and that the recorded link-submission time is within 30 minutes of posting.
- A legacy-safe submission log with the actual link-submission time stored separately from the post-publication time.
- Record deadlines, campaign rules, public post links, and manual review status.
- Generate English, Malayalam, or bilingual caption/script scaffolds from local templates.
- Save and sort mm:ss or hh:mm:ss editing notes.
- Export and validate a versioned JSON backup, with duplicate-ID, date, timestamp, URL-scheme, size and record-count checks; account-center records are included, and older backups without them still import.
- Responsive dark dashboard, mobile navigation, local-first storage and best-effort static-asset caching.
- Node.js regression tests for the core data validation and backup format.

## Content Rewards submission workflow

The in-app submission guide now separates the two official routes: standard campaigns (publish a public clip, then submit its link within 30 minutes) and pre-approval campaigns (upload a draft first, wait for approval, publish from an approved connected account, then submit the live link within 30 minutes). The local reminder timer applies only to Content Rewards campaigns; it does not impose Content Rewards' 30-minute rule on other programmes.

When a Content Rewards campaign is marked Submitted in the local tracker, select the actual posting platform, provide a matching public HTTPS post link, record when the post went live, and record when you actually submitted the link inside Content Rewards. The preflight rejects platform/link mismatches, submission times before posting, submissions later than 30 minutes, and future timestamps. This checks the information entered in this browser only; it cannot prove that the link was actually submitted or accepted on Content Rewards. Rejected is labelled as Rejected, not as a request for changes.

The current official flow requires the exact posting account to be connected and verified in Content Rewards (a Whop account connection alone does not count), Instagram Business account type, and each submission is checked for a connected account, duplicate submission to the same campaign and post age under 30 minutes. Pre-approval drafts are reviewed before posting and the final live post is reviewed again. See the official [submission guide](https://help.contentrewards.com/en/articles/15319814-submit-a-video), [account connection guide](https://help.contentrewards.com/en/articles/16746780-connect-your-social-accounts), and [approval and review guide](https://help.contentrewards.com/en/articles/15319801-approval-and-review).

## Important limitations — read before using

This is **not an official Content Rewards or Whop integration**. The Account Center only opens official pages and saves local reminders; it does not sign in, control the session, read account data, or verify that a social account is really connected. The 30-minute countdown is a local reminder, not a platform submission or verified receipt. No account login/OAuth connection, live campaign feed, reward eligibility verification, actual clip submission, video rendering, social publishing, views ingestion, payout tracking, or connected AI API is implemented in this MVP. The preflight only validates values entered by the creator; it cannot query Content Rewards or establish that a public post exists. The content generator is a local template helper, not a claim that an AI model has been connected. A true AI API requires a secure server-side integration; do not put secret API keys in frontend code or GitHub.

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

## Instagram account requirement for Content Rewards

The current Content Rewards account-connection guide says Instagram must be a **Business** account. Connect it in Content Rewards under Settings → Connected accounts → Connect account → Instagram, and continue only after the exact account you post from shows Connected. Do not confuse this with Meta's separate Instagram API for third-party publishing: ClipReward Studio does not use that API, does not log in, and cannot verify the linked state. See the [official Content Rewards connection guide](https://help.contentrewards.com/en/articles/16746780-connect-your-social-accounts).

AI Commerce Hub has a separate server-side Instagram configuration-readiness route, but it is not a Content Rewards connection and does not implement OAuth, token exchange, encrypted token storage, publishing or disconnect. GitHub Pages must never contain Meta App Secrets or access tokens.
