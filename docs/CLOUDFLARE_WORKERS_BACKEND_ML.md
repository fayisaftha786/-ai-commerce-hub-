# ClipReward Studio — Cloudflare Workers backend (Malayalam)

ഈ deployment route, OCI VM സൃഷ്ടിക്കാതെ ClipReward API-യെ Cloudflare Workers-ൽ പ്രവർത്തിപ്പിക്കാനുള്ളതാണ്. Static ClipReward app-ും API-കളും ഒരേ `workers.dev` origin-ൽ ലഭിക്കും. ഇത് GitHub Pages deployment-നെ പകരം വയ്ക്കുന്നില്ല; വേറൊരു backend deployment ആണ്.

## എന്താണ് ചേർത്തത്?

- Cloudflare Worker Node HTTP adapter നിലവിലുള്ള `server.js` API-യെ route ചെയ്യുന്നു.
- D1-ൽ discovery state, encrypted social tokens, one-time OAuth/PKCE state എന്നിവ persist ചെയ്യുന്നു.
- Tokens-ും temporary OAuth state payload-ുകളും AES-256-GCM ഉപയോഗിച്ച് encrypt ചെയ്യുന്നു. Key Cloudflare Worker Secret ആയി മാത്രം നൽകണം.
- Instagram-ന് Meta-യുടെ temporary public media URL നൽകാൻ R2 ഉപയോഗിക്കുന്നു. URL-യിലെ 256-bit random token expiry-യോടെയാണ് പ്രവർത്തിക്കുന്നത്; bucket public ആക്കേണ്ടതില്ല.
- D1-ൽ campaign state ഇല്ലാത്തപ്പോൾ Worker GitHub Pages-ൽ പ്രസിദ്ധീകരിക്കുന്ന latest public discovery snapshot വായിക്കുന്നു. Scheduled GitHub Actions scan തന്നെയാണ് source of truth.
- Worker runtime-ൽ file-based store ഉപയോഗിക്കുന്നില്ല. Cloudflare-ന്റെ `node:fs` virtual filesystem per-request മാത്രമാണ്; അതുകൊണ്ട് restart/request ഇടയിൽ token/discovery files persist ആകുമെന്ന് കരുതാൻ പറ്റില്ല.

## ആവശ്യമായ Cloudflare resources

Cloudflare Free account ഉപയോഗിച്ച് തുടങ്ങാം. നിലവിലെ Workers Free plan limits: 100,000 requests/day, 10 ms CPU time per request, 128 MB memory; limits മാറാം, paid quota automatically assume ചെയ്യരുത്. 50 MB വരെ video buffer ചെയ്യുന്ന publish flow free Worker memory/CPU പരിധിയിൽ എല്ലായ്പ്പോഴും fit ആകുമെന്ന് ഉറപ്പില്ല; ചെറിയ clips കൊണ്ട് test ചെയ്യുക. Deploy ചെയ്യുന്നതിന് മുമ്പ് dashboard-ലെ നിലവിലെ quota/pricing പരിശോധിക്കുക.

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) തുറന്ന് Workers & Pages access സജ്ജമാക്കുക.
2. D1 database സൃഷ്ടിക്കുക.
3. R2 bucket സൃഷ്ടിക്കുക.
4. Worker-ന്റെ API token/permissions കൊണ്ട് deployments നടത്തുക.

Termux അല്ലെങ്കിൽ കമ്പ്യൂട്ടറിൽ Node.js 24 ലഭ്യമാകണം. Repository clone ചെയ്ത ശേഷം:

```sh
npx wrangler login
npx wrangler d1 create clipreward-studio
npx wrangler r2 bucket create clipreward-studio-media
```

D1 create output-ൽ ലഭിക്കുന്ന database ID സൂക്ഷിക്കുക. Repository root-ൽ:

```sh
cp wrangler.jsonc.example wrangler.jsonc
```

