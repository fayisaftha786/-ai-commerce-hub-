# Scheduled discovery and optional private backend

## Default scheduled discovery — no separate host required

The repository includes a GitHub Actions workflow, `.github/workflows/scheduled-content-rewards-discovery.yml`, that attempts a public campaign snapshot scan at minute 17 every six hours (UTC). It reads public campaign links from the official Content Rewards Discover page first, then fetches up to 100 public detail URLs without cookies. The third-party public lead feed is used only if the official Discover page cannot be read or its links cannot be extracted. The scanner parses visible page text and writes campaign metadata plus detail text into `content-rewards-assistant/discovery-snapshot.json`. The snapshot is published through GitHub Pages and the Site Analyze URL control loads it automatically; no backend URL or user credential is needed for this public source.

For a manual refresh, open the repository's **Actions** tab → **Scheduled Content Rewards discovery snapshot** → **Run workflow**. The workflow records the scan time, checked/new counts and source outcome. If the official Discover page and its third-party fallback both fail, the previous campaign rows are retained and the failed scan is recorded; the workflow reports failure rather than disguising the source outage as a successful scan.

This workflow uses GitHub-hosted standard runners in a public repository, for which GitHub documents free/unlimited standard runner usage. Scheduled execution is best-effort, not a real-time SLA: GitHub can delay scheduled events or drop some during high load. Scheduled workflows run from the default branch and can be automatically disabled in public repositories after 60 days without repository activity. Check Actions history and run it manually when a fresh scan is needed. [GitHub Actions billing](https://docs.github.com/en/actions/concepts/billing-and-usage) · [Scheduled workflow behaviour](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

Only campaign URLs visible on the current official public Discover page (up to 100 detail pages per run) are auto-fetched. If that page or its links cannot be read, the scanner may use the third-party public snapshot feed as a fallback; that feed is not an official Content Rewards API. Private, invitation-only, joined-only and locked campaign requirements are not exposed by public Discover and are not crawled. Pages that return non-HTML, redirect outside Content Rewards, or block anonymous requests are marked unavailable. The score is an evidence-coverage/freshness prioritisation aid, not proof of active status, eligibility, approval or earnings.

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
- `GET /api/social/providers` — provider configuration readiness; exposes no secret values. YouTube OAuth readiness is reported separately, including the `youtube.upload` scope needed for publishing.
- `GET /api/social/connections` — current browser session's safe connection metadata (never tokens).
- `GET /api/social/youtube/connect` — starts the Google authorization-code flow with PKCE and browser-bound OAuth state.
- `GET /api/social/youtube/callback` — validates state, exchanges the code server-side, resolves the authorised channel and stores tokens encrypted.
- `POST /api/social/youtube/publish?title=<title>&description=<description>&privacy=private|unlisted|public` — accepts a raw MP4/QuickTime/WebM video body (maximum 64 MB), requires the browser-bound session, exact allowlisted Origin and explicit `youtube-publish` action header, then uploads through YouTube resumable upload and returns the provider video ID/permalink. Default privacy is private.
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

The default GitHub Actions snapshot workflow uses the official public Content Rewards Discover page (`https://contentrewards.com/c/discover`) as its primary campaign-link source. It parses visible public campaign links and fetches up to 100 public detail pages per run. If the official Discover page cannot be fetched or its campaign links cannot be extracted, the scanner falls back to the third-party public snapshot feed at `https://contentrewards.xyz/api/cr/campaigns`. The snapshot records which source was used; the fallback is not an official Content Rewards API and may be stale, incomplete, rate-limited, or unavailable.

The scheduled workflow deduplicates public campaign rows, retains history, scores evidence coverage/freshness, and keeps previous campaign records when a scan fails. The GitHub Pages deployment also refreshes the separate allowlisted YouTube, Facebook and Instagram public creator-program source monitor. These checks read public documentation only. Private, invitation-only, joined-only campaign data and creator dashboards are not crawled. A scan never joins, applies, posts, submits, verifies account eligibility, or confirms earnings.

The optional private Node.js discovery backend is a separate server integration; it is not required for the GitHub Actions snapshot. Its configured feed and persistence settings do not turn the third-party fallback into an official API. All campaign scores are prioritisation aids only; they do not mean a campaign is live, a creator is eligible, or earnings are guaranteed.

## Connect the static workspace

1. Deploy this backend on an always-running Node.js host with a persistent volume and HTTPS.
2. Set the exact frontend origin in `DISCOVERY_CORS_ORIGINS` (for this GitHub Pages site: `https://fayisaftha786.github.io`).
3. Enable the scheduler and configure the persistent storage path.
4. Open ClipReward Studio → Rewards Intelligence Radar. Enter the backend's HTTPS origin in **Optional server backend HTTPS origin**, then tap **Connect / Save backend**.
5. The browser makes credential-free read-only GET requests and imports the saved findings. It does not send Content Rewards login details or any API secret.

The default GitHub Actions scheduled snapshot does not require this optional backend. The current environment has not deployed the Node.js backend to a hosting provider. Until a separate server is deployed and configured, advanced server-only integrations remain unavailable; the public snapshot schedule continues through GitHub Actions.


## One-origin Docker deployment (recommended for OAuth)

The backend can serve the same tested static asset bundle and API on one HTTPS origin. This avoids relying on third-party cookies between GitHub Pages and a separate API host. GitHub Pages remains the public static deployment; the single-origin Docker service is the recommended path for a persistent browser-bound YouTube OAuth session.

### Deploy the repository on Railway

1. Create a Railway project and add a service connected to this GitHub repository's `main` branch. The root `Dockerfile` is auto-detected and starts `node server.js`.
2. In the service's **Volumes** settings, attach a persistent volume mounted at `/data`. Do not skip this: OAuth tokens are encrypted, but the token-vault file must survive deployments and restarts.
3. Generate a public HTTPS domain in the service's networking settings. Railway injects the listening `PORT` value; the app binds to all interfaces in production.
4. Add these service variables, replacing `<service-domain>` with the exact generated hostname:
   - `NODE_ENV=production`
   - `SERVE_STATIC_APP=true`
   - `STATIC_SITE_DIR=/tmp/ai-commerce-hub-site`
   - `SOCIAL_TOKEN_STORE_PATH=/data/social-token-vault.json`
   - `SOCIAL_CORS_ORIGINS=https://<service-domain>`
   - `SOCIAL_RETURN_URL=https://<service-domain>/`
   - `SOCIAL_COOKIE_SAMESITE=Lax`
   - `GOOGLE_REDIRECT_URI=https://<service-domain>/api/social/youtube/callback`
   - `SOCIAL_TOKEN_ENCRYPTION_KEY=<new base64 32-byte key>`
   - `GOOGLE_CLIENT_ID=<Google OAuth web client ID>`
   - `GOOGLE_CLIENT_SECRET=<Google OAuth web client secret>`
   - `DISCOVERY_SCHEDULER_ENABLED=false` (GitHub Actions owns the scheduled Content Rewards public snapshot)
5. Generate the encryption key on a trusted machine with `openssl rand -base64 32`. Paste it only into the hosting provider's private variable manager. Do not put it in GitHub, the app UI or this chat. Back up the key separately from the encrypted volume data.
6. In Google Cloud, enable YouTube Data API v3, configure the OAuth consent screen, create a **Web application** OAuth client and register the exact `GOOGLE_REDIRECT_URI` above. Add your own Google account as a test user while validating. Never use an Android/iOS client ID for this server callback.
7. Configure the host's healthcheck path as `/health`. After deploy, open the service domain: the full AI Commerce Hub should load. The Social Media Desk automatically detects the same-origin API; no separate backend origin needs to be pasted.
8. Check `/api/social/providers` for readiness, then use **Connect YouTube with Google**. Complete Google's consent screen and verify that the app shows the channel name. A green health endpoint alone does not mean OAuth is configured or a channel is connected.

Railway supports deploying a GitHub repository and auto-detects a root `Dockerfile`; its persistent volumes are mounted at runtime, so token storage belongs on the mounted path rather than in the image build. Review the hosting plan's current compute, volume and backup terms before relying on it. [Railway GitHub deployment and Dockerfile docs](https://docs.railway.com/services) · [Railway persistent volumes](https://docs.railway.com/volumes).

### Why this is one origin

- The app and API share the same HTTPS host, so the browser session cookie is first-party; production uses `HttpOnly; Secure; SameSite=Lax`.
- The service worker explicitly bypasses `/api/*` and `/health`. OAuth connection status and API responses are never cached as offline app assets.
- The server publishes only the bundle assembled by `scripts/pages-build.js`; backend source files, environment files, tests and documentation are not served from the static root.
- The encrypted token vault uses `/data`; the generated static bundle uses `/tmp` and is rebuilt on each container start.
- Keep the service to one replica until pending OAuth state is moved from process memory to a shared expiring store. A callback routed to a different replica or after a restart will fail safely.

### Google OAuth test-mode limitation

A Google OAuth project with an **External** audience and publishing status **Testing** issues refresh tokens that expire after seven days for scopes such as YouTube access. Testing is useful for a private account-connection trial, but it is not a durable production configuration. For broader use, complete Google's applicable OAuth verification/publishing requirements before relying on persistent refresh tokens. [Google OAuth token lifetime in Testing](https://developers.google.com/identity/protocols/oauth2) · [Google OAuth production verification](https://developers.google.com/identity/protocols/oauth2/policies).

## YouTube OAuth connection — first provider vertical slice

The private backend now implements an authorization-code connection for YouTube with channel identification and `youtube.upload` permission, plus a server-side resumable upload endpoint (raw video body up to 64 MB). The Social Media Desk includes a publish action for one selected MP4/QuickTime/WebM file; each upload requires an explicit confirmation and defaults to Private. This is an implemented code path, not a live provider verification: backend hosting, Google OAuth configuration/consent and a real-account upload test are still required. It is separate from GitHub Pages; the static site never receives a Google client secret, access token, or refresh token.

### Google Cloud setup

1. Create or select a Google Cloud project and enable YouTube Data API v3.
2. Configure the OAuth consent screen and add test users while the app is in testing. Complete any Google verification or publishing steps required for the scopes and audience you intend to use.
3. Create an OAuth client with application type Web application.
4. Register the exact redirect URI https://<your-backend-host>/api/social/youtube/callback as an authorized redirect URI.
5. Copy the client ID and secret only into the backend host's private environment variables. Never commit them or enter them in the browser.

The flow requests only:
- https://www.googleapis.com/auth/youtube.readonly — identify the authorized channel.
- https://www.googleapis.com/auth/youtube.upload — upload videos through the server-side resumable upload route.

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

In the same-origin Docker deployment, the API uses an HttpOnly, Secure, SameSite=Lax cookie and the app detects the API automatically. For the separate GitHub Pages + backend arrangement, configure an exact CORS origin and SameSite=None; third-party-cookie restrictions may still prevent reliable browser-session recognition. The app shows an explicit backend/cookie error rather than claiming a connection.

### Current boundaries

- This is a YouTube connection slice only. Instagram Login and Facebook Pages OAuth are not implemented in this release; configuration readiness for those providers is not a connection.
- A successful connection confirms Google consent and an authorized YouTube channel. It does not grant YouTube Partner Program eligibility or confirm monetization/payout status.
- YouTube upload permission is not requested and this release does not upload or publish videos. A future upload feature must add a dedicated endpoint, explicit consent for the extra scope, content review/approval, format checks, resumable upload handling and real platform-response tests.
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
