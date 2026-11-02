# Social account connection and publishing

## Current implementation

The Social Media Desk is no longer browser-only. The repository includes server-side official publishing paths for:
- YouTube channel connection and video upload through Google OAuth and the YouTube Data API.
- Facebook Page Reels and linked Instagram Professional Reels through Meta OAuth and the Meta Graph API.

The Social Desk still supports manual handoff to X and WhatsApp; those platforms do not have publisher integrations here. Local analytics calculations use metrics entered by the creator. The app does not automatically fetch general social insights or private Content Rewards credited views.

These are implemented code paths, not proof of a live service. A private HTTPS backend, provider app credentials, persistent encrypted storage, permissions/review and successful real-account tests are required before calling publishing live.

## Security requirements

- Use only each platform's official OAuth flow and API. Never collect or request a platform password.
- Run OAuth token exchange and publishing on a trusted HTTPS backend. Never put client secrets, access tokens or refresh tokens in browser JavaScript, static HTML, the public repository, browser localStorage or chat.
- Validate one-time OAuth state, browser session binding, exact HTTPS redirect URI, allowed origins and granted scopes.
- Encrypt provider tokens at rest, persist the encrypted vault on a private volume, redact secrets from logs, and support disconnect/revocation and reconnect after token expiry.
- Request only the permissions needed. Provider app review, business verification, account eligibility or Advanced Access may be required.
- Require explicit user confirmation before publishing. Do not report a post as public until the provider's API confirms processing/public visibility and returns a valid public permalink/timestamp.
- Do not treat a YouTube/Meta OAuth connection as proof that the same account is linked/verified in Content Rewards. The creator must complete that separate official account-verification flow.

## Meta: Facebook Pages and Instagram Reels

The backend implements Facebook Login for managed Pages and linked Instagram Professional accounts.

1. Create a Meta developer app and enable the product/login configuration required by the selected Graph API flow.
2. Register the exact HTTPS callback URI: /api/social/meta/callback on the deployed backend host.
3. Configure the Meta app ID, app secret and redirect URI as private backend environment variables.
4. Confirm the Facebook login can access the intended managed Page. Instagram publishing additionally needs an eligible Professional Instagram account linked to the selected Page and a publicly fetchable temporary media URL.
5. Complete the required Meta app review / permission access before connecting accounts outside permitted app roles.
6. Connect from Social Desk, select the correct managed Page/linked Instagram account, review the destination and caption, and explicitly confirm each publish.
7. Verify the returned public permalink and timestamp; for Facebook, use the provider status path to confirm publish/processing before recording the post.

Current API limits and exact endpoints are documented in [BACKEND.md](./BACKEND.md). The integration does not publish to a personal Instagram account or an arbitrary Facebook profile.

## YouTube

The backend implements a Google OAuth authorization-code flow with PKCE and YouTube Data API upload/status calls.

1. Create a Google Cloud project and enable YouTube Data API v3.
2. Configure the OAuth consent screen and required app review/testing rules.
3. Register the exact HTTPS callback URI: /api/social/youtube/callback on the deployed backend host.
4. Set the Google client ID, secret and redirect URI only in the backend host's private environment.
5. Connect the channel from Social Desk and confirm that it is the channel that owns the intended upload.
6. Select the video, review title/description/visibility and explicitly confirm upload. Public is not the default.
7. Wait for processing and public visibility; only then is a public permalink/timestamp eligible for the Content Rewards handoff.

Google test-mode tokens and verification restrictions can affect durability. See [BACKEND.md](./BACKEND.md) before deployment.

## Implemented backend routes

These are implemented server routes; availability still depends on deployment and configuration.

