# Oracle Cloud Always Free backend deployment

This is an optional deployment path for the existing Node.js backend. GitHub Pages and the six-hour public campaign scan continue to work without it. The backend is needed for server-side YouTube/Meta OAuth, encrypted token storage and official social publishing.

The repository now includes:
- `compose.oci.yml`: Node.js app, persistent data volume and Caddy HTTPS reverse proxy.
- `scripts/oci-preflight.js`: validates private environment values, encryption key, exact callbacks, CORS origin and persistent paths without printing secrets.
- `ops/oci/deploy.sh`: guarded deployment that checks `.env` permissions, validates Compose, builds the app, runs preflight, starts HTTPS services and checks public health endpoints.
- `ops/oci/Caddyfile`: automatic TLS certificate management and reverse proxy.
- `ops/oci/backend.env.example`: safe environment-variable template.
- `.github/workflows/deploy-oci.yml`: optional push-to-deploy workflow after its SSH secrets are configured.

## Cost and reliability warning

Oracle documents an Always Free Ampere A1 allowance equivalent to **2 OCPUs and 12 GB RAM**, plus **200 GB total block-volume storage** in the tenancy home region. The free resources are intended to remain free when the instance and storage are created within the Always Free limits. Account sign-up requires a supported credit/debit card for identity verification, and temporary authorization holds may occur. A1 capacity can be unavailable in a selected region. Oracle can also reclaim an Always Free compute instance it determines is idle under its published seven-day CPU, network and (for A1) memory thresholds. Do not treat this as a production uptime guarantee.

