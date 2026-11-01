# Official social publishing and Content Rewards automation

## Current truth (2026-11-01)

This repository is **not yet fully automated**. The current backend has a secure, read-only YouTube OAuth connection slice. It does not yet upload videos. Instagram and Facebook provider readiness checks exist, but their OAuth flows and publishing APIs are not implemented. The Content Rewards scanner reads public campaign pages; it does not authenticate to creator accounts or operate private campaign actions.

This document is the implementation contract. A provider is not "connected", "published", "submitted", "approved" or "paid" until an authoritative API response or verified user evidence establishes that state.

## Capability matrix

| Workflow | Official route | Automation status | Required user/platform action |
|---|---|---|---|
| Discover public Content Rewards campaigns | Public Discover pages + scheduled snapshot | Implemented, public-only | Private/invite-only campaigns remain invisible |
| Join / apply to a campaign | No supported public creator API documented in the available official help material | Not integrated | Open campaign in Content Rewards and apply/join there; app can deep-link and track the user's confirmed result |
| Connect YouTube | Google OAuth authorization-code + PKCE; encrypted server token vault | Read-only OAuth implemented | Google Cloud OAuth web client, YouTube Data API v3, HTTPS callback, consent and account approval |
| Publish YouTube video | YouTube Data API v3 `videos.insert` with `youtube.upload` scope | Not implemented | Add upload scope, complete applicable Google OAuth verification, user authorizes and confirms each publish |
| Connect Instagram | Meta OAuth / Instagram Graph API | Not implemented; config readiness only | Instagram professional (Business/Creator) account, linked Facebook Page where required, Meta app, permissions and app review/access level |
| Publish Instagram Reel | Instagram Graph API media container + publish flow | Not implemented | `instagram_content_publish` and the account/API prerequisites; hosted public media URL; user confirmation |
| Connect Facebook Page | Meta OAuth / Graph API | Not implemented; config readiness only | Page admin/task access, Meta app, Page token and approved permissions |
| Publish Facebook Reel/video | Facebook Pages/Graph API publishing endpoints | Not implemented | Page publishing permissions (including `pages_manage_posts` where applicable), app review/access level and user confirmation |
| Start 30-minute timer after publishing | Server timestamp + client countdown/notifications | Local timer/reminders implemented | The timer is advisory; device/browser must be available for local notifications |
| Submit post link to Content Rewards | Official Content Rewards creator submission flow | Not integrated; no public creator submission API has been established | Creator must submit the public post URL in Content Rewards within 30 minutes |
| Verify private views, review, approval and reward | Content Rewards creator account | Not integrated; no official API contract available | Use official dashboard evidence or a future documented/approved API; store source and capture time |
| Track balance and withdrawal | Content Rewards Balance -> Whop Balance -> payout method | Evidence ledger exists; no account sync | Confirm each balance/transfer/payout in the relevant official account |

## OAuth and permission design

### YouTube

- Keep the existing authorization-code flow with PKCE and browser-bound, single-use state.
- The current scope is `https://www.googleapis.com/auth/youtube.readonly`. Do not call this publishing access.
- Publishing requires adding `https://www.googleapis.com/auth/youtube.upload`, updating granted-scope validation and connection metadata, and implementing a server-side resumable upload flow against YouTube Data API v3.
- Request the narrowest scopes possible. Do not place client secrets or refresh tokens in browser code, GitHub, localStorage, logs or chat.
- Google may require OAuth verification for public use of sensitive/restricted scopes. Test-mode refresh tokens can expire; do not treat test-mode setup as production-ready.

Official guide: https://developers.google.com/youtube/data/guides/auth/client-side-web-apps

### Instagram and Facebook

- Use Meta's official OAuth and Graph API only. Instagram publishing is for eligible professional accounts and depends on the selected Instagram API login model, account linkage and app access.
- Instagram publishing permission: `instagram_content_publish`; account discovery/read permissions depend on the chosen login model (for example, `instagram_basic` or the newer Instagram Login permission set).
- Facebook Page publishing requires a Page access token and the permissions appropriate to the selected Page/Reels endpoint (commonly `pages_show_list`, `pages_read_engagement`, and `pages_manage_posts`).
- Exact permission names and endpoint versions must be revalidated against Meta's current docs when implementing each provider. App Review / Advanced Access may be required before accounts outside app roles can connect.
- Never request a user's Facebook/Instagram password. OAuth grants only the approved scopes. Encrypt tokens server-side and support disconnect/revocation.

Meta developer docs:
- https://developers.facebook.com/docs/instagram-platform/
- https://developers.facebook.com/docs/video-api/guides/reels-publishing/
- https://developers.facebook.com/docs/graph-api/

