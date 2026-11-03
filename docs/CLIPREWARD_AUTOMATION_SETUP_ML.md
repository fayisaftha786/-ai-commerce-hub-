# ClipReward Studio — Full Automation Setup (Malayalam)

ഈ guide, GitHub Pages-ൽ കാണുന്ന ClipReward Studio-യെ സ്വകാര്യ HTTPS backend-ുമായി ബന്ധിപ്പിച്ച് YouTube, Facebook Page, Instagram Professional publishing സജ്ജമാക്കാനുള്ളതാണ്.

> **നിലവിലെ code status:** PR #201-ൽ ഉള്ള പുതിയ live-campaign analysis, scan-status labels, backend auto-detection എന്നിവ ആദ്യം merge ചെയ്ത് `main`-ൽ എത്തണം. PR merge ചെയ്യുന്നതിന് മുമ്പ് താഴെ പറയുന്ന production workflow ഉപയോഗിച്ച് ആ പുതിയ code deploy ചെയ്യാൻ കഴിയില്ല. PR #201: https://github.com/fayisaftha786/-ai-commerce-hub-/pull/201

## 1. എന്താണ് auto ആകുന്നത്, എന്താണ് manual?

| Workflow | Automation |
|---|---|
| Public Content Rewards discovery | GitHub Actions scheduled scan; ഏകദേശം 6 മണിക്കൂറിൽ ഒരിക്കൽ snapshot പുതുക്കുന്നു |
| Campaign rules / reward analysis | ലഭ്യമായ public text അടിസ്ഥാനമാക്കി auto analysis, evidence, missing fields, Promising / Verify / Blocked |
| Local tracker autofill / batch import | Fresh readable Promising campaign-ുകൾ മാത്രം; browser-ൽ local |
| Video preparation | Clip Studio-യിൽ local video analysis, captions/draft, export; output review ചെയ്യണം |
| YouTube publishing | Google OAuth + backend + YouTube API അനുമതി ലഭിച്ചാൽ explicit user confirmation-നുശേഷം |
| Facebook Page Reels | Meta OAuth + Page permissions + backend സജ്ജമായാൽ explicit confirmation-നുശേഷം |
| Instagram Reels | Linked Instagram Professional account + Meta permissions + public media hosting സജ്ജമായാൽ |
| Content Rewards Join / Apply / Submit Clip / private views / approval / payout | **Manual** — documented supported creator API നിലവിൽ സംയോജിപ്പിച്ചിട്ടില്ല |

പൊതു campaign page വായിക്കുന്നത് account login അല്ല. ഇത് private campaign, Join ചെയ്തശേഷമുള്ള hidden rules, account eligibility, payout dashboard എന്നിവ വായിക്കില്ല. Earnings/approval ഉറപ്പില്ല.

## 2. Architecture

- GitHub Pages: frontend, scheduled public-discovery snapshot.
- OCI VM: Node backend, OAuth callbacks, encrypted token vault, Instagram temporary media endpoint, same-origin HTTPS app.
- GitHub Actions: CI + scheduled scan + (deploy secrets ചേർത്താൽ) OCI deployment.
- OAuth secrets: OCI VM-യിലെ സ്വകാര്യ `.env`-ൽ മാത്രം. GitHub Pages, frontend JavaScript, browser storage, chat എന്നിവയിൽ ഇടരുത്.

**Free hosting കുറിപ്പ്:** OCI Always Free-ൽ Ampere A1-ന് 2 OCPU + 12 GB RAM equivalent monthly allowance കാണിക്കുന്നു. Always Free eligibility, region capacity, account approval, boot volume/IP availability എന്നിവ മാറാം. Oracle home region-ൽ capacity ഇല്ലെങ്കിൽ VM ലഭിക്കാതിരിക്കാം. Idle Always Free VM reclaim ചെയ്യപ്പെടാനും സാധ്യതയുണ്ട്. Free Tier-ന് SLA ഇല്ല; അതിനാൽ ഇത് low-cost പരീക്ഷണ hosting ആയി കാണുക, guaranteed uptime ആയി അല്ല. പരിശോധിക്കുക: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm

