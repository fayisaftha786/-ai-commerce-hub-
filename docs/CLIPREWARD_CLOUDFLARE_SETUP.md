# ClipReward Studio — Cloudflare Worker setup (no VM)

**Purpose:** optional server setup for live public campaign-page analysis and the YouTube/Meta OAuth publishing code. The static GitHub Pages app, scheduled public Discover snapshots, local tracker and local video editor work without this backend.

**Important:** this deploys the app and its API on one Cloudflare Worker origin. The workflow configures CORS for the Worker origin only. Use the Worker-hosted app URL for backend features; the GitHub Pages copy remains a static fallback.

## What this adds — and what it does not

- The Worker serves the ClipReward app and same-origin API.
- It can fetch a specific allowlisted public Content Rewards campaign URL live for immediate analysis; a failed live fetch is not silently replaced with historical snapshot data.
- D1 stores backend records and encrypted OAuth tokens; R2 stores media used by the server-side social publishing flow.
- YouTube and Meta publishing code can be enabled after provider setup and permissions.
- This does **not** add a private Content Rewards API. Join/Apply, Content Rewards account verification, Submit Clip, private credited views, approval and payout sync remain creator actions.
- Google/Meta credentials are unnecessary when the creator downloads the finished video and posts manually.

## Free-plan limits

Published free allowances include:

| Service | Free allowance relevant to this app |
| --- | --- |
| Workers | 100,000 requests/day; 10 ms CPU time per invocation; 128 MB memory; 50 subrequests/invocation |
| D1 | 5 million rows read/day; 100,000 rows written/day; 500 MB maximum per database; 5 GB free account storage |
| R2 | 10 GB-month storage; 1 million Class A operations/month; 10 million Class B operations/month; internet egress is free |

Limits and enforcement can change. Usage above free allowances or a plan upgrade can incur charges. Workers Free's 10 ms CPU cap is low, so treat this as a personal/light-use backend and test real routes before relying on media/OAuth publishing. Do not enable paid services just to finish setup. Check [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) before deployment.

## 1. Create Cloudflare resources

Use one Cloudflare account and enable its free workers.dev subdomain.

1. In Workers & Pages, create a placeholder Worker named **clipreward-studio** and enable its workers.dev URL. Creating the Worker first allows the deploy token to be scoped to that Worker.
2. In Storage & databases → D1, create a database named **clipreward-studio**. Copy its database UUID for `CF_D1_DATABASE_ID`.
3. In Storage & databases → R2, create a bucket named **clipreward-studio-media**. This exact name is used by the checked-in Worker config.
4. Copy your Cloudflare account ID.
5. Record the exact Worker HTTPS origin, e.g. `https://clipreward-studio.YOUR-SUBDOMAIN.workers.dev`. Use the real URL without a path, query or trailing route.

The repository already declares the Worker name, D1 database name, R2 bucket name, assets directory and binding names. Do not commit account IDs or secrets into `wrangler.jsonc.example`.

## 2. Create a narrowly scoped API token

Create an account API token for GitHub Actions. Since you created the Worker shell first, grant **Workers Scripts: Edit** scoped to the `clipreward-studio` Worker and **D1: Edit** scoped to the `clipreward-studio` database. Avoid a Global API Key or all-account administrator token. The workflow does not need to read R2 object contents; create the bucket in the dashboard and let the Worker bind to it.

