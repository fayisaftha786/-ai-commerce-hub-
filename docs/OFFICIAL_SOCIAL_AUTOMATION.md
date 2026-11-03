# Official social publishing and Content Rewards automation

## Current implementation status — 2026-11-03

The repository contains code for public Content Rewards campaign discovery, rules/reward analysis, a local campaign tracker, browser-local video preparation, Clip Studio → Social Desk handoff, and official social publishing integrations for YouTube and Meta (Facebook Page Reels and linked Instagram Professional Reels).

This is **not a fully autonomous Content Rewards service**. No supported public creator API contract is integrated for Join/Apply, Submit Clip, private credited views, campaign review/approval, balance or payout. The creator must complete those actions in the official Content Rewards account. No eligibility, approval or earnings are guaranteed.

Merged implementation:
- PR #185 — YouTube OAuth and official upload flow.
- PR #191 — verified public YouTube post handoff and local submission timer.
- PR #196 — Meta Facebook Page and Instagram Professional Reels OAuth/publishing paths.
- PR #198 — Content Rewards publishing safeguards: campaign-state, accepted-platform, pre-approval and exact-account verification attestations.

The integrations are **code implemented, deployment and real-account verification pending** unless a live deployment and test receipt have separately been confirmed. Passing CI validates repository code/tests; it does not configure provider apps or prove a real upload.

## Capability matrix

| Workflow | Current implementation | Boundary / required creator action |
|---|---|---|
| Discover public Content Rewards campaigns | Scheduled GitHub Actions scan, official public Discover first, third-party public-feed fallback, saved snapshot and up to 100 public details | Snapshot is best-effort and may be stale; private/invitation-only/join-only details stay hidden |
| Analyze rules and reward terms | Platform matching, visible rule extraction, payout model/budget evidence, missing fields, Promising / Verify / Blocked ranking | Evidence aid only; re-open live brief and verify deadline, budget, eligibility and acceptance |
| Import campaigns to local tracker | Batch import of fresh/readable Promising rows with deduplication and stale/blocked filtering | Imports as Found / idea; it does not Join or Apply |
| Prepare video and post package | Browser-local media analysis, sampled frames/scene-cut heuristic, creator-supplied transcript/notes, SRT scaffolding, local 720×1280 renderer, captions and hashtags | Not text-to-video AI; no semantic scene recognition or automatic transcription of uploaded files; check device codec support |
| Send rendered export to Social Desk | Same-origin, opener-checked handoff of rendered file, caption, platform and campaign context | Handoff is not a publish; browser popup/File transfer and size/format limits apply |
| YouTube connect and publish | Google OAuth/PKCE, encrypted server-side token vault, channel identification, explicit upload confirmation, bounded automatic processing/public-visibility polling after upload, verified public receipt handoff | Requires deployed HTTPS backend, Google OAuth client, YouTube Data API access, scopes and connected channel |
| Facebook Page Reels connect and publish | Meta OAuth, managed Page selection, server-side token vault, upload/publish path, bounded automatic status polling and verified public permalink/time | Requires deployed HTTPS backend, Meta app, Page access and approved permissions/review; only eligible managed Pages |
| Instagram Reels connect and publish | Meta OAuth for linked Instagram Professional account, Reel container processing/publish path and public permalink/time | Requires eligible linked Professional account, Meta app permissions/review and a publicly fetchable temporary media URL |
| X / WhatsApp publishing | Manual Social Desk handoff | No official publisher integration is implemented here |
| Content Rewards account verification | Creator guidance and local explicit attestation gate | Connect and verify the exact posting account inside Content Rewards; the app cannot read or verify that private state |
| Join / Apply | Manual official Content Rewards flow, tracked locally | Creator completes Join/Apply, answers brand questions and waits for approval where required |
| Start 30-minute timer | Verified public YouTube/Meta publishing response can save post URL/time and start local reminder | Creator must confirm exact posting account is verified in Content Rewards; reminders require the page/browser to remain active |
| Submit Clip | Guided official link-submission workflow and local time/evidence fields | Creator manually submits public permalink in Content Rewards while the post is strictly less than 30 minutes old |
| Credited views, review, approval and payout | Local evidence/notes only | Read from official Content Rewards/Whop account; no private dashboard sync or payout API is integrated |