Oracle Free Tier signup-ൽ identity/payment-card verification ചോദിക്കാം; temporary authorization hold ഉണ്ടാകാം. Billing console-ൽ resource-ുകൾ **Always Free-eligible** ആണെന്ന് ഉറപ്പാക്കാതെ paid shape/resource സൃഷ്ടിക്കരുത്: https://www.oracle.com/cloud/free/faq/

## 3. OCI VM സൃഷ്ടിക്കൽ

1. https://cloud.oracle.com/ തുറന്ന് നിങ്ങളുടെ സ്വന്തം Oracle account ഉപയോഗിച്ച് sign in ചെയ്യുക.
2. Home Region-ൽ Compute → Instances → Create Instance തുറക്കുക.
3. Ubuntu 24.04 ARM64 image തിരഞ്ഞെടുക്കുക. Shape ആയി `VM.Standard.A1.Flex` തിരഞ്ഞെടുക്കുമ്പോൾ Free Tier allowance കടക്കാതെ **2 OCPU, 12 GB RAM-ൽ കൂടുതലാകരുത്**. Console-ൽ shape-ിന് Always Free eligibility കാണിക്കുന്നുണ്ടെന്ന് വീണ്ടും പരിശോധിക്കുക.
4. Boot volume-നും network-നും Always Free label/limit പരിശോധിക്കുക. Public IPv4 assign ചെയ്യുക; പിന്നീട് DNS-ൽ ഈ IP ഉപയോഗിക്കും.
5. SSH public key നൽകി VM സൃഷ്ടിക്കുക. Private key സുരക്ഷിതമായി സ്വന്തം device-ൽ സൂക്ഷിക്കുക.
6. VCN Security List / Network Security Group-ൽ inbound TCP 22 (നിങ്ങളുടെ IP-യിൽ നിന്ന് മാത്രം), TCP 80, TCP 443 (public) അനുവദിക്കുക. Unneeded ports തുറക്കരുത്.

Capacity error വരികയാണെങ്കിൽ paid shape എടുക്കാതെ മറ്റൊരു availability domain പരിശോധിക്കുക അല്ലെങ്കിൽ പിന്നീട് വീണ്ടും ശ്രമിക്കുക.

## 4. Hostname + HTTPS

നിങ്ങൾക്ക് ഒരു domain/subdomain വേണം. അതിന്റെ DNS A record VM-ന്റെ public IPv4-ലേക്ക് point ചെയ്യുക. സ്വന്തം domain ഇല്ലെങ്കിൽ വിശ്വസനീയമായ free dynamic-DNS hostname ഉപയോഗിക്കാം; അതിന്റെ DNS update തുടർച്ചയായി ശരിയാണെന്ന് ഉറപ്പാക്കണം.

ഈ രണ്ട് മൂല്യങ്ങൾ രേഖപ്പെടുത്തുക:
- `SITE_HOST`: DNS-ൽ ഉപയോഗിക്കുന്ന hostname മാത്രം; protocol/path ഇല്ല.
- `ACME_EMAIL`: TLS certificate notifications-നുള്ള email.

Caddy reverse proxy ആണ് HTTPS കൈകാര്യം ചെയ്യുന്നത്. DNS തെറ്റാണെങ്കിൽ അല്ലെങ്കിൽ ports 80/443 അടച്ചിട്ടുണ്ടെങ്കിൽ certificate/health check പരാജയപ്പെടും.

## 5. VM-ൽ backend install ചെയ്യുക

SSH വഴി VM-ൽ കയറി താഴെയുള്ള command-ുകൾ പ്രവർത്തിപ്പിക്കുക. Ubuntu image-ൽ സാധാരണ `ubuntu` user ഉപയോഗിക്കുന്നു.