## Content Rewards: the hard boundary

The official creator instructions say the creator connects and verifies the account, publishes the clip, then submits the public post link within 30 minutes. Content Rewards fetches the clip, caption and view count after submission. Submissions remain pending until the campaign team reviews them; approval is not automatic. Some campaigns require a draft pre-approval before the creator publishes.

Official instructions:
- Submit a video: https://help.contentrewards.com/en/articles/15319814-submit-a-video
- How Content Rewards works: https://help.contentrewards.com/en/articles/15319790-how-content-rewards-works
- Connect social accounts: https://help.contentrewards.com/en/articles/16746780-connect-your-social-accounts

No public, supported creator API contract for join/apply, submission, private creator analytics, review decisions or payout access has been identified in the official help material reviewed for this integration. Therefore:

1. The app may discover public campaigns and show the official campaign URL.
2. The app may prepare a video, caption, hashtags and a platform-specific publish package.
3. After a user-confirmed successful social publish, the app may store the returned public post URL and exact server publish time, then start the 30-minute deadline.
4. The app must open the official Content Rewards campaign/submission page and guide the creator to submit the URL there. It must not fabricate a submission receipt or mark a local click as an accepted submission.
5. A submission becomes "verified" only when a supported official response or user-provided receipt/evidence confirms it.
6. Views, review status, approved reward, Content Rewards balance, transfer to Whop and final payout must remain separate evidence-backed fields. Do not infer approval or earnings from public view counts.

## Required backend configuration (never commit values)

The current Docker/Node backend and encrypted token vault are the intended OAuth host. GitHub Pages alone cannot run OAuth callbacks, hold tokens or publish media.

Existing YouTube variables are documented in [BACKEND.md](./BACKEND.md). Future provider variables should be added only with implemented routes and validation:

- `META_APP_ID`
- `META_APP_SECRET`
- `META_REDIRECT_URI`
- `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` only if the chosen Meta product requires separate credentials
- `SOCIAL_TOKEN_ENCRYPTION_KEY`
- Persistent token-vault volume path
- Exact HTTPS callback and allowed origin

Do not configure or advertise a provider as ready merely because these values exist. Readiness must distinguish: missing config, configured-not-authorized, connected-read-only, connected-publish-permission, publishing-ready, and disconnected/revoked.

## Safe publishing workflow

1. Discover campaign and capture its public source URL, rules, reward model, budget/freshness evidence.
2. User confirms eligibility and completes any required join/apply or pre-approval step on Content Rewards.
3. Generate/edit the clip and validate duration, aspect ratio, audio/media rights, caption and campaign requirements.
4. User connects the intended social account through official OAuth.
5. Show account, destination, caption, media preview and visibility. Require an explicit publish confirmation.
6. Publish through the selected platform's official API. Record the API response ID, permalink (when available), provider and server timestamp. Handle processing/polling and failures idempotently.
7. Immediately open Content Rewards submission page with the campaign URL and copy-ready permalink. Start a 30-minute countdown from the verified platform publish timestamp. The creator completes the official submission unless Content Rewards provides a documented API.
8. Store the official submission receipt/reference only after confirmation. Otherwise status remains "link ready — submission not verified".
9. Poll only supported official social APIs for metrics within their permissions and rate limits. Keep platform views distinct from Content Rewards credited views.
10. Record Content Rewards review, approved amount/currency, balance credit, Whop transfer and final withdrawal only from official dashboard evidence or a documented API. Keep all timestamps and evidence sources.

## Release acceptance criteria

A provider is not complete until all of the following pass:

- OAuth state/PKCE, CSRF/origin checks, redirect allowlist, token encryption, refresh, disconnect and revoked-token handling tests.
- Required-scope validation rejects partial grants and never leaks token material.
- API integration tests cover successful upload, processing, retry/idempotency, rate limits, expired tokens and provider errors.
- UI shows the exact connected account and exact destination before publishing.
- Publishing is user-confirmed; no silent posting.
- Public permalink and server timestamp are stored from the provider response.
- Content Rewards submission state is not marked successful without official confirmation.
- Private views, approval and payouts are never invented or inferred.
- CI passes, a backend is deployed with persistent encrypted storage, provider apps are reviewed/approved as required, and a real account test is completed.

## What is still needed to turn this on

The repository can contain the integration code, but it cannot create provider developer apps or accept permissions on the user's behalf. The owner must create/configure Google and Meta developer apps, register the exact deployed HTTPS callback URLs, complete verification/review where required, and enter credentials only into the hosting provider's private environment-variable manager. No passwords, OTPs, access tokens or app secrets should be sent in chat.