After an accepted YouTube or Facebook upload, the Social Desk now performs up to 24 provider-status checks at five-second intervals while the page remains open. A verified public permalink and timestamp are handed to the campaign tracker only after the provider confirms the completed public state. Private/unlisted YouTube uploads and timed-out/pending posts do not start the Content Rewards reminder. The manual status controls remain available after the bounded polling window.

## What a publish receipt means

A YouTube or Meta API response is accepted by the local tracker only after the provider confirms a public post and returns a platform permalink and publication timestamp. The Content Rewards publishing gate also requires:
- a matching local campaign in Joined, Editing or Ready state;
- the selected platform to match the campaign's accepted-platform rules;
- a creator attestation that the exact posting account has been connected/verified inside Content Rewards; and
- the required draft pre-approval attestation when the campaign requires pre-approval.

These safeguards do not query Content Rewards. The account-verification checkbox is the creator's assertion, not an API-backed verification. A “Published · submit clip now” state is **not** “Submitted”, “Accepted”, “Approved” or “Paid”. The creator must open the official campaign and submit the link. The local countdown uses the provider's public publication time; notifications are best-effort and cannot wake a closed/suspended page.

## Backend deployment and secrets

GitHub Pages serves the static frontend only; it cannot run OAuth callbacks, store tokens or upload media. Deploy the repository's Node/Docker backend on an HTTPS host with a persistent private volume, preferably same-origin with the frontend. Do not put credentials in GitHub source files, Pages assets, localStorage or chat.

Use the exact variables documented in **.env.example** and **BACKEND.md**:
- YouTube: **GOOGLE_CLIENT_ID**, **GOOGLE_CLIENT_SECRET**, **GOOGLE_REDIRECT_URI**.
- Meta: **META_APP_ID**, **META_APP_SECRET**, **META_REDIRECT_URI**, **META_MEDIA_BASE_URL**.
- Shared session/security: **SOCIAL_TOKEN_ENCRYPTION_KEY**, **SOCIAL_TOKEN_STORE_PATH**, **SOCIAL_CORS_ORIGINS**, **SOCIAL_RETURN_URL**, **SOCIAL_COOKIE_SAMESITE**.
- For separate frontend/backend origins, set exact HTTPS origins and assess browser third-party-cookie restrictions; do not use wildcard CORS. Same-origin deployment is preferred.

The encryption key must be 32 bytes and held only in the host's private environment-variable manager. Persist the encrypted vault on a private mounted volume. Keep the backend to one replica until OAuth pending state is moved to a shared expiring store. For Instagram, Meta must be able to fetch the temporary public media URL. Current API format, size and duration limits are documented in **BACKEND.md**. Never expose token values in logs or responses.

A backend /health response confirms process health only. Use GET /api/social/providers to inspect configuration readiness (it never returns secret values) and GET /api/social/connections to inspect the current browser session's safe connection metadata. “Configured” does not mean OAuth-authorized, publish-permission-approved or live-tested.

## Creator workflow