```bash
sudo apt update
sudo apt install -y git docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo mkdir -p /opt/ai-commerce-hub
sudo chown "$USER":"$USER" /opt/ai-commerce-hub
git clone https://github.com/fayisaftha786/-ai-commerce-hub-.git /opt/ai-commerce-hub
cd /opt/ai-commerce-hub
git checkout main
```

Docker Compose package install නොആയാൽ Docker-ന്റെ official Ubuntu install guide പിന്തുടരുക: https://docs.docker.com/engine/install/ubuntu/

**ആദ്യ deploy സമയത്ത് PR #201 merge ചെയ്തിരിക്കണം.** അതിന് മുമ്പ് main branch-ൽ പുതിയ PR changes ഇല്ല.

## 6. സ്വകാര്യ backend environment സൃഷ്ടിക്കുക

```bash
cd /opt/ai-commerce-hub
cp ops/oci/backend.env.example .env
chmod 600 .env
nano .env
```

`.env`-ൽ കുറഞ്ഞത് താഴെ പറയുന്ന values ശരിയാക്കുക:

- `SITE_HOST` = നിങ്ങളുടെ യഥാർത്ഥ hostname.
- `ACME_EMAIL` = നിങ്ങളുടെ email.
- `NODE_ENV=production`
- `SERVE_STATIC_APP=true`
- `GOOGLE_REDIRECT_URI=https://YOUR_HOST/api/social/youtube/callback`
- `META_REDIRECT_URI=https://YOUR_HOST/api/social/meta/callback`
- `META_MEDIA_BASE_URL=https://YOUR_HOST`
- `SOCIAL_TOKEN_STORE_PATH=/data/social-token-vault.json`
- `DISCOVERY_STORE_PATH=/data/content-rewards-discovery.json`
- `SOCIAL_CORS_ORIGINS=https://YOUR_HOST`
- `DISCOVERY_CORS_ORIGINS=https://YOUR_HOST`
- `SOCIAL_RETURN_URL=https://YOUR_HOST/`
- `SOCIAL_COOKIE_SAMESITE=Lax`
- `DISCOVERY_SCHEDULER_ENABLED=false`

`YOUR_HOST` എന്നത് നിങ്ങളുടെ യഥാർത്ഥ hostname കൊണ്ട് മാറ്റുക. CORS origin-ൽ trailing slash ചേർക്കരുത്; return URL-ൽ trailing slash വേണം.

Token encryption key VM-ൽ തന്നെ generate ചെയ്യുക:

```bash
openssl rand -base64 32
```

അതിന്റെ output `.env`-യിലെ `SOCIAL_TOKEN_ENCRYPTION_KEY`-ൽ ഇടുക. Key ഒരിക്കലും chat-ൽ paste ചെയ്യരുത്. Encrypted vault file-ിനൊപ്പം key-യുടെ സുരക്ഷിതമായ offline backup വേറെയും സൂക്ഷിക്കുക. Key നഷ്ടപ്പെട്ടാൽ പഴയ encrypted OAuth tokens തുറക്കാനാവില്ല. `.env` permissions `600` ആയിരിക്കണം; git-ൽ commit ചെയ്യരുത്.

Google/Meta OAuth credentials ഇപ്പോൾ ഇല്ലെങ്കിൽ ആദ്യം അവ blank ആയി വെച്ച് backend health deploy ചെയ്യാം; publishing അതുവരെ disabled ആയിരിക്കും.

## 7. ആദ്യ backend deployment + health check

```bash
cd /opt/ai-commerce-hub
sudo bash ops/oci/deploy.sh
```

ഈ script:
- Docker Compose configuration validate ചെയ്യും.
- Backend image build ചെയ്യും.
- Secret values print ചെയ്യാതെ environment preflight നടത്തും.
- Persistent volume mount-ോടെ app/Caddy start ചെയ്യും.
- HTTPS `/health`-യും social-provider readiness endpoint-ഉം പരിശോധിക്കും.