| Method | Path | Purpose |
|---|---|---|
| GET | /api/social/providers | Safe configuration/OAuth readiness; no secret values |
| GET | /api/social/connections | Safe connection metadata for the current browser session |
| GET | /api/social/youtube/connect | Start Google OAuth |
| GET | /api/social/youtube/callback | Complete Google OAuth |
| POST | /api/social/youtube/publish | Explicitly confirmed YouTube upload |
| GET | /api/social/youtube/status | Read provider processing/public status |
| POST | /api/social/youtube/disconnect | Disconnect the current session's YouTube connection |
| GET | /api/social/meta/connect | Start Meta OAuth |
| GET | /api/social/meta/callback | Complete Meta OAuth and resolve managed Pages/linked Instagram |
| POST | /api/social/meta/facebook/publish | Publish a Facebook Page Reel |
| GET | /api/social/meta/facebook/status | Check Facebook Reel processing/publish status |
| POST | /api/social/meta/instagram/publish | Publish an Instagram Professional Reel |
| POST | /api/social/meta/disconnect | Disconnect the current session's Meta connection |

The service also serves a short-lived temporary media URL for Meta to fetch Instagram video. Do not expose it as a permanent file URL.

## Private backend configuration

Use the exact variable names in the repository's [.env.example](../.env.example) and [BACKEND.md](./BACKEND.md):

- Meta: META_APP_ID, META_APP_SECRET, META_REDIRECT_URI, META_MEDIA_BASE_URL.
- Google: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI.
- Shared session/token security: SOCIAL_TOKEN_ENCRYPTION_KEY, SOCIAL_TOKEN_STORE_PATH, SOCIAL_CORS_ORIGINS, SOCIAL_RETURN_URL, SOCIAL_COOKIE_SAMESITE.

SOCIAL_TOKEN_ENCRYPTION_KEY must contain 32 bytes for AES-256-GCM. Store it in the hosting provider's private environment manager and mount the encrypted token vault on persistent private storage. Never commit real values. For separate GitHub Pages and API origins, configure exact CORS origins and the required cookie settings; browser third-party-cookie policies may still prevent reliable sessions. A same-origin HTTPS deployment is preferred. Do not run multiple backend replicas until pending OAuth state uses a shared expiring store.

A /health success means only that the server process responds. GET /api/social/providers reports whether configuration is complete; it does not say a user has authorized a provider. GET /api/social/connections reports the current browser session's connection metadata, not Content Rewards verification.

## Content Rewards remains a separate account and workflow

Content Rewards verification is not the same as connecting a Google or Meta account to this publisher. The exact account used for a post must separately show Connected/verified inside Content Rewards. The app's local attestation gate records the creator's confirmation; it cannot query Content Rewards or independently validate the account.

The publisher can return a public social post URL/time and the ClipReward tracker can start its local 30-minute reminder. The creator must manually submit that URL to the official Content Rewards campaign while the post is strictly less than 30 minutes old. Join/Apply, Submit Clip, private credited views, review/approval, Content Rewards balance and payout sync are not integrated through a supported Content Rewards creator API.

## Analytics boundary

The Social Desk can calculate engagement/click/order rates from numbers entered by the creator. These are labelled as manually entered and not independently verified. There is no implemented automatic insights ingestion route in this backend, and no Content Rewards private-view counter integration. Never treat public-platform views as credited campaign views.

## Deployment validation checklist

- [ ] Backend deployed on HTTPS with private persistent storage.
- [ ] Required environment variables configured without exposing secret values.
- [ ] /health returns process health and /api/social/providers shows the expected readiness.
- [ ] Google OAuth connect/disconnect tested with the intended YouTube channel.
- [ ] YouTube test upload reaches processed + public, returning the actual permalink and timestamp.
- [ ] Meta OAuth resolves the intended managed Page and linked Instagram Professional account.
- [ ] Facebook and Instagram test Reels each return confirmed public permalinks/timestamps.
- [ ] Content Rewards separately shows the exact posting account as connected/verified.
- [ ] The Content Rewards tracker only starts its timer from a verified public provider receipt.
- [ ] The actual Content Rewards Submit Clip action is completed manually and its receipt is captured as evidence.

See [OFFICIAL_SOCIAL_AUTOMATION.md](./OFFICIAL_SOCIAL_AUTOMATION.md) for the complete workflow, capability matrix and release gates.
