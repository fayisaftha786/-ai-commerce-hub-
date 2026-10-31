# Private backend and server-side campaign discovery

The Node.js backend is separate from GitHub Pages. GitHub Pages only serves the static workspace; it cannot run the scheduled worker. Run this server on a host that supports a continuously running Node.js process and persistent disk.

## Run locally

Requires Node.js 24 or a compatible modern release.

```sh
npm run check
npm test
npm start
```

By default the server binds to `127.0.0.1:3000` and the discovery scheduler is disabled. The API exposes:

- `GET /health` — process health only; does not claim OAuth.
- `GET /api/social/providers` — configuration readiness only; OAuth is not implemented.
- `GET /api/discovery/status` — scheduler state, latest scan, saved lead count and source registry.
- `GET /api/discovery/campaigns` — read-only saved public campaign snapshots. Optional query parameters: `platform`, `search`, and `limit` (1–100).
- `GET /api/discovery/sources` — source modes and scheduler configuration.
- `OPTIONS /api/discovery/*` — CORS preflight for read-only GET requests.

There is intentionally no public scan-trigger endpoint, no API-key in the browser, and no write route for campaign state. The worker starts its own scan at process start and repeats it on its server-side interval only when explicitly enabled.

## Server environment

Example production configuration:

```text
NODE_ENV=production
PORT=<port supplied by the hosting platform>
DISCOVERY_SCHEDULER_ENABLED=true
DISCOVERY_INTERVAL_MINUTES=360
DISCOVERY_STORE_PATH=/var/data/content-rewards-discovery.json
DISCOVERY_CORS_ORIGINS=https://fayisaftha786.github.io
```

- `DISCOVERY_SCHEDULER_ENABLED` must be exactly `true` to start the worker; otherwise it remains disabled.
- `DISCOVERY_INTERVAL_MINUTES` accepts whole minutes from 15 to 1,440. Invalid values fall back to 360 minutes (six hours).
- `DISCOVERY_STORE_PATH` should point to a persistent mounted volume. The default is `.data/content-rewards-discovery.json` under the working directory. The file store writes via a temporary file and atomic rename, serializes writes, and retains at most 500 campaign rows and 50 scan records.
- `DISCOVERY_CORS_ORIGINS` is a comma-separated exact-origin allowlist. Do not use `*`. The default is empty, so cross-origin browser calls are denied until the expected GitHub Pages origin is configured.
- Keep the backend on HTTPS when accessed from the deployed app. Only localhost development URLs may use HTTP.

The store contains public campaign snapshot metadata, not passwords, social cookies, OAuth tokens, or personal account analytics. Persist the file on a private disk/volume and include it in backups. Do not commit `.data/` or a live data file.

## Current source boundary

The only automatic connector is the existing public third-party snapshot feed at `https://contentrewards.xyz/api/cr/campaigns`. It is not an official Content Rewards API and can be stale, incomplete, rate-limited, or unavailable. The official Content Rewards Discover page is listed as a guided verification source; private, invitation-only, or joined-only campaigns are not crawled. A scheduled scan does not join, apply, post, submit or prove creator eligibility.

The worker deduplicates public rows, calculates field-coverage/freshness scores, preserves previous results when a feed request fails, and records success/failure history. Scores are prioritisation aids only; they do not mean a campaign is currently live, a creator is eligible, or earnings are guaranteed.

## Connect the static workspace

1. Deploy this backend on an always-running Node.js host with a persistent volume and HTTPS.
2. Set the exact frontend origin in `DISCOVERY_CORS_ORIGINS` (for this GitHub Pages site: `https://fayisaftha786.github.io`).
3. Enable the scheduler and configure the persistent storage path.
4. Open ClipReward Studio → Rewards Intelligence Radar. Enter the backend's HTTPS origin in **Optional server backend HTTPS origin**, then tap **Connect / Save backend**.
5. The browser makes credential-free read-only GET requests and imports the saved findings. It does not send Content Rewards login details or any API secret.

The current environment has not deployed this backend to a hosting provider. Until a server is deployed and configured, the app remains in local browser-scan mode, which only runs while the page is open and visible. Browser timers are not a substitute for an always-on worker.

## Hosting and operational notes

A continuously scheduled process needs a host that stays awake. Some low-cost/free hosts sleep or do not provide persistent disk on their free tier; in those environments the schedule may pause and the JSON store may be lost. Check the host's current plan and storage guarantees before relying on it. Use process monitoring, HTTPS, persistent disk, regular backups and log monitoring for production.

## Security and API limitations

- Public campaign endpoints are read-only. There is no unauthenticated POST route that can trigger scans or alter stored rows.
- CORS is an origin policy for browsers, not authentication; the API only publishes the currently public third-party campaign snapshot. Never add private account data to these responses.
- No OAuth authorization/callback, token exchange, encrypted token vault, account linking, social publishing, campaign join/apply, submission API, views ingestion or payout sync has been implemented.
- Do not put Meta/Google secrets, access tokens, passwords, OTPs, cookies or third-party credentials in GitHub Pages or local browser storage.
- The existing `/api/social/providers` route still reports configuration readiness only and returns no secret values.