പിന്നീട് browser-ൽ പരിശോധിക്കുക:

- `https://YOUR_HOST/` — app തുറക്കണം.
- `https://YOUR_HOST/health` — health JSON വരണം.
- `https://YOUR_HOST/api/social/providers` — provider configuration readiness മാത്രം കാണിക്കും; connected account എന്നർത്ഥമല്ല.

Preflight FAIL വന്നാൽ error name/detail മാത്രം നോക്കി `.env`-ൽ തിരുത്തുക. Secret values ആരോടും അയക്കരുത്.

## 8. Google / YouTube OAuth

1. https://console.cloud.google.com/ തുറന്ന് പുതിയ project സൃഷ്ടിക്കുക.
2. YouTube Data API v3 enable ചെയ്യുക.
3. OAuth consent screen configure ചെയ്യുക. ആദ്യം testing ആണെങ്കിൽ നിങ്ങളുടെ Google account-നെ test user ആയി ചേർക്കുക.
4. Credentials → Create Credentials → OAuth client ID → Web application തിരഞ്ഞെടുക്കുക.
5. Authorized redirect URI-ൽ കൃത്യമായി ചേർക്കുക: `https://YOUR_HOST/api/social/youtube/callback`
6. ലഭിക്കുന്ന Client ID, Client Secret VM-യിലെ `.env`-ൽ മാത്രം ചേർക്കുക:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI`
7. `sudo bash ops/oci/deploy.sh` വീണ്ടും പ്രവർത്തിപ്പിക്കുക.
8. App → Social Desk-ൽ YouTube connect ചെയ്യുക; Google consent പൂർത്തിയാക്കി channel തിരിച്ചറിയപ്പെടുന്നുണ്ടോ പരിശോധിക്കുക.

ഈ implementation ആവശ്യപ്പെടുന്ന scopes:
- `https://www.googleapis.com/auth/youtube.readonly`
- `https://www.googleapis.com/auth/youtube.upload`

YouTube OAuth/API ഉപയോഗത്തിന് Google policy, consent screen, quota, publishing restrictions എന്നിവ ബാധകമാണ്. API enable ചെയ്തതുകൊണ്ട് മാത്രം public publishing approval ഉറപ്പില്ല. Official docs: https://developers.google.com/youtube/v3/getting-started

## 9. Meta / Facebook / Instagram OAuth

ഈ code path ഉപയോഗിക്കുന്നത് Meta Facebook Login + Graph API ആണ്. ആവശ്യമായ permissions:
- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts`
- `instagram_basic`
- `instagram_content_publish`

1. https://developers.facebook.com/ ൽ developer account ഉപയോഗിച്ച് Meta app സൃഷ്ടിക്കുക.
2. Facebook Login / ആവശ്യമായ publishing products/use cases configure ചെയ്യുക.
3. App settings-ൽ കൃത്യമായ redirect URI ചേർക്കുക: `https://YOUR_HOST/api/social/meta/callback`
4. App ID, App Secret VM-യിലെ `.env`-ൽ ചേർക്കുക:
   - `META_APP_ID`
   - `META_APP_SECRET`
   - `META_REDIRECT_URI`
   - `META_MEDIA_BASE_URL=https://YOUR_HOST`
5. `sudo bash ops/oci/deploy.sh` വീണ്ടും പ്രവർത്തിപ്പിക്കുക.
6. Facebook account-ന് ആവശ്യമായ Page access ഉണ്ടെന്നും Instagram Professional account ആ Page-ലേക്ക് link ചെയ്തിട്ടുണ്ടെന്നും പരിശോധിക്കുക.
7. Social Desk → Meta connect വഴി login ചെയ്ത് ശരിയായ Page/Instagram account തിരിച്ചറിയപ്പെടുന്നുണ്ടോ പരിശോധിക്കുക.

