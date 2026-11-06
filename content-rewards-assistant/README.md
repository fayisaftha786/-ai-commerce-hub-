# ClipReward Studio

A standalone, mobile-friendly creator workspace intended to reduce administrative work around clipping campaigns. It is added as a separate sub-app and does not alter the existing AI Commerce Hub screens.

## Open the app

When the repository's GitHub Pages workflow succeeds and Pages is enabled, open:

\`https://fayisaftha786.github.io/-ai-commerce-hub-/content-rewards-assistant/\`

Or run the existing root project as usual and open \`content-rewards-assistant/index.html\` through a static local server. A secure HTTPS/localhost context is needed for service-worker installation and clipboard permissions.

## What works in this version

- Create, edit, search, filter, and delete campaign records for Content Rewards, Whop and other creator programs.
- Account Center with official Content Rewards/Whop/help links, a local creator label, saved social handles and a six-step manual workflow-readiness checklist, including an 18+ self-confirmation (no date of birth collected and no age verification).
- A 30-minute Content Rewards submission countdown, opt-in browser reminders at the final 15/5/1 minutes, and one-tap “set time to now” controls for the actual post and link-submission timestamps. Alerts require browser permission and are best-effort while the app page is running; they cannot wake a closed/suspended page.
- A legacy-safe submission log with the actual link-submission time stored separately from the post-publication time.
- Record deadlines, campaign rules, public post links, and manual review status.
- Generate English, Malayalam, or bilingual caption/script scaffolds from local templates.
- Save and sort mm:ss or hh:mm:ss editing notes.
- Export and validate a versioned JSON backup, with duplicate-ID, date, timestamp, URL-scheme, size and record-count checks; account-center records are included, and older backups without them still import.
- Responsive dark dashboard, mobile navigation and local-first browser storage.
- On HTTPS/localhost, the page registers its own scoped service worker and refreshes a versioned asset cache using network-first requests with an offline fallback. Open the page online at least once after an update before relying on the new files offline; `file://` usage does not install the worker.
- Node.js regression tests for the core data validation and backup format.

## Automated public campaign discovery

