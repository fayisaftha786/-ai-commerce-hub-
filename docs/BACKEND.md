# Scheduled discovery and optional private backend

## Default scheduled discovery — no separate host required

The repository includes a GitHub Actions workflow, `.github/workflows/scheduled-content-rewards-discovery.yml`, that attempts a public campaign snapshot scan at minute 17 every six hours (UTC). It reads up to 60 public campaign detail URLs from the third-party lead feed, fetches visible HTML without cookies, parses the page text, and writes campaign metadata plus detail text into `content-rewards-assistant/discovery-snapshot.json`. The snapshot is published through GitHub Pages and the Site Analyze URL control loads it automatically; no backend URL or user credential is needed for this public source.

For a manual refresh, open the repository's **Actions** tab → **Scheduled Content Rewards discovery snapshot** → **Run workflow**. The workflow records the scan time, checked/new counts and source outcome. If the public feed fails, the previous campaign rows are retained and the failed scan is recorded; the workflow reports failure rather than disguising the source outage as a successful scan.

This workflow uses GitHub-hosted standard runners in a public repository, for which GitHub documents free/unlimited standard runner usage. Scheduled execution is best-effort, not a real-time SLA: GitHub can delay scheduled events or drop some during high load. Scheduled workflows run from the default branch and can be automatically disabled in public repositories after 60 days without repository activity. Check Actions history and run it manually when a fresh scan is needed. [GitHub Actions billing](https://docs.github.com/en/actions/concepts/billing-and-usage) · [Scheduled workflow behaviour](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

Only campaign URLs present in the currently integrated third-party Content Rewards snapshot feed (up to 60 per run) are auto-fetched. The feed is not an official Content Rewards API. Private, invitation-only, and joined-only campaigns are not exposed by public Discover and are not crawled. Pages that return non-HTML, redirect outside Content Rewards, or block anonymous requests are marked unavailable. The score is an evidence-coverage/freshness prioritisation aid, not proof of active status, eligibility, approval or earnings.

## Optional private Node.js backend

GitHub Pages only serves the static workspace; it cannot run Node.js server code. The optional backend described below is for a continuously running worker or future approved integrations that need a persistent server process and disk.

## Run locally

Requires Node.js 24 or a compatible modern release.

```sh
npm run check
npm test
npm start
```

By default the server binds to `127.0.0.1:3000` and the discovery scheduler is disabled. The API exposes:

- `GET /health` — process health only; does not claim OAuth.
- `GET /api/social/providers` — provider configuration readiness; exposes no secret values. YouTube OAuth readiness is reported separately.
- `GET /api/social/connections` — current browser session's safe connection metadata (never tokens).
- `GET /api/social/youtube/connect` — starts the Google authorization-code flow with PKCE and browser-bound OAuth state.
- `GET /api/social/youtube/callback` — validates state, exchanges the code server-side, resolves the authorised channel and stores tokens encrypted.
- `POST /api/social/youtube/disconnect` — removes the current browser session's YouTube token record; requires the exact allowlisted Origin and action header.
- `GET /api/discovery/status` — scheduler state, latest scan, saved lead count and source registry.
- `GET /api/discovery/campaigns` — read-only saved public campaign snapshots. Optional query parameters: `platform`, `search`, and `limit` (1–100).
- `GET /api/discovery/sources` — source modes and scheduler configuration.
- `OPTIONS /api/discovery/*` — CORS preflight for read-only GET requests.

There is intentionally no public scan-trigger endpoint, no API-key in the browser, and no write route for campaign state. The worker starts its own scan at process start and repeats it on its server-side interval only when explicitly enabled. OAuth start/callback routes are public navigation endpoints, but state is random, PKCE-bound, browser-session-bound and single-use. Token exchange and storage happen only on the server.

## Server environment

Example production configuration:

```text
NODE_ENV=production
PORT=<port supplied by the hosting platform>
DISCOVERY_SCHEDULER_ENABLED=true
DISCOVERY_INTERVAL_MINUTES=360
DISCOVERY_STORE_PATH=/var/data/content-rewards-discovery.json
DISCOVERY_CORS_ORIGINS=https://fayisaftha786.github.io
GOOGLE_CLIENT_ID=<Google OAuth web client ID>
GOOGLE_CLIENT_SECRET=<Google OAuth web client secret>
GOOGLE_REDIRECT_URI=https://<backend-host>/api/social/youtube/callback
SOCIAL_TOKEN_ENCRYPTION_KEY=<base64-encoded 32-byte key>
SOCIAL_TOKEN_STORE_PATH=/var/data/social-token-vault.json
SOCIAL_CORS_ORIGINS=https://fayisaftha786.github.io
SOCIAL_RETURN_URL=https://fayisaftha786.github.io/-ai-commerce-hub-/
```

- `DISCOVERY_SCHEDULER_ENABLED` must be exactly `true` to start the worker; otherwise it remains disabled.
- `DISCOVERY_INTERVAL_MINUTES` accepts whole minutes from 15 to 1,440. Invalid values fall back to 360 minutes (six hours).
- `DISCOVERY_STORE_PATH` should point to a persistent mounted volume. The default is `.data/content-rewards-discovery.json` under the working directory. The file store writes via a temporary file and atomic rename, serializes writes, and retains at most 500 campaign rows and 50 scan records.
- `DISCOVERY_CORS_ORIGINS` is a comma-separated exact-origin allowlist. Do not use `*`. The default is empty, so cross-origin browser calls are denied until the expected GitHub Pages origin is configured.
- Keep the backend on HTTPS when accessed from the deployed app. Only localhost development URLs may use HTTP.

The store contains public campaign snapshot metadata, not passwords, social cookies, OAuth tokens, or personal account analytics. Persist the file on a private disk/volume and include it in backups. Do not commit `.data/` or a live data file.

## Current source boundary

The default GitHub Actions snapshot workflow uses the official public Content Rewards Discover page (`https://contentrewards.com/c/discover`) as its primary campaign-link source. It parses visible public campaign links and fetches up to 60 public detail pages per run. If the official Discover page cannot be fetched or its campaign links cannot be extracted, the scanner falls back to the third-party public snapshot feed at `https://contentrewards.xyz/api/cr/campaigns`. The snapshot records which source was used; the fallback is not an official Content Rewards API and may be stale, incomplete, rate-limited, or unavailable.

The scheduled workflow deduplicates public campaign rows, retains history, scores evidence coverage/freshness, and keeps previous campaign records when a scan fails. The GitHub Pages deployment also refreshes the separate allowlisted YouTube, Facebook and Instagram public creator-program source monitor. These checks read public documentation only. Private, invitation-only, joined-only campaign data and creator dashboards are not crawled. A scan never joins, applies, posts, submits, verifies account eligibility, or confirms earnings.

The optional private Node.js discovery backend is a separate server integration; it is not required for the GitHub Actions snapshot. Its configured feed and persistence settings do not turn the third-party fallback into an official API. All campaign scores are prioritisation aids only; they do not mean a campaign is live, a creator is eligible, or earnings are guaranteed.

## Connect the static workspace

1. Deploy this backend on an always-running Node.js host with a persistent volume and HTTPS.
2. Set the exact frontend origin in `DISCOVERY_CORS_ORIGINS` (for this GitHub Pages site: `https://fayisaftha786.github.io`).
3. Enable the scheduler and configure the persistent storage path.
4. Open ClipReward Studio → Rewards Intelligence Radar. Enter the backend's HTTPS origin in **Optional server backend HTTPS origin**, then tap **Connect / Save backend**.
5. The browser makes credential-free read-only GET requests and imports the saved findings. It does not send Content Rewards login details or any API secret.

The default GitHub Actions scheduled snapshot does not require this optional backend. The current environment has not deployed the Node.js backend to a hosting provider. Until a separate server is deployed and configured, advanced server-only integrations remain unavailable; the public snapshot schedule continues through GitHub Actions.


## YouTube OAuth connection — first provider vertical slice

The private backend now implements an authorization-code connection for YouTube. It is separate from GitHub Pages; the static site never receives a Google client secret, access token, or refresh token.

### Google Cloud setup

1. Create or select a Google Cloud project and enable YouTube Data API v3.
2. Configure the OAuth consent screen and add test users while the app is in testing. Complete any Google verification or publishing steps required for the scopes and audience you intend to use.
3. Create an OAuth client with application type Web application.
4. Register the exact redirect URI https://<your-backend-host>/api/social/youtube/callback as an authorized redirect URI.
5. Copy the client ID and secret only into the backend host's private environment variables. Never commit them or enter them in the browser.

The flow requests only:
- https://www.googleapis.com/auth/youtube.readonly — identify the authorized channel.
- https://www.googleapis.com/auth/youtube.upload — prepare for future authorized video-upload work.

The flow uses a random, one-use state, PKCE S256, offline access, exact HTTPS redirect configuration and a browser-session cookie. Callback codes are exchanged server-side. The server reads the channel list with the returned bearer token and stores the access/refresh token only inside an AES-256-GCM encrypted vault. API responses return channel metadata and connection status only, never token values.

### Required secret and storage settings

Generate an encryption key on a trusted machine:

    openssl rand -base64 32

Set its output as SOCIAL_TOKEN_ENCRYPTION_KEY. Keep a secure backup. The encrypted vault path is SOCIAL_TOKEN_STORE_PATH (default: .data/social-token-vault.json); directories are restricted to mode 0700 and the file to 0600 where the host supports POSIX permissions. Keep the key separate from the encrypted file. Losing the key makes existing token records unreadable; rotating it requires an explicit decrypt/re-encrypt migration or users must reconnect.

Deploy a single backend instance initially with a persistent private disk. Pending OAuth state is held in process memory, so a callback routed to another instance or a restarted process will fail safely and require the user to start again. Do not horizontally scale this flow until state is moved to a shared expiring store.

### Frontend connection

1. Deploy the backend over HTTPS with all required environment variables from .env.example.
2. Set SOCIAL_CORS_ORIGINS to the exact frontend origin, without a wildcard or path. For the current Pages app, that origin is https://fayisaftha786.github.io.
3. Set SOCIAL_RETURN_URL to the app page on that same origin.
4. In Social Media Desk → Social account connection, enter the backend origin and tap Save backend & check.
5. When readiness is complete, tap Connect YouTube with Google, review the Google permission screen, and return to the app. Use Disconnect YouTube to remove the encrypted connection record.

The API uses an HttpOnly, Secure, SameSite=None browser session cookie in production and credentialed CORS restricted to the configured exact origin. Some browsers block third-party cookies between GitHub Pages and a separately hosted backend; a same-site custom domain or serving the app and API from the same site is recommended for reliable sessions. The app shows an explicit backend/cookie error rather than claiming a connection.

### Current boundaries

- This is a YouTube connection slice only. Instagram Login and Facebook Pages OAuth are not implemented in this release; configuration readiness for those providers is not a connection.
- A successful connection confirms Google consent and an authorized YouTube channel. It does not grant YouTube Partner Program eligibility or confirm monetization/payout status.
- The upload scope is requested, but this release does not upload or publish videos. Upload/publishing needs its own endpoint, content review/approval, format checks, resumable upload handling and real platform-response tests.
- The connection is attached to an opaque browser session, not an app user account. Clearing cookies, using another browser/device, or losing the session means the connection will not be visible there. No cloud account sync exists.
- Access and refresh tokens are encrypted at rest. The server must remain HTTPS, the host disk and environment variables must be private, and backups must protect both the encrypted file and the encryption key separately.
- Google can revoke tokens or require re-consent. Expired tokens are refreshed when possible; otherwise the app shows reconnect_required.

## Hosting and operational notes

A continuously scheduled process needs a host that stays awake. Some low-cost/free hosts sleep or do not provide persistent disk on their free tier; in those environments the schedule may pause and the JSON store may be lost. Check the host's current plan and storage guarantees before relying on it. Use process monitoring, HTTPS, persistent disk, regular backups and log monitoring for production.

## Security and API limitations

- Public campaign endpoints are read-only. There is no unauthenticated POST route that can trigger scans or alter stored rows.
- CORS is an origin policy for browsers, not authentication; the API only publishes the currently public third-party campaign snapshot. Never add private account data to these responses.
- YouTube now has an OAuth authorization/callback, PKCE/state validation, encrypted token vault, browser-session connection status and disconnect route. Instagram/Facebook OAuth, social publishing, campaign join/apply, submission API, views ingestion and payout sync remain unimplemented.
- Do not put Meta/Google secrets, access tokens, passwords, OTPs, cookies or third-party credentials in GitHub Pages or local browser storage.
- The `/api/social/providers` route reports readiness only and returns no secret values; `/api/social/connections` returns metadata for the current browser session only.