**Instagram Creator account — രണ്ട് വ്യത്യസ്ത നിയമങ്ങൾ:** Content Rewards-ന്റെ connection guide Business മാത്രം എന്ന് പറയുന്നു. എന്നാൽ അതിന്റെ Creator Terms §14.1, Privacy Policy §4.1 Professional/Business അല്ലെങ്കിൽ Creator account OAuth വഴി connect ചെയ്യാമെന്ന് പറയുന്നു. ഇത് official documentation conflict ആണ്. അതിനാൽ ആദ്യം നിലവിലെ Creator account Content Rewards-ൽ തന്നെ connect ചെയ്ത് നോക്കുക. reject ചെയ്താൽ exact error സൂക്ഷിച്ച് Support-നോട് clarification ചോദിച്ചശേഷം മാത്രമേ account type മാറ്റാവൂ.

**ClipReward-ന്റെ വേറിട്ട Meta publishing integration:** Facebook Login API-യ്ക്ക് Professional Creator അല്ലെങ്കിൽ Business account ഒരു Facebook Page-ുമായി link ചെയ്തിരിക്കണം. Page link ഇല്ലെങ്കിൽ Meta connection-ൽ Instagram account കണ്ടെത്താനിടയില്ല. Meta app development mode-ൽ app roles/test users ഉപയോഗിച്ച് ആദ്യം സ്വന്തം account പരീക്ഷിക്കുക. മറ്റുള്ളവരുടെ accounts-നായി സേവനം നൽകുമ്പോൾ Meta App Review/Advanced Access ആവശ്യമായേക്കാം; permissions approval ഉറപ്പല്ല. Content Rewards link, Meta publisher OAuth എന്നിവ പരസ്പരം പകരമല്ല.

Official Meta developer entry: https://developers.meta.com/  
Meta Instagram API collection: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api

## 10. GitHub Actions വഴി തുടർ auto-deploy

ആദ്യ manual backend deployment വിജയിച്ചതിനു ശേഷം മാത്രമേ ഇത് configure ചെയ്യാവൂ.

1. VM-ൽ deploy-നായി വേറെ SSH keypair സൃഷ്ടിക്കുക; public key VM deploy user-ന്റെ `~/.ssh/authorized_keys`-ൽ ചേർക്കുക. Private key നിങ്ങളുടെ സ്വന്തം device-ൽ നിന്ന് പുറത്തേക്ക് സുരക്ഷിതമായി കൈമാറുക.
2. GitHub repository → Settings → Secrets and variables → Actions → Secrets-ൽ താഴെ പറയുന്ന നാല് secrets ചേർക്കുക:
   - `OCI_HOST` — VM public IP/hostname.
   - `OCI_USER` — SSH user, സാധാരണ `ubuntu`.
   - `OCI_SSH_PRIVATE_KEY` — deploy key private content.
   - `OCI_KNOWN_HOSTS` — server host-key line. Host fingerprint-നെ trusted console/source-ൽ നിന്ന് verify ചെയ്തശേഷം മാത്രം സ്വീകരിക്കുക; blindly `ssh-keyscan` output വിശ്വസിക്കരുത്.
3. Actions → Variables-ൽ `OCI_DEPLOY_ENABLED=true` ചേർക്കുക.
4. VM user-ൽ `sudo -n true` വിജയിക്കുന്നുണ്ടെന്ന് പരിശോധിക്കുക; SSH workflow interactive password ചോദിക്കാനാവില്ല.
5. PR #201 merge ചെയ്ത് main CI വിജയിച്ചതിനുശേഷം മാത്രം Actions → Deploy Oracle Cloud backend → Run workflow പ്രവർത്തിപ്പിക്കുക.

Workflow secrets names/format പരിശോധിച്ചശേഷം `/opt/ai-commerce-hub`-ൽ main update ചെയ്ത് deploy script പ്രവർത്തിപ്പിക്കും. SSH secrets ഇല്ലാതെ auto-deploy സാധ്യമല്ല. `OCI_DEPLOY_ENABLED` ഒരു non-secret switch മാത്രമാണ്.