Official references:
- [Oracle India Free Tier FAQ](https://www.oracle.com/in/cloud/free/faq/)
- [Oracle Always Free resources and limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Duck DNS free dynamic DNS](https://www.duckdns.org/about.jsp)

Create only resources explicitly labelled **Always Free**. Do not create a paid shape or paid storage volume by accident. Set a spending alert/budget in OCI, and inspect usage regularly.

Render's free web services are not a safe drop-in replacement for this file-backed token vault: Render documents that free services have ephemeral filesystems, no persistent disks and spin down after 15 minutes of inactivity. Its free Postgres offering also expires after 30 days. See [Render's free-service limitations](https://render.com/docs/free).

## 1. Create the VM

1. Create one Oracle Cloud Free Tier account. Choose the home region carefully; Always Free compute and block volumes must be provisioned in that home region.
2. Create a VM using an **Always Free eligible** Ubuntu ARM64 image and the **VM.Standard.A1.Flex** shape.
3. Allocate no more than **2 OCPUs and 12 GB memory total** across your A1 instances. A single 2-OCPU / 12-GB instance is sufficient for this app.
4. Use the default boot volume (50 GB is within the documented combined 200-GB Always Free block-volume allowance).
5. Assign a public IPv4 address. Save the IP address and the SSH private key securely.
6. In the VCN security list or network security group, allow inbound TCP 22 from your own IP where possible, plus TCP 80 and 443 from the internet. Do not expose port 3000 publicly.

If the A1 shape is unavailable, stop rather than selecting a billable shape. Oracle documents temporary home-region capacity shortages.

## 2. Obtain a stable HTTPS hostname

OAuth providers require exact HTTPS callback URLs. Use a domain you own or create a free Duck DNS subdomain.

1. Sign in at [Duck DNS](https://www.duckdns.org/), create a subdomain and point its IPv4 record to the VM's public IPv4 address.
2. Wait until the hostname resolves to that IP.
3. Keep the hostname stable. If the VM is recreated with a different IP, update the DNS record.
4. Keep ports 80 and 443 open. Caddy will request and renew the TLS certificate automatically once DNS points to this VM.

Example hostname: `my-commerce-hub.duckdns.org`. Replace this example everywhere below; do not use it literally.

## 3. Install Docker and download the repository

From Termux on Android, install SSH if needed:

```sh
pkg update
pkg install openssh
ssh ubuntu@YOUR_VM_PUBLIC_IP
```

On the Ubuntu VM:

```sh
sudo apt update
sudo apt install -y git docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo mkdir -p /opt/ai-commerce-hub
sudo chown "$USER:$USER" /opt/ai-commerce-hub
git clone https://github.com/fayisaftha786/-ai-commerce-hub-.git /opt/ai-commerce-hub
cd /opt/ai-commerce-hub
```

The OCI VCN ingress rules and the Ubuntu firewall must both permit ports 80/443. Keep SSH access restricted to your own IP if practical.

## 4. Configure private credentials on the VM

Copy the committed template to a private file:

```sh
cp ops/oci/backend.env.example .env
chmod 600 .env
nano .env
```

Replace every occurrence of `your-subdomain.duckdns.org` with the exact hostname from step 2. Set a working notification/contact email for `ACME_EMAIL`.

Generate the token-encryption key on the VM:

```sh
openssl rand -base64 32
```

Paste the generated value into `SOCIAL_TOKEN_ENCRYPTION_KEY` in the private `.env` file. Back up this key securely, separately from the encrypted data volume. Losing the key makes saved OAuth token records unreadable.

Never put `.env`, Google/Meta client secrets, OAuth tokens, passwords, OTPs or the encryption key in GitHub, the browser, screenshots or chat.

## 5. Configure Google and Meta OAuth

### YouTube

In Google Cloud:
1. Create a **Web application** OAuth client and enable YouTube Data API v3.
2. Add this exact authorised redirect URI, using your real hostname:

   `https://YOUR_HOSTNAME/api/social/youtube/callback`

3. Put the client ID and client secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the VM's private `.env`.
4. Ensure the OAuth consent screen and test-user/publishing requirements are satisfied for your Google account.

### Facebook and Instagram

In Meta for Developers:
1. Create/configure the Meta app and Facebook Login.
2. Add this exact redirect URI:

   `https://YOUR_HOSTNAME/api/social/meta/callback`

3. Put the app ID and secret in `META_APP_ID` and `META_APP_SECRET`.
4. Confirm the Facebook Page is managed by the authorising account. Instagram publishing requires an eligible linked Instagram Professional account and Meta's required permission access/app review.
5. Set `META_MEDIA_BASE_URL` to `https://YOUR_HOSTNAME`.

OAuth connection does not itself verify that the same social account is connected in Content Rewards. Complete that separate verification in Content Rewards.

## 6. Start the app with persistent storage and HTTPS

From `/opt/ai-commerce-hub`:

```sh
sudo bash ops/oci/deploy.sh
sudo docker compose -f compose.oci.yml logs --tail=100 app caddy
```

Open `https://YOUR_HOSTNAME/`. The static application and Node API now share one origin. On startup, ClipReward probes the same-origin `/api/discovery/status` endpoint and saves that backend origin automatically when the expected discovery API response is returned; no manual backend URL entry is required. Its secure session cookie also remains first-party.

Verify the public health and provider-readiness endpoints:

```sh
curl -fsS https://YOUR_HOSTNAME/health
curl -fsS https://YOUR_HOSTNAME/api/social/providers
```

The deployment script runs `docker compose config --quiet`, builds the app image, and runs `node scripts/oci-preflight.js` inside that container using the private `.env` variables. It blocks deployment when the hostname, encryption key, exact same-origin URLs or persistent storage paths are invalid. It then starts the app/Caddy stack and checks HTTPS `/health` and `/api/social/providers`. A healthy `/health` response proves only that the server is responding. `/api/social/providers` reports configuration readiness; neither proves OAuth consent, account connection, API permission or a successful upload.

Then open Social Media Desk, connect YouTube and/or Meta, select the correct channel/Page/Instagram destination, and complete a small controlled upload test. The publish flow still requires explicit confirmation.

## 7. Enable automatic backend redeploys from GitHub

After the VM is running, configure these GitHub repository **Actions secrets** (Settings → Secrets and variables → Actions → New repository secret):

- `OCI_HOST`: the VM public IP or hostname.
- `OCI_USER`: usually `ubuntu`.
- `OCI_SSH_PRIVATE_KEY`: the private SSH key for the deploy user.
- `OCI_KNOWN_HOSTS`: the verified SSH host-key line for that VM.

The public host key must be verified from the VM/OCI console before saving it. Do not blindly trust an unverified `ssh-keyscan` result.

The workflow connects to `/opt/ai-commerce-hub`, fetches the latest `main`, and runs `sudo bash ops/oci/deploy.sh`. That script validates the private `.env`, builds the Docker image, runs the OCI preflight, restarts Compose and checks the public HTTPS health endpoints. This means a successful scheduled Content Rewards snapshot commit on `main` can also refresh the app's bundled public snapshot on the VM.

After adding the secrets, run **Deploy Oracle Cloud backend** once from GitHub → Actions → workflow_dispatch. The workflow deploys only from `main`; PR #201 must be merged before its changes can be deployed. For automatic deployment after relevant pushes to `main`, also add the repository Actions variable `OCI_DEPLOY_ENABLED=true`. Without that variable, push-triggered deployment is safely skipped. The workflow never reads or uploads the VM's `.env` file.

## 8. Backups and operations

- Use `sudo docker compose -f compose.oci.yml logs -f app caddy` to inspect runtime logs.
- Use `sudo docker compose -f compose.oci.yml restart` to restart services.
- Use `sudo docker compose -f compose.oci.yml down` before maintenance. **Do not add `-v`**; that would delete named data volumes.
- Back up the `hub_data` Docker volume and keep the encryption key in a separate secure backup.
- Keep the VM on one instance. OAuth pending state is held in process memory; horizontal scaling or restarts during an in-progress OAuth redirect can require the user to restart the connection flow.
- Keep `DISCOVERY_SCHEDULER_ENABLED=false`: GitHub Actions remains the canonical public campaign discovery scheduler. This avoids duplicate crawlers.
- Recheck provider readiness and perform a real publish test after any OAuth secret, redirect URI, domain or API version change.

## What this deploys—and what it cannot automate

This deployment makes the existing backend available for YouTube uploads and Facebook Page / linked Instagram Professional Reels, subject to provider approval and account eligibility. It does **not** add an official Content Rewards API.

The following remain creator actions: joining/applying to a campaign, completing brand questions, verifying the exact posting account inside Content Rewards, waiting for draft pre-approval where required, submitting the public video URL within the campaign's deadline, and checking credited views, review, approval and payout in the official account. No earnings or campaign approval are guaranteed.
