# Social account connection and publishing: safe implementation plan

## Current behavior

The Social Media Desk is a browser-only helper. It previews selected image/video files locally, copies captions, opens official platform sites, and calculates analytics from values the user enters. It does not authenticate accounts, upload media to a platform, publish posts, or fetch analytics automatically.

## Security requirements before real account connection

- Use each platform's official OAuth flow and API. Never collect a platform password in this app.
- Run OAuth token exchange on a trusted HTTPS backend. Never put client secrets, access tokens, or refresh tokens in browser JavaScript, static HTML, or the public repository.
- Generate and validate a one-time state value for each OAuth attempt; use PKCE wherever the provider supports it.
- Match the callback to an exact registered redirect URI. Validate scopes and provider/account identity.
- Encrypt tokens at rest, restrict server-side access, redact tokens from logs, and implement disconnect/revoke and token-expiry handling.
- Request only the minimum scopes needed. Platform review, business-account eligibility, and permissions may be required before publishing or insights endpoints work.
- Do not tell users a post was published or analytics fetched unless the provider API confirms success.

## Provider readiness checklist

### Meta: Facebook Pages and Instagram

1. Create a Meta developer app and configure the relevant Facebook Login / Instagram API product.
2. Register the exact HTTPS OAuth redirect URI and complete the required app settings.
3. Determine whether the target is a Facebook Page or an eligible Instagram professional account; personal-account posting is not generally available through the same publishing APIs.
4. Request only the permissions needed for account identity, publishing, and insights. Complete app review/business verification where required.
5. Implement server-side OAuth callback, token storage, account selection, publishing job, status polling, and insights retrieval.
6. Test with app roles/test accounts before requesting production access.

### YouTube

1. Create a Google Cloud project, enable the YouTube Data API, and configure OAuth consent.
2. Register redirect URIs and request only the scopes required for channel/video operations.
3. Upload through the official API from a backend, handle resumable uploads and processing status, and respect quota and visibility settings.
4. Check current Google verification requirements and API project eligibility before promising production uploads.

### WhatsApp

WhatsApp messaging APIs are not the same as publishing a public social feed. If WhatsApp sharing is needed, begin with a user-initiated share link or the official WhatsApp Business Platform for eligible business messaging; do not label this as feed auto-posting.

## Suggested backend contract

These are proposed endpoints, not implemented or live yet:

- GET /api/social/:provider/connect — start OAuth, validate provider and create state.
- GET /api/social/:provider/callback — validate state, exchange code server-side, persist encrypted tokens.
- GET /api/social/accounts — return only safe account metadata for the signed-in user.
- POST /api/social/posts — validate account, media type/size, disclosure, and platform constraints; enqueue publishing.
- GET /api/social/posts/:id — return confirmed provider status, including failures.
- GET /api/social/insights?accountId=...&postId=... — fetch only metrics the connected provider exposes.
- DELETE /api/social/connections/:id — disconnect and revoke tokens when supported.

Every endpoint must enforce user authentication, authorization, CSRF protection where applicable, rate limits, upload limits, and audit-safe logging. Media should be stored privately with short-lived access URLs when a provider requires fetchable media URLs.

## Configuration placeholders

Keep real values in the deployment platform's secret manager, never commit them:

- META_APP_ID
- META_APP_SECRET
- META_REDIRECT_URI
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_REDIRECT_URI
- TOKEN_ENCRYPTION_KEY
- APP_BASE_URL

These are documentation placeholders only; the app does not read them yet.

## Acceptance criteria for a production connection

- OAuth can be completed and cancelled without exposing secrets.
- Invalid/missing state, wrong redirect URI, expired code, and denied permissions fail safely.
- Tokens never appear in frontend responses, local storage, logs, or Git history.
- Posting returns a provider-backed job/status, supports retry without duplicate publication where possible, and reports failures honestly.
- Analytics display source, time range, and metric definitions; unavailable metrics are shown as unavailable, not as zero.
- Disconnect revokes tokens where supported and removes local connection metadata.
- Automated tests cover OAuth state/PKCE, authorization checks, token redaction, provider errors, and publishing status transitions.