`wrangler.jsonc` തുറന്ന് `database_id`-ൽ Cloudflare നൽകിയ യഥാർത്ഥ ID ചേർക്കുക. `wrangler.jsonc` Git-ലേക്ക് commit ചെയ്യരുത്; അത് ഇതിനകം `.gitignore`-ൽ ആണ്.

## D1 schema സജ്ജമാക്കുക

```sh
npx wrangler d1 migrations apply clipreward-studio --remote --config wrangler.jsonc
```

ഇത് `cloudflare/migrations/0001_initial.sql` പ്രവർത്തിപ്പിക്കും. Discovery state, social tokens, pending OAuth states എന്നിവയ്ക്ക് tables സൃഷ്ടിക്കും.

## Worker Secrets

Encryption key പുതുതായി സൃഷ്ടിക്കുക:

```sh
openssl rand -base64 32
```

കിട്ടുന്ന 32-byte key Cloudflare secret ആയി ചേർക്കുക. Value chat-ലോ GitHub repo-യിലോ commit ചെയ്യരുത്:

```sh
npx wrangler secret put SOCIAL_TOKEN_ENCRYPTION_KEY --config wrangler.jsonc
npx wrangler secret put GOOGLE_CLIENT_ID --config wrangler.jsonc
npx wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.jsonc
npx wrangler secret put META_APP_ID --config wrangler.jsonc
npx wrangler secret put META_APP_SECRET --config wrangler.jsonc
```

OAuth app values ഇപ്പോൾ ഇല്ലെങ്കിൽ ആദ്യ deploy-ൽ അവ ചേർക്കാതെ തന്നെ API health പരിശോധിക്കാം. അപ്പോൾ social provider readiness `configuration_incomplete` ആയിരിക്കും; അതാണ് ശരിയായ നില.

## ആദ്യ deploy + callback URLs

`wrangler.jsonc.example`-ൽ static site `_site`-ൽ നിന്ന് നൽകും. Build ചെയ്ത് deploy ചെയ്യുക:

```sh
npm run deploy:cloudflare
```

Worker URL ഉദാഹരണം: `https://clipreward-studio.<your-subdomain>.workers.dev`. ആദ്യം health പരിശോധിക്കുക:

```sh
curl https://<your-worker-host>/health
curl https://<your-worker-host>/api/social/providers
```

ആ URL ലഭിച്ചശേഷം Google Cloud Console-ലും Meta Developer Dashboard-ലും താഴെയുള്ള കൃത്യമായ redirect URIs ചേർക്കുക:

- Google: `https://<your-worker-host>/api/social/youtube/callback`
- Meta: `https://<your-worker-host>/api/social/meta/callback`

ശേഷം `wrangler.jsonc`-ലെ `vars` വിഭാഗത്തിൽ താഴെയുള്ള values നിങ്ങളുടെ Worker host-നനുസരിച്ച് ചേർക്കുക:

```json
{
  "SOCIAL_CORS_ORIGINS": "https://<your-worker-host>",
  "DISCOVERY_CORS_ORIGINS": "https://<your-worker-host>",
  "SOCIAL_RETURN_URL": "https://<your-worker-host>/content-rewards-assistant/",
  "GOOGLE_REDIRECT_URI": "https://<your-worker-host>/api/social/youtube/callback",
  "META_REDIRECT_URI": "https://<your-worker-host>/api/social/meta/callback",
  "META_MEDIA_BASE_URL": "https://<your-worker-host>",
  "DISCOVERY_PUBLIC_SNAPSHOT_URL": "https://fayisaftha786.github.io/-ai-commerce-hub-/content-rewards-assistant/discovery-snapshot.json"
}
```

ഈ vars-ന് ശേഷം വീണ്ടും:

```sh
npm run deploy:cloudflare
```

