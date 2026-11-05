# ClipReward Studio — repository audit (2026-11-05)

**Repository:** `fayisaftha786/-ai-commerce-hub-`  
**App:** `content-rewards-assistant/`  
**Audited main commit:** `6e182666e51d7104b3cb41cfb266830026b64197`  
**Snapshot time:** `2026-11-05T10:13:50.282Z`

## Executive result

ClipReward Studio is a standalone app inside the existing AI Commerce Hub repository. Public campaign discovery, campaign/rule analysis, local tracker, submission reminders and local video editor/export code exist. The optional Cloudflare backend and YouTube/Meta OAuth publishing code exist, but backend deployment and provider accounts were not verified as configured. This is **not** a fully automated end-to-end Content Rewards account integration.

## Latest public discovery snapshot

| Check | Result | Interpretation |
| --- | ---: | --- |
| Saved rows | 117 | Current and retained historical records together |
| Seen in latest official Discover scan | 69 | Listing presence only; not proof of eligibility or approval |
| Historical / absent from latest scan | 48 | Must be rechecked; not current opportunities by default |
| Current public detail pages readable | 69 / 69 | Public HTML was read for each current row |
| Current records with creator rules hidden until Join | 69 / 69 | The full campaign brief was not publicly visible |
| Current rows with detected deadline | 0 / 69 | Verify deadline in the official account/page |
| Current High-information records | 0 | The public evidence was insufficient for High |

At this snapshot time, all current records must be treated as **Verify first**. Do not start production until the complete brief is visible and verified. Do not treat a public CPM figure as guaranteed earnings.

## Feature matrix

| Area | Implemented | Boundary |
| --- | --- | --- |
| Official campaign discovery | GitHub Actions public Discover scan, about every six hours | Best-effort schedule; private, invite-only and join-locked pages are not crawled |
| Third-party fallback | Public scraped feed when official Discover cannot be read | Not official availability or an official API |
| Live campaign URL analysis | Optional backend route for one allowlisted public campaign URL | Requires a reachable HTTPS backend; no cookies or private account access |
| Rule/reward analysis | Parser for platform, CPM/per-post rates, budget, deadline, requirements and evidence gaps | Parsed fields are not eligibility or approval; locked rules remain unknown |
| Tracker / payout ledger | Local campaign, submissions, views, approval and settlement evidence fields | User-entered, device-local; no private CR/Whop payout sync |
| 30-minute reminder | Local timer/reminder | Does not submit the link; depends on active page/timer |
| Video preparation | Browser-local 9:16 editor/export | Uses user-provided/licensed assets; not generative AI footage/text-to-video |
| YouTube / Meta publishing | OAuth and API code paths | Requires deployed Worker, provider credentials/permissions and real account testing |
| TikTok | Excluded from India posting destinations | Not enabled for the India workflow |

## Deployment and CI status

- Cloudflare deploy workflow exists but is gated by `CLOUDFLARE_DEPLOY_ENABLED=true`.
- It requires `CF_API_TOKEN`, `SOCIAL_TOKEN_ENCRYPTION_KEY`, Cloudflare account/D1 IDs, `CF_WORKER_URL`, a pre-created D1 database and R2 bucket.
- Those account values and secrets are not visible in repository source and must not be guessed.
- GitHub connector did not return status-check entries for the audited base `main` commit; that historical base result remains unverified.
- Pull request [#219](https://github.com/fayisaftha786/-ai-commerce-hub-/pull/219) ran GitHub Actions CI run **#752** on the updated PR merge snapshot. The JavaScript syntax check passed; **585/585 main tests** and **196/196 rewards tests** passed; Cloudflare Worker bundle validation, local D1/R2 runtime smoke test, backend container build and same-origin container smoke test all passed.
- This validates the code in the PR merge snapshot only. It does not provision a Cloudflare account or prove provider OAuth / public-content publishing. A local test run was unnecessary after the GitHub runner completed these checks.

See [Cloudflare no-VM setup](CLIPREWARD_CLOUDFLARE_SETUP.md) for exact configuration steps.

## Safety / product decisions

1. Keep Content Rewards login, OTP, CAPTCHA, Join/Apply, account verification, Submit Clip and payout actions in the official account. No private Content Rewards API is integrated.
2. Never mark a campaign ready when its complete brief is locked. Unknown requirements remain unknown.
3. Keep historical rows visible for audit but below records present in the latest official Discover scan.
4. Keep local video creation/download/manual posting as the default path; social OAuth is optional.
5. Keep views, approved rewards, CR balance credit, Whop transfers and final withdrawals separate.

## Changes proposed in this branch

- Deep-analysis sorting places latest-scan campaigns ahead of historical campaigns before comparing evidence/state scores.
- Radar headline count and quick list refer only to campaigns seen in the latest official scan; historical leads remain in analysis history.
- Rewards Intelligence flags viewer-country/region payout restrictions when the brief links eligible/paid views to geographic terms.
- Service-worker cache is bumped to v43 and every existing cache-version assertion is updated.
- Regression tests cover current-vs-historical deep ranking, latest-scan headline/list display, viewer-country restriction positives and a no-geography negative case.
- Root and app READMEs now describe the actual feature boundaries and link the no-VM Cloudflare guide.
- The no-VM Cloudflare Worker guide documents required D1/R2 resources, GitHub variables/secrets, scoped token permissions, same-origin app URL, free-plan limits and local backup migration.

**Validation state:** GitHub Actions PR run #752 passed on the updated PR merge snapshot: syntax, 585 main tests, 196 rewards tests, Worker bundle, local D1/R2, backend container and same-origin smoke checks. Cloudflare production deployment and social OAuth remain unconfigured and unverified.