References: [Cloudflare API token permission groups](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) and [Workers authorization](https://developers.cloudflare.com/workers/authorization/). If the current Cloudflare UI requires a broader permission than these, stop and review it rather than granting unrestricted access.

## 3. Add GitHub Actions repository variables and secrets

Open repository **Settings → Secrets and variables → Actions**. Add these repository variables:

| Variable | Value |
| --- | --- |
| `CLOUDFLARE_DEPLOY_ENABLED` | `true` |
| `CF_ACCOUNT_ID` | Your Cloudflare account ID |
| `CF_D1_DATABASE_ID` | D1 UUID for `clipreward-studio` |
| `CF_WORKER_URL` | Worker HTTPS origin only |

Add these repository secrets:

| Secret | Value |
| --- | --- |
| `CF_API_TOKEN` | The narrowly scoped Cloudflare API token |
| `SOCIAL_TOKEN_ENCRYPTION_KEY` | New 32-byte random key, base64 encoded |

Generate the key on your own device or trusted local terminal:

```sh
openssl rand -base64 32
```

Paste it directly into the GitHub secret field. Never send it in chat, screenshots, commits or the browser app. Back it up securely and separately; losing or rotating it can make existing encrypted OAuth token records unreadable.

Optional provider secrets — leave unset for manual video posting:

- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- `META_APP_ID` and `META_APP_SECRET`

The deploy job is deliberately gated by `CLOUDFLARE_DEPLOY_ENABLED == 'true'`. A missing/false variable means the job is skipped, even when you press **Run workflow**.

## 4. Run the deployment

1. Open the repository's **Actions** tab.
2. Select **Deploy ClipReward backend to Cloudflare Workers**.
3. Choose `main` and press **Run workflow**.
4. Inspect the run. It builds the app, applies D1 migrations, deploys the Worker, sets the encryption key and optional provider secrets, then checks Worker health and the app shell.
5. Deployment is complete only when the final health verification step succeeds. A skipped job is not a deployment; a green build does not prove an OAuth connection or a successful social upload.

Open the app at the Worker origin:

```text
https://YOUR-WORKER-ORIGIN/content-rewards-assistant/
```

The real Worker URL is shown in the Cloudflare dashboard. The app probes the same origin and should detect the backend automatically. The workflow sets CORS only for the Worker origin, so using the GitHub Pages app as the front end for this Worker may fail cross-origin checks.

## 5. Verify backend and live public-page analysis

Open these exact paths on the real Worker origin:

```text
https://YOUR-WORKER-ORIGIN/health
https://YOUR-WORKER-ORIGIN/api/discovery/status
```

Expected checks:

- `/health` returns JSON with `ok: true`.
- `/api/discovery/status` returns the expected discovery source registry and status.
- `/content-rewards-assistant/` opens and the app reports its same-origin backend connected.
- A public HTTPS Content Rewards campaign URL can be analysed and labelled as live-fetched public-page evidence.
- On fetch failure, the app reports the error instead of calling old snapshot content live data.

Compare live analysis against the official campaign: title, platform, reward rate, budget, deadline and hidden requirement warning. Server health proves only the server is responding, not that OAuth or publishing works.

## 6. Optional YouTube / Meta OAuth

Skip this section when you plan to download and post manually.

- **YouTube:** create a Google OAuth Web client, enable YouTube Data API v3 and add the exact redirect URI `https://YOUR-WORKER-ORIGIN/api/social/youtube/callback`. Add Google client ID/secret to GitHub Actions secrets and redeploy.
- **Facebook / Instagram:** configure a Meta developer app and required Login/Graph API products. Add the exact redirect URI `https://YOUR-WORKER-ORIGIN/api/social/meta/callback`. Add Meta app ID/secret to GitHub Actions secrets and redeploy. Instagram publishing requires an eligible linked Professional account and required Meta permission access/review.

Provider approval, account eligibility and a controlled real-account upload test are separate requirements. A ClipReward OAuth connection does not prove Content Rewards has verified that same account.

## 7. Move local tracker data safely

ClipReward tracker and settings are stored in browser local storage. GitHub Pages and the Cloudflare Worker URL have separate storage. Before changing app origins, export the ClipReward backup (or the main app's full workspace backup), open the Worker-hosted app and import it there. There is no automatic sync between origins.

## 8. Scheduled scanner and operating limits

The public snapshot is refreshed independently by GitHub Actions. It reads official public Discover first and uses a third-party public feed only as a fallback. Scheduled runs are best-effort, not an SLA: GitHub may delay/drop schedule events under load, and public-repository scheduled workflows can be disabled after 60 days without repository activity. Use the workflow's manual trigger when a refresh is needed.

The Worker fetches public campaign URLs only, without Content Rewards cookies or login. It must not bypass join gates, CAPTCHAs or access controls.

## What still needs creator action

After deployment, the creator must still join/apply, read the full requirements after joining, verify the exact posting account in Content Rewards, publish, and submit the public permalink through the official Content Rewards workflow inside the deadline. The local 30-minute reminder runs only while the app page and timer are active. Campaign approval, qualified views, credited earnings and payouts are not synced or guaranteed.

Never put Content Rewards passwords, OTPs, session cookies, provider tokens or API secrets in the public frontend or repository.