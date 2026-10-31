# ClipReward Studio

A standalone, mobile-friendly creator workspace intended to reduce administrative work around clipping campaigns. It is added as a separate sub-app and does not alter the existing AI Commerce Hub screens.

## Open the app

When the repository's GitHub Pages workflow succeeds and Pages is enabled, open:

\`https://fayisaftha786.github.io/-ai-commerce-hub-/content-rewards-assistant/\`

Or run the existing root project as usual and open \`content-rewards-assistant/index.html\` through a static local server. A secure HTTPS/localhost context is needed for service-worker installation and clipboard permissions.

## What works in this version

- Create, edit, search, filter, and delete campaign records for Content Rewards, Whop and other creator programs.
- Account Center with official Content Rewards/Whop/help links, a local creator label, saved social handles and a six-step manual workflow-readiness checklist, including an 18+ self-confirmation (no date of birth collected and no age verification).
- A 30-minute Content Rewards submission countdown, plus a preflight check that the selected posting platform matches the HTTPS post-link host and that the recorded link-submission time is within 30 minutes of posting.
- A legacy-safe submission log with the actual link-submission time stored separately from the post-publication time.
- Record deadlines, campaign rules, public post links, and manual review status.
- Generate English, Malayalam, or bilingual caption/script scaffolds from local templates.
- Save and sort mm:ss or hh:mm:ss editing notes.
- Export and validate a versioned JSON backup, with duplicate-ID, date, timestamp, URL-scheme, size and record-count checks; account-center records are included, and older backups without them still import.
- Responsive dark dashboard, mobile navigation and local-first browser storage.
- On HTTPS/localhost, the page registers its own scoped service worker and refreshes a versioned v9 asset cache using network-first requests with an offline fallback. Open the page online at least once after an update before relying on the new files offline; `file://` usage does not install the worker.
- Node.js regression tests for the core data validation and backup format.

## Campaign finder and autofill

