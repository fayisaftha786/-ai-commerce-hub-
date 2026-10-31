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

The default GitHub Actions scheduled snapshot does not require this optional backend. The current environment has not deployed the Node.js backend to a hosting provider. Until a separate server is deployed and configured, advanced server-only integrations remain unavailable; the public snapshot schedule continues through GitHub Actions.

## Hosting and operational notes

A continuously scheduled process needs a host that stays awake. Some low-cost/free hosts sleep or do not provide persistent disk on their free tier; in those environments the schedule may pause and the JSON store may be lost. Check the host's current plan and storage guarantees before relying on it. Use process monitoring, HTTPS, persistent disk, regular backups and log monitoring for production.

## Security and API limitations

- Public campaign endpoints are read-only. There is no unauthenticated POST route that can trigger scans or alter stored rows.
- CORS is an origin policy for browsers, not authentication; the API only publishes the currently public third-party campaign snapshot. Never add private account data to these responses.
- No OAuth authorization/callback, token exchange, encrypted token vault, account linking, social publishing, campaign join/apply, submission API, views ingestion or payout sync has been implemented.
- Do not put Meta/Google secrets, access tokens, passwords, OTPs, cookies or third-party credentials in GitHub Pages or local browser storage.
- The existing `/api/social/providers` route still reports configuration readiness only and returns no secret values.