1. Use the latest campaign snapshot to shortlist a public campaign. Open the official campaign page and verify deadline, remaining budget, rules, account eligibility and accepted platform.
2. Complete Join / Apply on Content Rewards. For application campaigns, answer the brand's questions and wait for its decision. Update the local tracker only to reflect what you actually completed.
3. Re-open the post-join brief. Confirm disclosure, content rights, format, length, language, hashtags, mentions, originality and any pre-approval requirement.
4. Prepare the clip in Clip Studio. Review source rights, captions, transcript, scene boundaries and exported format. The renderer is local and device/browser codec support varies.
5. Connect the correct publisher account using Google or Meta OAuth. Separately verify that the **same exact account** is connected in Content Rewards. Connecting a Google/Meta account to this app does not verify it in Content Rewards.
6. Select the campaign and platform in Social Desk. Confirm campaign state/rules, account attestation, pre-approval if required, caption, destination and visibility. Publish only after explicit confirmation.
7. Wait for the provider to confirm a public post. Check the saved public URL and timestamp, then submit that URL manually through Content Rewards while the post is strictly less than 30 minutes old.
8. Record the actual Content Rewards submission time and any receipt/evidence. Do not mark it accepted based only on clicking a local button.
9. Record Content Rewards credited views, review outcome, approved amount/currency, Whop transfer and withdrawal only from official account evidence. Keep these separate from public platform views and projections.

## Content Rewards boundaries

The public scanner sends no Content Rewards cookies or login credentials and does not scrape private/signed-in pages, bypass CAPTCHA or access locked content. A public campaign page may omit join-only requirements, and the latest snapshot can be stale or incomplete. The tracker stores user-maintained progress; statuses do not prove that Content Rewards has changed state.

The current official Help Center page **What you can target, and what you can measure** explicitly lists an API as “Not available today”. The current Creator Terms §14.2 describe Content Rewards-linked social account access as read-only and state that Content Rewards does not post on the creator’s behalf. For that reason, this project does not call undocumented private endpoints, replay browser cookies or automate private Join/Apply, Submit Clip, review, views, balance or payout actions. The creator completes those steps in the official account. The app’s separate YouTube/Meta publishing integrations use the provider’s own OAuth/API permissions and are independent of Content Rewards’ read-only connection.

Do not automate private account actions without an official documented API and permission. Do not fabricate account verification, receipts, views, approval, balances or earnings. Do not create fake engagement or use media/accounts without permission. Keep required disclosure and licensing terms.

Official Content Rewards references:
- [Find and apply to a campaign](https://help.contentrewards.com/en/articles/16817237-find-and-apply-to-a-campaign)
- [Submit a video](https://help.contentrewards.com/en/articles/15319814-submit-a-video)
- [Connect social accounts](https://help.contentrewards.com/en/articles/16746780-connect-your-social-accounts)
- [Approval and review](https://help.contentrewards.com/en/articles/15319801-approval-and-review)
- [How Content Rewards works](https://help.contentrewards.com/en/articles/15319790-how-content-rewards-works)

## Release acceptance checklist

- [ ] Backend deployed over HTTPS with persistent private encrypted token storage.
- [ ] /health and /api/social/providers checked; readiness is not confused with connection.
- [ ] Google OAuth client, YouTube Data API and required scopes configured and approved as needed.
- [ ] Meta app, Page/Instagram linkage, required permissions and app review/access configured.
- [ ] YouTube real-account test: connect, upload a permitted test video, wait for processed/public status, verify permalink and timestamp.
- [ ] Meta real-account tests: connect a managed Page and eligible linked Instagram Professional account; publish permitted test Reels and verify public permalink/time.
- [ ] Content Rewards connected-account verification completed separately for the exact posting account.
- [ ] End-to-end test: Joined/Ready campaign → attested preflight → explicit publish → verified public receipt → local 30-minute timer → manual Content Rewards submission and actual receipt capture.
- [ ] Confirm local tracker never marks Content Rewards submission, approval or payout without actual evidence.
- [ ] Re-run CI and Pages deployment after every code change.

## Earnings and success controls

CPM, per-post, retainer and shared-pool campaigns have different rules. Any forecast depends on confirmed eligible views, limits, budgets, fee rules, review and allocation. Projections are scenarios, not approval probabilities or guaranteed income. Unknown fields must remain unknown; actual payable, credited views and payment must come from official records.