## 11. End-to-end acceptance test

ഓരോ ഘട്ടവും വേർതിരിച്ച് verify ചെയ്യുക:

1. Pages app തുറക്കുന്നു.
2. Latest discovery snapshot timestamp/status പുതുക്കുന്നു; historical leads clearly label ചെയ്യുന്നു.
3. Public campaign URL മാത്രം ഉപയോഗിച്ച് live Analyse test ചെയ്യുക (backend configured ആണെങ്കിൽ).
4. Video export locally download ചെയ്ത് playback പരിശോധിക്കുക.
5. YouTube OAuth connect → channel identity → ഒരു test video unlisted/private ആയി upload → provider status/permalink verify ചെയ്യുക. Public Content Rewards post ചെയ്യുന്നതിന് മുമ്പ് campaign rules വീണ്ടും പരിശോധിക്കുക.
6. Meta OAuth connect → സ്വന്തം test Page-ലേക്ക് Reels test ചെയ്യുക.
7. ClipReward Meta publisher-ൽ Creator/Business Professional account linked Facebook Page സഹിതം കണ്ടെത്തുന്നുണ്ടോ പരിശോധിക്കുക. Content Rewards-ന്റെ സ്വന്തം Instagram connection വേറിട്ട് official flow-ൽ test ചെയ്യുക; നിലവിലെ Help Guide-നും Terms/Privacy Policy-ക്കും account-type വ്യത്യാസമുണ്ട്.
8. Social Desk-ൽ public publishing confirmation ലഭിച്ചാൽ മാത്രമേ post receipt tracker-ിലേക്ക് പോകൂ. Content Rewards-ൽ exact account verification, Join/Apply, 30-minute ഉള്ളിൽ Submit Clip എന്നിവ creator തന്നെ ചെയ്യണം.

## 12. Troubleshooting

- HTTPS certificate error: DNS A record, public IP, TCP 80/443, Caddy logs പരിശോധിക്കുക.
- `SITE_HOST` / CORS preflight error: hostname, scheme `https`, no path, exact origin പരിശോധിക്കുക.
- OAuth redirect mismatch: Google/Meta console URIയും `.env` URIയും character-by-character ഒരുപോലെ ആക്കുക.
- Provider configured അല്ല: `/api/social/providers` response-ലെ missing key names മാത്രം നോക്കുക; secret value അയക്കേണ്ടതില്ല.
- Instagram account missing: Creator/Business Professional account-നെ ആവശ്യമായ Facebook Page-ൽ link ചെയ്തിട്ടുണ്ടോ പരിശോധിക്കുക.
- Public media fetch error: `META_MEDIA_BASE_URL` public HTTPS ആണോ, Caddy/port 443 reachable ആണോ പരിശോധിക്കുക.
- VM capacity unavailable: Always Free shape-ന് capacity ഇല്ലായിരിക്കാം; paid shape എടുക്കാതെ വീണ്ടും ശ്രമിക്കുക.
- Backup: encrypted token vault file-ും അതിന്റെ encryption key-യും രണ്ടും വേർതിരിച്ച് സുരക്ഷിതമായി സൂക്ഷിക്കുക.

## 13. സുരക്ഷാ പരിധി

Creator passwords, Content Rewards cookies, browser session tokens, Google/Meta secrets എന്നിവ ഒരിക്കലും GitHub source, Issues, chat, screenshot, frontend/localStorage എന്നിവയിൽ ഇടരുത്. Account login, Join/Apply, Submit Clip, credited views, approval, payout എന്നിവ automated ആണെന്ന് app അവകാശപ്പെടരുത്. Provider OAuth connect ചെയ്തതും Content Rewards-ൽ account verify ചെയ്തതും രണ്ട് വ്യത്യസ്ത കാര്യങ്ങളാണ്.