The automation path uses the official public [Content Rewards Discover page](https://contentrewards.com/c/discover). GitHub Actions scans the public listing and fetches up to 100 visible campaign detail pages about every six hours (best effort), then publishes a versioned snapshot for the app. Snapshot-only commits do not re-trigger the crawler. When the app opens, it loads that snapshot and automatically screens each readable campaign against Instagram, Facebook and YouTube. It combines duplicate campaign URLs, ranks Promising / Verify / Blocked results, imports fresh Promising leads into the local tracker as **Found / idea**, and prepares one bilingual template draft for the top fresh Promising campaign with an unlocked public brief when the draft area is empty.

While the app remains open, it checks for a newer published snapshot every 30 minutes and also checks when the app returns to the foreground. GitHub Actions is the background crawler; the in-page timer cannot run when the browser is closed or guarantee a closed-app alert. The third-party manual lead finder, custom URL/text analyser and manual import controls are hidden from the automation-first interface.

The optional Cloudflare Worker can fetch one allowed public Content Rewards campaign page live and host the official YouTube / Meta OAuth publishing routes after it is deployed and configured. The static GitHub Pages app does not claim live per-click fetching or connected social accounts when the Worker is absent. The fetcher accepts only public HTTPS \`contentrewards.com\` campaign detail pages, sends no cookies or account credentials, applies redirect/size/timeout/concurrency/rate limits, and does not bypass sign-in, Join gates or CAPTCHAs. Private or hidden requirements remain unknown.

## Automatic batch deep analysis

After the official public snapshot loads, ClipReward Studio screens every readable saved public campaign detail against **Instagram, Facebook and YouTube** automatically. The target-platform dropdown filters the detailed findings view only; it does not restrict automation. Each result is ranked into **Promising**, **Verify** and **Blocked** using the campaign parser and Rewards Intelligence checks. The app combines results by official campaign URL, retaining the strongest supported platform match, and automatically imports fresh Promising campaigns as **Found / idea**. TikTok and the manual third-party lead finder are excluded from this automation path.

The shortlist is a rules-and-evidence screen, not a probability of approval, earnings estimate or confirmation that a campaign is still accepting creators. Stale page text is forced into Verify even when its old rules otherwise look promising. Imported tracker items remain **Found / idea**. The app does not join or apply for campaigns.


## Campaign analysis to Clip Studio handoff

When a fresh, readable, unlocked **Promising** result is found, the app automatically prepares a bilingual local-template draft for the highest-ranked result if the Clip Studio draft area is empty. It carries the campaign title and target platform into the draft and selects the matching Tracker record. The verified-benefit field remains blank: the app does not invent product claims, reward promises or campaign facts. Existing draft text is never overwritten. Review the full official brief, add only a benefit you can substantiate, and edit the generated draft before use.

## Automatic batch import and draft preparation

After the official scheduled snapshot loads, cross-platform analysis automatically imports each fresh, readable **Promising** public campaign once, deduplicating by canonical campaign URL. It skips Verify, Blocked, stale, historical, unreadable and invalid records. Join-locked leads may be recorded only as ideas with the hidden requirements explicitly marked unknown. New tracker records remain **Found / idea** and are stored locally in this browser. When the draft area is empty, the app prepares one bilingual template draft for the highest-ranked fresh Promising campaign with an unlocked public brief. It does not invent a benefit, payout promise or campaign fact, and it never overwrites an existing draft. The automation does not claim to Join, Apply, publish or submit a campaign.

## Campaign finder and autofill

The automation radar is the primary campaign-discovery path: it reads the official public Discover listing on a schedule and analyses the saved detail pages without requiring a manual campaign lookup. The prior manual third-party lead finder and custom URL/text-entry controls are hidden from the automation-first interface. The target-platform selector only filters the detailed report; automated screening always covers Instagram, Facebook and YouTube.

The parser reads the full page text (up to 20,000 characters) retrieved from the public page or entered through the optional clipboard fallback, not only its first preview excerpt. For public campaign detail pages it extracts campaign type, payout model, platform, rate (including labels where the amount is on the next line), spent/total/remaining budget, minimum payout thresholds per platform, maximum payout / clip cap, minimum/maximum views, shared Pool total, split basis and payout timing, minimum followers, deadline, access type, accepting/paused/ended status, duration, aspect ratio/resolution, languages, hashtags, mentions and up to 60 visible rule lines. It associates rates, minimum payout thresholds, caps and view thresholds with each platform heading when the page presents the amount on following lines. Shared-pool pages retain the total pool size, allocation basis and payout timing, without deriving a guaranteed per-creator amount. Some campaign pages explicitly hide creator requirements and reference files until after Join; ClipReward flags the count as locked/unknown and will not describe the visible page as a complete brief. Re-open and analyse the full requirements after joining and before you produce or publish. It cannot guarantee recognition of every custom sentence; review the displayed missing fields against the official campaign page. Explicit platform mismatch blocks autofill; an unstated platform requires manual verification. The tracker now records **Found → Applied → Joined → Editing → Ready → Submitted → Approved/Rejected** so application and joining progress are visible without pretending the app has performed those actions.

**Finding boundary:** this is scheduled public-page retrieval for listed campaign URLs plus optional clipboard fallback, not an official Content Rewards API or instantaneous private-site crawler. No publicly documented Content Rewards campaign API is integrated here. We do not scrape private or signed-in pages, read account sessions, apply/join campaigns or infer missing eligibility. Private or invitation-only campaigns may not appear in public Discover.

Extraction is only as accurate as the public HTML text the scanner can retrieve or the text supplied through the optional fallback. A value shown as missing was not recognised; it is not zero. The app does not estimate your eligibility, infer a missing payout, validate campaign availability, join/apply to campaigns, or access private invitations. Some campaigns are private and arrive only by invitation. Do not paste passwords, one-time codes, cookies or private account data. The official platform remains the source of truth for remaining budget, accepted accounts, eligibility and application status.

## Automatic refresh behaviour

GitHub Actions is the background crawler and attempts a public campaign refresh about every six hours. When the app is open, it checks the published snapshot every 30 minutes and refreshes automatically when a newer snapshot is available. Returning to the app after it was backgrounded also triggers a freshness check. The in-page timer cannot wake a closed browser or guarantee a notification while the app is closed.

**Trust and availability boundary:** the source is the publicly visible official Discover page, not an authenticated API. Public campaign pages can omit private or Join-only fields. The app cannot confirm account eligibility, current campaign availability, remaining budget, approval or payout. It labels stale/unknown records and preserves missing facts as unknown. No passwords, OTPs, cookies or private account data are fetched or stored.

## Unified Rewards Intelligence Engine

After a campaign brief is analysed, the engine creates an action plan for the selected campaign platform and shows separate native monetization checklists for YouTube, Facebook and Instagram.

- Campaign checks distinguish an accepted-platform match, an explicit mismatch, missing evidence, an expired copied deadline, payout model and remaining budget. A complete-looking brief is labelled **Promising — verify before applying**, never "eligible" or "approved".
- The requirement scan highlights explicit originality, disclosure, minimum duration, hashtags, partner mentions, pre-approval, reuse / watermark restrictions and submission-window rules when present in the pasted text. These are prompts to verify, not proof that the final clip complies.
- CPM, per-post, retainer and shared-pool payouts have different guidance. CPM uses a formula based on eligible qualified views and campaign caps; a shared pool is never converted into an invented CPM. The analysis shows the current creator-fee rule (CPM/Pool 10%; per-post/retainer 10% below US$5,000 total budget and 0% at or above US$5,000 when those USD terms apply), with an official [Creator Terms](https://contentrewards.com/terms) link. Non-USD or missing budgets remain fee-unknown. No amount is forecast when required views, caps or allocation details are missing.
- YouTube YPP, Facebook Content Monetization and Instagram creator / brand partnership routes are three separate official-dashboard checklists. Each stays **Live eligibility not connected** until the creator checks the actual account in the relevant app.
- Platform rules change. The engine links to official platform sources and asks the creator to confirm current thresholds, region availability, invitations, policies and payout onboarding inside the platform. A help link is not account verification.
- No Content Rewards creator API for private campaigns, account insights, application/join, clip submission, review decisions or payout sync is integrated. Separate official social-platform OAuth/publishing code exists for YouTube, Facebook Page Reels and linked Instagram Professional Reels, but it requires a deployed/configured backend, approved provider access and an explicit creator publish action. It does not scrape signed-in Content Rewards pages or store Content Rewards passwords, OTPs or cookies.

This is an evidence-first decision aid: it helps decide what to verify and prepare next; it cannot create eligibility, guarantee views or rewards, or mark estimated/pending money as paid.

## Real Reels / Shorts video export

ClipReward Studio now includes a browser-side video renderer. On a supported mobile/desktop browser, the creator can choose up to 8 local photo/video files (150 MB combined), optionally add one voice-over or music file (40 MB), set a 15/30/60-second duration, add one caption line per scene, and render a vertical 720 × 1280 / 24 fps video locally in the browser. Uploaded source-video audio is muted; a separate audio file can be mixed into the export. The Clip Studio can copy lines from the generated script into the scene-caption editor.

The Studio includes a four-second **Test this phone** action that exercises the device's actual canvas → MediaRecorder → Blob → metadata-read path before the creator commits to a longer export. The renderer checks for MediaRecorder, canvas capture, animation-frame support and a supported codec before enabling export. It prefers MP4 only when the browser explicitly reports an MP4 MediaRecorder codec; otherwise it uses a supported WebM codec and labels the output honestly. It verifies that the resulting file is a readable video with the expected 9:16 dimensions and duration before enabling Save. It supports cancellation and reports render/decode/storage errors instead of showing a false success.

**Device requirements and limitations:** this is deterministic editing of media the creator uploads, not a text-to-video AI generator. It does not invent new scenes, generate Malayalam speech, remove watermarks, or upload/publish. Audio must be supplied as a permitted file. Media decode support and MP4/WebM codecs differ by browser/device; the capability check and output verification are authoritative for each session. A successful Node regression suite does not substitute for a real-device export test. Test with a short original clip in the target phone browser before using large files or a campaign deadline. Use only media you own or have permission to use, and separately confirm that the campaign allows the source material, music, AI-generated elements and the final format.

## Optional privacy-aware voice typing

ClipReward Studio can use the browser's Web Speech recognition service to fill the transcript, video notes, detected-scene subtitles, rendered scene captions, social caption or topic field. Choose Malayalam (ml-IN), Indian English (en-IN) or Hindi (hi-IN). Only final recognition results are appended; interim guesses are ignored. The transcript field is opened automatically when selected.

On-device recognition is the default and is required unless the creator explicitly checks the online-processing consent box. If the browser exposes the Web Speech on-device mode, the app sets processLocally = true; if it does not, voice typing stays blocked until the creator explicitly permits the browser's online speech service. Browser support and language packs vary, so this is an optional convenience, not a guaranteed feature. The Web Speech API is not supported in every major browser, and some implementations send microphone audio to a remote recognition service. See the [MDN SpeechRecognition reference](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) and its browser compatibility notes.

This is live microphone dictation only. It does **not** extract or transcribe speech from an uploaded video/audio file, and it is not a fully local offline Whisper engine. The app does not save microphone recordings. Do not dictate credentials or private information. Always check Malayalam spelling, names, amounts, campaign claims and subtitle timing before publishing.

## Send the finished video export to Social Media Desk

After the local renderer verifies the exported 720 × 1280 video, **Send finished video + caption to Social Desk** hands the actual rendered file—not the original source clip—to the main app's Social Media Desk. The caption, target platform and selected local campaign reference travel with the file through the same-origin, opener-checked message handshake. The browser must allow the pop-up and support transferring a File object. The Social Desk import limit is 50 MB; larger exports can still be saved locally but must be reduced before handoff.

For Content Rewards campaigns, the handoff blocks records that are still Found / idea or Applied; the local tracker must be Joined, Editing or Ready. This is a local-state guard, not proof of a real Join / Apply action. If the saved brief requires draft pre-approval, the creator must first submit the draft through Content Rewards and explicitly attest that approval was received before the handoff is allowed.

A successful handoff fills the Social Desk with the rendered file, caption, target platform and local campaign context. YouTube publishing uses the official Google OAuth/backend path; Facebook Page Reels and linked Instagram Professional Reels use the official Meta OAuth/Graph API backend path. Each requires a deployed/configured backend, the correct account connection, required provider permissions, supported media, campaign preflight checks and a separate explicit publish confirmation. A provider-confirmed public post URL and timestamp can be recorded in the selected local tracker entry for YouTube or Meta, and the 30-minute reminder starts from that verified public timestamp. This is not Content Rewards account verification: the creator must separately confirm the exact posting account is connected and verified inside Content Rewards. X remains a manual handoff. The creator must still open Content Rewards and submit the public post link there; the app does not press Submit clip, confirm Content Rewards receipt, approve content or sync payout.

## Campaign-aware video export preflight

The video studio reads the saved campaign selected in the Clip Studio campaign dropdown and compares its stored rule notes with the selected output platform, selected video duration, saved deadline, hashtags and @mentions typed into the social post caption. A platform mismatch, out-of-range duration or expired saved deadline blocks export. Missing/unknown rules, disclosure wording and requirements locked until Join are presented for manual review. The creator can append hashtags and mentions detected in the saved brief to the post caption.

This is a local check of the campaign notes stored by the creator, not a live campaign API or final compliance approval. The official current campaign brief remains authoritative. Unknown fields stay visible and the separate live-rules confirmation is still required.

## Content Rewards submission workflow

The in-app submission guide now separates the two official routes: standard campaigns (publish a public clip, then submit its link while the post is less than 30 minutes old) and pre-approval campaigns (upload a draft first, wait for approval, publish from an approved connected account, then submit the live link while the post is less than 30 minutes old). The local reminder timer applies only to Content Rewards campaigns; it does not impose Content Rewards' 30-minute rule on other programmes. The Account Center can enable browser notifications for the final 15/5/1 minutes. Keep the workspace open and the browser notification permission enabled; a local web timer is not a push service and cannot wake a closed or suspended page. “I just published” and “I just pressed Submit clip” shortcuts record the current device time, but the creator must confirm that the action actually happened.

When a Content Rewards campaign is marked Submitted in the local tracker, select the actual posting platform, provide a matching public HTTPS post link, record when the post went live, and record when you actually submitted the link inside Content Rewards. The preflight rejects platform/link mismatches, submission times before posting, submissions at or beyond 30 minutes, and future timestamps. This checks the information entered in this browser only; it cannot prove that the link was actually submitted or accepted on Content Rewards. Rejected is labelled as Rejected, not as a request for changes.

The exact posting account must be connected and verified in Content Rewards (a Whop sign-in alone does not connect the social profile). **Instagram documentation currently conflicts:** the connection guide says Business only, while Creator Terms §14.1 and Privacy Policy §4.1 allow Professional/Business or Creator accounts through OAuth. Try the existing Creator account in the official flow first; if rejected, save the exact error and ask Support before switching account type. The service checks the connected account, duplicate submissions to the same campaign and post age under 30 minutes. Pre-approval drafts are reviewed before posting and the final live post is reviewed again. See the official [submission guide](https://help.contentrewards.com/en/articles/15319814-submit-a-video), [account connection guide](https://help.contentrewards.com/en/articles/16746780-connect-your-social-accounts), [Creator Terms](https://contentrewards.com/terms), [Privacy Policy](https://contentrewards.com/privacy-policy), and [approval and review guide](https://help.contentrewards.com/en/articles/15319801-approval-and-review).

## Platform account verification

Complete account linking inside Content Rewards under Settings → Connected accounts. A Whop link does not count. The exact account that publishes the clip must be connected and verified on the same platform; each social account can belong to only one Content Rewards account at a time.

- **Instagram:** connect through Content Rewards → Settings → Connected accounts → Connect account → Instagram and try the existing Creator account first. The connection guide says Business only, but Creator Terms §14.1 and Privacy Policy §4.1 say Professional/Business or Creator. If the official flow rejects Creator, ask Support with the exact error before switching. Do not put a `CR-XXXXXX` code in your bio unless the live flow explicitly instructs you to do so.

For this India-first workspace, TikTok is not offered as a posting destination because it is not available in India. The parser may still detect TikTok in a copied international campaign brief, but it flags it separately and does not treat it as an available India workflow.
- **YouTube and X:** use the official platform sign-in window, choose the exact channel/account you post from, and approve the requested access. For YouTube, select the Google login that owns the channel and keep the requested channel permissions enabled.
- **Facebook:** follow the current verification prompt: place the Content Rewards code in a Facebook Reel caption, set the Reel audience to Public, copy that Reel's permalink into the verification box, and press Verify. A check can take around 30 seconds.

A green local checkbox in ClipReward Studio is only your reminder; it cannot verify the platform state. Use the platform-specific verification method shown in Content Rewards; do not reuse old Instagram bio-code instructions. See the official [connection guide](https://help.contentrewards.com/en/articles/16746780-connect-your-social-accounts) and [account troubleshooting guide](https://help.contentrewards.com/en/articles/16817242-your-account-shows-as-not-linked).

## Submission timing and duplicate rules

A standard post must be public and **strictly less than 30 minutes old when you press Submit clip**. Exactly 30:00 is too old. Every post can be submitted to a particular campaign once. The official dialog accepts several post links, one per line, and checks each independently. For a pre-approval campaign, upload a draft first, wait for that draft to be approved, publish from an account approved on that draft, then submit the live link under the same less-than-30-minute rule.

ClipReward Studio records one post URL per local campaign record. It does not call the Content Rewards dialog, submit multiple links, detect duplicate submissions on the live service, upload pre-approval drafts, or prove that the receipt was accepted. Keep the official Submissions page as the source of truth. See [Submit a video](https://help.contentrewards.com/en/articles/15319814-submit-a-video).

## Important limitations — read before using

This is **not an official Content Rewards or Whop account integration**. The Account Center opens official pages and stores local reminders; it does not sign in to Content Rewards, read private creator data or independently verify a linked social account. Public campaign discovery, rule analysis, local tracker updates, local video rendering and Social Desk handoff are implemented. Separate YouTube and Meta (Facebook Page / linked Instagram Professional) OAuth publishing code is also implemented, but it is not live until a private backend is deployed, environment variables and persistent encrypted storage are configured, provider permissions/review are complete, and a real account test succeeds. A provider publishing integration is separate from Content Rewards account verification. The creator must complete Join/Apply, verify the exact posting account in Content Rewards, and manually submit the public post URL there within the 30-minute window. No Content Rewards API for Join/Apply, Submit Clip, private credited views, review/approval or payout sync is integrated. A provider-confirmed public post receipt can be saved locally; it is not proof that Content Rewards accepted the submission. The 30-minute countdown and notifications are local reminders, not a platform submission or receipt. The app does not guarantee eligibility, views, campaign approval or payment. The video renderer is a local editor, not a connected text-to-video AI service. Do not put passwords, OTPs, cookies, access tokens or API secrets in the browser app or GitHub.

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

The official Content Rewards connection guide says Instagram must be Business-only, but Creator Terms §14.1 and Privacy Policy §4.1 (both currently published by Content Rewards) allow Professional/Business or Creator accounts through OAuth. This is a genuine documentation conflict. Try your existing Creator account in the official connection flow first; if rejected, send Support the exact error and request clarification before switching account type. Continue only when the exact account you post from shows Connected. Do not confuse Content Rewards' own account-linking flow with ClipReward's separate Meta publisher OAuth. See the [connection guide](https://help.contentrewards.com/en/articles/16746780-connect-your-social-accounts), [Creator Terms](https://contentrewards.com/terms), and [Privacy Policy](https://contentrewards.com/privacy-policy).

AI Commerce Hub has a separate server-side Instagram configuration-readiness route, but it is not a Content Rewards connection and does not implement OAuth, token exchange, encrypted token storage, publishing or disconnect. GitHub Pages must never contain Meta App Secrets or access tokens.


## Discovery Engine V2 — scheduled public snapshot

The Rewards Intelligence Radar loads the latest public campaign snapshot published at `discovery-snapshot.json`. A GitHub Actions workflow on the repository's default branch attempts to refresh it about every six hours (UTC), performs deduplication, updates evidence-coverage/freshness scores, records scan history and republishes the static app. It can be manually triggered from GitHub → Actions → **Scheduled Content Rewards discovery snapshot** → **Run workflow**.

The schedule is best-effort: GitHub may delay or drop schedule events during high load, and public-repository scheduled workflows can be disabled after 60 days without repository activity. This is not a live or guaranteed six-hour SLA. The app also has a manual scan/browser fallback; browser timers only operate while the page is open and visible. A separately hosted Node.js backend is optional for advanced server integrations and is not needed for the published public snapshot.

The official Discover page is now the primary campaign-link source. If it cannot be fetched or its campaign links cannot be extracted, the app falls back to the third-party public feed at `https://contentrewards.xyz/api/cr/campaigns`; this feed is not an official Content Rewards API. Public Discover intentionally does not expose private/invitation-only/joined-only campaign information; the app cannot discover hidden campaign details from public data. The official Discover page remains the verification source for campaign status, application, rules and eligibility. <https://help.contentrewards.com/en/articles/15319814-submit-a-video>

The radar keeps older leads for history, but if a campaign disappears from the latest official Discover scan it is marked **not seen in latest scan**, ranked below every current lead, excluded from the current high-information count, and forced into **Verify** rather than **Promising** even when an old saved detail page still looks attractive. Expired deadlines stay separately marked. Scores measure evidence coverage/freshness only, never likelihood of reward or approval.

For the optional no-VM Cloudflare deployment, read the [Cloudflare Worker setup guide](../docs/CLIPREWARD_CLOUDFLARE_SETUP.md). The older [Node.js backend guide](../docs/BACKEND.md) remains available for a separately hosted server. No account passwords, OTPs, cookies, tokens or private creator analytics are sent to the public feed or stored in the published snapshot.



## Creator Operations — evidence, review and payout tracking

The Creator Operations panel links operational evidence to each saved campaign. It records views with their source and capture time, the reward amount explicitly confirmed by the official campaign, the review decision timestamp and notes, payout state (unconfirmed, pending, available, partially paid, paid, or not eligible), the amount actually received, payment date and an optional transaction reference. The dashboard keeps **views**, **approved rewards**, **payout state** and **cash received** separate; values are not inferred from one another. Currency values are never added across different currencies.

The app gives one-time in-page reminders when a recorded Content Rewards post is within five minutes and within one minute of its 30-minute link-submission deadline. These reminders run only while this page is open and its timer is active. They do not submit a clip, extend the deadline, or prove the official platform accepted the link.

**Data boundary:** creator views and payout records are typed from the relevant official dashboard by the account owner. Public campaign scans do not include private creator analytics. Raw social-platform views are not automatically treated as eligible Content Rewards views. CPM and pool amounts are not forecast as confirmed income. The app does not approve clips, read private account status, initiate withdrawals, or sync Whop / bank balances. The payout ledger is a local evidence log, not an official financial statement or payout integration.

Backup format is now version 2. Version 1 ClipReward backups continue to import; new fields default to “not recorded” rather than inventing historical figures. Campaign operations data is included in the normal ClipReward backup and in the main AI Commerce Hub backup when that workspace export is used.


## Separate Content Rewards and Whop settlement stages

The payout ledger now distinguishes three different events instead of calling all of them “paid”:

1. **Content Rewards Balance credit** — the amount shown as received in the Content Rewards Earnings area. The old local fields `paidAmount` / `paidAt` are retained for backup compatibility, and the UI now labels them as CR balance credit.
2. **Withdrawal to Whop Balance** — the amount and date shown after the creator moves money out of the Content Rewards balance into Whop. This has its own reference field.
3. **Final Whop payout** — the amount/date shown by Whop as paid to the bank or selected payout method. This has separate fields and a separate reference.

The Creator Operations panel includes a guide-based payout timeline calculator. CPM is estimated at approval plus 7 earning days and a 3-day hold (day 10); the minimum-view milestone is a prerequisite, not a reason to move the 10-day clock forward. Per-post shows a 15–30 minute window after both approval and the recorded minimum-view milestone. Retainer is estimated about 15 minutes after the cycle ends. The current official creator guide does not provide a universal Pool settlement schedule, so Pool timing is deliberately left unestimated unless an actual date appears in official Earnings or written campaign terms. Open flags pause any estimate. These are conditional dates derived from creator-entered facts and current public rules, not live account data or guaranteed payment dates. Keep the separate “Date shown in official Earnings page” field for an actual date displayed by Content Rewards.

## Verified YouTube public-post handoff

When a Content Rewards campaign is selected in Clip Studio, its local campaign ID is carried into the Social Media Desk handoff. If the saved brief indicates draft pre-approval, the handoff is blocked until the creator explicitly attests that the official campaign team has approved the draft for the account that will publish. This is a creator attestation, not a CR API verification.

YouTube visibility defaults to **Private**. Choosing **Public** reveals a separate confirmation checkbox and a second explicit publish confirmation. Upload completion alone is not a public-post event. The creator then checks video status; the backend uses the official YouTube video status resource and waits for `uploadStatus=processed`, `processingDetails.processingStatus=succeeded` and `privacyStatus=public`. Only then does it pass YouTube's actual `snippet.publishedAt` timestamp and public URL to the originating Clip Studio window. A video still processing, Private or Unlisted does not start the Content Rewards timer. A later Public status check can complete the handoff while the Clip Studio window remains open.

On a valid handoff, the matching local campaign moves to **Published · submit clip now**, saves the public YouTube URL and provider-reported public timestamp, and starts the 30-minute reminder/countdown. The Submission log shows this published-but-not-submitted state separately. The creator must still open the official Content Rewards campaign and manually press **Submit clip** with the public URL before the 30-minute window expires. Only after the creator actually submits should they record that submission time and move the local tracker to Submitted. A saved local record is never a Content Rewards receipt.

This YouTube handoff requires the app's private HTTPS backend, Google OAuth configuration, encrypted token storage, the connected channel and the read/upload permissions. GitHub Pages by itself is static and cannot host the OAuth callback or video API. Instagram, Facebook and X are not auto-published by this path. The social desk must remain open for status polling and same-origin handoff; if the originating Clip Studio tab is closed or suspended, copy the verified YouTube URL and public timestamp into the correct campaign record manually.  Validation prevents recording a transfer larger than the prior recorded CR balance credit, and prevents recording a final Whop payout larger than the amount transferred to Whop. Partial transfers and payments remain possible.

These fields are evidence manually entered from the respective official dashboards. They are not live integrations. Version 2 backups continue to round-trip and older version 1 backups remain importable; all additional settlement fields are optional for existing records.


Legacy receipt safety: records created before the three-stage ledger may contain a generic “received” amount without identifying whether it was in Content Rewards Balance, Whop Balance or a bank account. Such records are kept intact but displayed as **legacy amount · destination unknown** and do not count as confirmed CR balance credits. Before recording a subsequent Whop transfer, explicitly confirm the earlier amount came from Content Rewards Balance. This avoids silently reclassifying historical amounts.