Google OAuth consent screen, YouTube Data API v3, Meta Login permissions, Facebook Page, അതുമായി ബന്ധിപ്പിച്ച Instagram Professional account എന്നിവ നിങ്ങളുടെ സ്വന്തം developer accounts-ൽ configure ചെയ്യണം. OAuth app verification / Meta App Review ആവശ്യമെങ്കിൽ provider തീരുമാനം അനുസരിച്ച് പൂർത്തിയാക്കണം. Login authorize ചെയ്യാതെ code മാത്രം ചേർത്താൽ publishing enabled ആകില്ല.

## App തുറക്കുക

`https://<your-worker-host>/content-rewards-assistant/`

Worker static asset routing `/api/*`, `/media/*`, `/health` എന്നിവ മാത്രം Node API-യിലേക്ക് ആദ്യം അയക്കും. മറ്റു files static assets ആയി നൽകും. API and UI same-origin ആയതിനാൽ CORS allowlist exact Worker origin ആയിരിക്കണം.

## സുരക്ഷാ / പ്രവർത്തന പരിധികൾ

- R2 bucket public ആക്കരുത്. Video object വായിക്കാൻ ആവശ്യമായ opaque 64-hex URL token മാത്രമാണ് app നൽകുന്നത്.
- Temporary Instagram media-യ്ക്ക് 15-minute expiry ഉണ്ട്; success/failure flow-ൽ dispose ചെയ്യുകയും expiry കഴിഞ്ഞുള്ള GET-ൽ object delete ചെയ്യുകയും ചെയ്യും. ഇടയ്ക്ക് Worker terminate ആയാൽ ശേഷിച്ച object-ുകൾക്കായി R2 lifecycle rule ചേർക്കുക (ഉദാ. `instagram/` prefix 1 day കഴിഞ്ഞ് delete).
- D1 token records encrypted at rest by this app. Encryption key നഷ്ടപ്പെട്ടാൽ stored social tokens decrypt ചെയ്യാനാവില്ല; അത് സുരക്ഷിതമായി backup ചെയ്യുക, പക്ഷേ Worker Secret-ൽ മാത്രം സൂക്ഷിക്കുക.
- Cloudflare Free Workers-ന്റെ CPU/request limits current docs പ്രകാരം വ്യത്യസ്തമാണ്; 50 MB media upload പോലുള്ള പ്രവർത്തനങ്ങൾ production traffic-ൽ നിരീക്ഷിക്കുക. Quota/overage പരിധി കടന്നാൽ paid plan ആവശ്യമായേക്കാം.
- GitHub Actions public campaign scan ആറു മണിക്കൂറിലൊരിക്കൽ best-effort ആണ്; Worker API current public snapshot GitHub Pages-ൽ നിന്ന് വായിക്കുന്നു. Scan success എന്നത് campaign rules മുഴുവൻ public ആണെന്നോ user eligible ആണെന്നോ അർത്ഥമല്ല.
- Content Rewards Join/Apply, locked joined-only brief, Submit Clip, private views, approval, payout എന്നിവയ്ക്ക് documented public API ഇല്ലാത്തതിനാൽ manual തന്നെയാണ്.
- Cloudflare Worker code, D1/R2 adapters എന്നിവ local fake bindings ഉപയോഗിച്ച് tests-ൽ പരിശോധിച്ചാലും, യഥാർത്ഥ Cloudflare account-ൽ deploy/OAuth provider callbacks test ചെയ്യുന്നത് വേറൊരു operational step ആണ്.

## Current API checks

```sh
curl -fsS https://<your-worker-host>/health
curl -fsS https://<your-worker-host>/api/social/providers
```

`/health` `ok: true` നൽകുന്നത് Worker API process പ്രവർത്തിക്കുന്നു എന്നർത്ഥം മാത്രം. Provider endpoint `configured` എന്ന് കാണിച്ചാലും real OAuth consent, account permissions, live post publishing വിജയിച്ചതായി അതുകൊണ്ട് മാത്രം ഉറപ്പാകില്ല.