The Finder opens the official [Content Rewards Discover page](https://contentrewards.com/c/discover) for Instagram, Facebook, YouTube and X campaigns. TikTok may appear in international briefs but is not offered as an India posting destination. Choose the platform, open Discover, check the campaign’s accepted platforms and eligibility, then copy its public card/brief text. Return to ClipReward Studio and press **Paste & analyse brief**; clipboard text is extracted immediately and manually pasted text is analysed as you type. Press **Autofill campaign tracker**, review the extracted fields, then save. The native creator dashboards do not expose one public cross-platform campaign feed to this app.

The parser reads the full copied text (up to 20,000 characters), not only its first preview excerpt. It extracts campaign type, payout model, spent/total/remaining budget, accepted and excluded platforms, per-platform CPM/per-post/retainer/pool rates where shown, per-clip caps, minimum/maximum views, minimum followers, deadline, access type, apparent live/paused/ended status, duration, aspect ratio/resolution, languages, hashtags, mentions and up to 60 explicit rule lines. For platform sections copied as a heading followed by values, it associates each rate/cap/view threshold with that platform. It cannot guarantee recognition of every custom sentence; review the complete official brief and the displayed missing fields. Explicit platform mismatch blocks autofill; an unstated platform requires manual verification. The tracker now records **Found → Applied → Joined → Editing → Ready → Submitted → Approved/Rejected** so application and joining progress are visible without pretending the app has performed those actions.

**Finding boundary:** this is official Discover navigation + clipboard-assisted findings/autofill, not a live campaign feed. No publicly documented Content Rewards campaign API is integrated here. We do not scrape private or signed-in pages, read account sessions, apply/join campaigns or infer missing eligibility. Private or invitation-only campaigns may not appear in public Discover.

Extraction is only as accurate as the text copied from the official page. A value shown as missing was not recognised; it is not zero. The app does not estimate your eligibility, infer a missing payout, validate campaign availability, join/apply to campaigns, or access private invitations. Some campaigns are private and arrive only by invitation. Do not paste passwords, one-time codes, cookies or private account data. The official platform remains the source of truth for remaining budget, accepted accounts, eligibility and application status.

## Unified Rewards Intelligence Engine

After a campaign brief is analysed, the engine creates an action plan for the selected campaign platform and shows separate native monetization checklists for YouTube, Facebook and Instagram.

- Campaign checks distinguish an accepted-platform match, an explicit mismatch, missing evidence, an expired copied deadline, payout model and remaining budget. A complete-looking brief is labelled **Promising — verify before applying**, never "eligible" or "approved".
- The requirement scan highlights explicit originality, disclosure, minimum duration, hashtags, partner mentions, pre-approval, reuse / watermark restrictions and submission-window rules when present in the pasted text. These are prompts to verify, not proof that the final clip complies.
- CPM, per-post, retainer and shared-pool payouts have different guidance. CPM uses a formula based on eligible qualified views and campaign caps; a shared pool is never converted into an invented CPM. The analysis shows the current creator-fee rule (CPM/Pool 10%; per-post/retainer 10% below US$5,000 total budget and 0% at or above US$5,000 when those USD terms apply), with an official [Creator Terms](https://contentrewards.com/terms) link. Non-USD or missing budgets remain fee-unknown. No amount is forecast when required views, caps or allocation details are missing.
- YouTube YPP, Facebook Content Monetization and Instagram creator / brand partnership routes are three separate official-dashboard checklists. Each stays **Live eligibility not connected** until the creator checks the actual account in the relevant app.
- Platform rules change. The engine links to official platform sources and asks the creator to confirm current thresholds, region availability, invitations, policies and payout onboarding inside the platform. A help link is not account verification.
- No Content Rewards or social-platform API, OAuth connection, private campaign feed, account insights, publisher, application/join automation or payout sync is integrated. It does not scrape signed-in pages or store passwords, OTPs, cookies or tokens.

This is an evidence-first decision aid: it helps decide what to verify and prepare next; it cannot create eligibility, guarantee views or rewards, or mark estimated/pending money as paid.

## Content Rewards submission workflow

The in-app submission guide now separates the two official routes: standard campaigns (publish a public clip, then submit its link while the post is less than 30 minutes old) and pre-approval campaigns (upload a draft first, wait for approval, publish from an approved connected account, then submit the live link while the post is less than 30 minutes old). The local reminder timer applies only to Content Rewards campaigns; it does not impose Content Rewards' 30-minute rule on other programmes.

When a Content Rewards campaign is marked Submitted in the local tracker, select the actual posting platform, provide a matching public HTTPS post link, record when the post went live, and record when you actually submitted the link inside Content Rewards. The preflight rejects platform/link mismatches, submission times before posting, submissions at or beyond 30 minutes, and future timestamps. This checks the information entered in this browser only; it cannot prove that the link was actually submitted or accepted on Content Rewards. Rejected is labelled as Rejected, not as a request for changes.

The current official flow requires the exact posting account to be connected and verified in Content Rewards (a Whop sign-in alone does not connect the social profile). Its current connection guide specifies Instagram professional Business accounts; follow the account-type options and instructions shown inside the live connection screen. The service checks the connected account, duplicate submissions to the same campaign and post age under 30 minutes. Pre-approval drafts are reviewed before posting and the final live post is reviewed again. See the official [submission guide](https://help.contentrewards.com/en/articles/15319814-submit-a-video), [account connection guide](https://help.contentrewards.com/en/articles/16746780-connect-your-social-accounts), and [approval and review guide](https://help.contentrewards.com/en/articles/15319801-approval-and-review).

## Platform account verification

Complete account linking inside Content Rewards under Settings → Connected accounts. A Whop link does not count. The exact account that publishes the clip must be connected and verified on the same platform; each social account can belong to only one Content Rewards account at a time.

- **Instagram:** connect through Content Rewards → Settings → Connected accounts → Connect account → Instagram and finish the official Instagram authorization screen. The current connection guide specifies a professional **Business** account. Do not put a `CR-XXXXXX` code in your bio unless the live Content Rewards flow explicitly instructs you to do so.

For this India-first workspace, TikTok is not offered as a posting destination because it is not available in India. The parser may still detect TikTok in a copied international campaign brief, but it flags it separately and does not treat it as an available India workflow.
- **YouTube and X:** use the official platform sign-in window, choose the exact channel/account you post from, and approve the requested access. For YouTube, select the Google login that owns the channel and keep the requested channel permissions enabled.
- **Facebook:** follow the current verification prompt: place the Content Rewards code in a Facebook Reel caption, set the Reel audience to Public, copy that Reel's permalink into the verification box, and press Verify. A check can take around 30 seconds.

A green local checkbox in ClipReward Studio is only your reminder; it cannot verify the platform state. Use the platform-specific verification method shown in Content Rewards; do not reuse old Instagram bio-code instructions. See the official [connection guide](https://help.contentrewards.com/en/articles/16746780-connect-your-social-accounts) and [account troubleshooting guide](https://help.contentrewards.com/en/articles/16817242-your-account-shows-as-not-linked).

## Submission timing and duplicate rules

A standard post must be public and **strictly less than 30 minutes old when you press Submit clip**. Exactly 30:00 is too old. Every post can be submitted to a particular campaign once. The official dialog accepts several post links, one per line, and checks each independently. For a pre-approval campaign, upload a draft first, wait for that draft to be approved, publish from an account approved on that draft, then submit the live link under the same less-than-30-minute rule.

ClipReward Studio records one post URL per local campaign record. It does not call the Content Rewards dialog, submit multiple links, detect duplicate submissions on the live service, upload pre-approval drafts, or prove that the receipt was accepted. Keep the official Submissions page as the source of truth. See [Submit a video](https://help.contentrewards.com/en/articles/15319814-submit-a-video).

## Important limitations — read before using

This is **not an official Content Rewards or Whop integration**. The Account Center only opens official pages and saves local reminders; it does not sign in, control the session, read account data, or verify that a social account is really connected. The current Content Rewards Terms require users to be at least 18 years old. The 30-minute countdown is a local reminder, not a platform submission or verified receipt. No account login/OAuth connection, live campaign feed, reward eligibility verification, actual clip submission, video rendering, social publishing, views ingestion, payout tracking, or connected AI API is implemented in this MVP. The preflight only validates values entered by the creator; it cannot query Content Rewards or establish that a public post exists. The content generator is a local template helper, not a claim that an AI model has been connected. A true AI API requires a secure server-side integration; do not put secret API keys in frontend code or GitHub.

Submission and approval status are user-maintained notes. A status marked “Approved” is not independently verified, and the app does not guarantee views, campaign acceptance, or payment. Use official platform workflows, verify deadlines and terms, respect music/media licenses, and include any required sponsorship or affiliate disclosure. Do not automate CAPTCHA, bypass access restrictions, create fake engagement, or use accounts without permission.

## Local data & privacy

Campaign data is stored in this browser's local storage on this device. It is not synchronized across devices or uploaded to a server. The main AI Commerce Hub **Export full backup** / **Restore from backup** now includes this ClipReward workspace alongside product and Earning Hub data. ClipReward's standalone backup remains available here too. Clearing browser data can erase it; keep backups private. Treat public URLs and campaign notes as potentially sensitive.

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

The current Content Rewards account-connection guide specifies a professional **Business** account for Instagram. Connect it in Content Rewards under Settings → Connected accounts → Connect account → Instagram, follow the live provider screen, and continue only after the exact account you post from shows Connected. Do not confuse this with Meta's separate Instagram API for third-party publishing: ClipReward Studio does not use that API, does not log in, and cannot verify the linked state. See the [official Content Rewards connection guide](https://help.contentrewards.com/en/articles/16746780-connect-your-social-accounts).

AI Commerce Hub has a separate server-side Instagram configuration-readiness route, but it is not a Content Rewards connection and does not implement OAuth, token exchange, encrypted token storage, publishing or disconnect. GitHub Pages must never contain Meta App Secrets or access tokens.
