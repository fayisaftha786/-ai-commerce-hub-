# AI Commerce Hub — Delivery Roadmap

This roadmap is ordered to reduce rework: make the evidence model reliable first, connect authorized data sources second, then build decisions and publishing workflows on top.

## Product goal

Help a solo affiliate marketer identify products worth testing, understand the evidence behind each recommendation, produce compliant creative, and learn from attributed outcomes. The app must never claim that a product is trending, likely to sell, or connected to a marketplace unless its data source actually supports that claim.

## Milestones

### 0. Stabilize the current prototype — in progress
- [x] Keep product scores explainable and mark missing demand, competition, stock, commission, and performance as unknown.
- [x] Import user-authorized catalogue/performance CSVs and flag suspicious click/order/return data.
- [x] Track where product evidence came from and when it was checked, and block shortlist readiness when the source is missing or the check date is stale/invalid/future-dated.
- [ ] Keep syntax checks and regression tests green before merging.
- Acceptance: imported rows show evidence completeness and freshness warnings; unknown data is never silently converted to a positive signal; a high score cannot overcome missing or stale evidence.

### 1. Make product research a reusable data model
- Normalize product title, marketplace, canonical product URL/ID, price, currency, rating/review count, stock, commission, delivery/return facts, source, source timestamp, and permitted media references.
- Separate observed facts from user estimates and calculated metrics.
- Detect duplicate products across imports without merging conflicting prices or seller offers.
- Show “last checked”, freshness, source, and missing fields beside each product.
- Acceptance: every displayed fact can be traced to a source and timestamp; stale or missing fields lower confidence and trigger re-check guidance.

### 2. Add marketplace integrations one at a time
- **First candidate: Flipkart Affiliate API**, if the account is registered and API credentials are available. Build a server-side provider adapter for product search/details/offers, handle pagination/rate limits, normalize responses, and never expose credentials in browser code.
- **Amazon India: Creators API**, only after Associates enrollment and API access eligibility/credentials are confirmed. Keep it disabled until the account has access and the current license requirements are implemented.
- **Meesho:** keep search links and user-authorized/manual CSV entry as the fallback unless Meesho supplies a documented API/feed or written permission for this use. Do not scrape pages or download assets from listings without authorization.
- Acceptance: provider shows Connected / Not configured / Error explicitly; no sample/mock results are presented as live data; each integration has fixture-based tests and safe failure handling.

### 3. Build reliable product selection and comparison
- Compare candidates using evidence coverage, current price, verified commission, availability, performance over comparable periods, returns/cancellations where available, and competition signals that have a named source.
- Keep “score” separate from “probability of sale”; do not manufacture a sales forecast from ratings or search links.
- Add sort/filter by confidence, evidence freshness, marketplace, price, and confirmed performance.
- Acceptance: missing performance data cannot outrank verified evidence merely because of a high catalogue score; recommendations explain both the reasons and uncertainties.

### 4. Improve creative production
- Reuse verified product facts to generate Malayalam/English captions, hook options, CTAs, and short-video storyboards.
- Add media import only from user uploads or assets explicitly authorized for promotional use.
- Keep editable previews, export/download, visible affiliate disclosure, and a pre-publish checklist.
- Acceptance: no unverified discount/feature/stock claim is inserted automatically; user must review and approve content before publishing.

### 5. Add social workflow safely
- Start with manual publish hand-off, content calendar, campaign IDs, and import of official platform insights.
- Add OAuth/API posting only for platforms and account types that are approved for the exact permission scopes. Keep client secrets and refresh tokens server-side; implement CSRF/state validation, token encryption, revocation, and minimal scopes.
- Acceptance: each platform reports its real connection state; no password collection; posting is disabled when permission or API setup is missing; publishing is confirmed only by a real platform response.

### 6. Learn from campaign outcomes
- Match official reports only by exact supported campaign/sub-ID, with consistent reporting periods.
- Detect duplicate imports and conflicting date windows; separate clicks, orders, returns, and approved/pending commission.
- Support CSV export and private local backup before any cloud sync is introduced.
- Acceptance: attribution is never guessed from product names, and estimates are not displayed as approved/payed commission.

### 7. Release readiness
- Run unit, wiring, input-validation, provider-adapter, and end-to-end happy-path tests.
- Validate small screens, keyboard/accessibility labels, storage failure, malformed CSV, stale data, provider timeouts, and unauthorized API responses.
- Write setup instructions, privacy/data-retention notes, API prerequisites, and a list of unimplemented features.
- Acceptance: green CI on the target branch, no secrets in repository/client bundles, and documentation matches actual behavior.

## Build strategy to finish faster

1. Finish and merge one coherent vertical slice at a time; keep the default branch green.
2. Reuse one normalized product schema for CSV imports and future API providers instead of writing separate scoring logic for each marketplace.
3. Write tests with each feature, not at the end.
4. Build provider adapters behind a common interface so a missing marketplace credential does not block local CSV/manual workflows.
5. Do not build speculative AI/API features until a real credential, permission, or approved data source is available.

## External access prerequisites (verify before implementation)

- Flipkart Affiliate API overview: https://affiliate.flipkart.com/api-docs/af_overview.html
- Flipkart API terms: https://affiliate.flipkart.com/api-docs/af_tou.html
- Amazon India Creators API prerequisites: https://affiliate-program.amazon.in/creatorsapi/docs/en-us/introduction
- Amazon Associates operating agreement: https://affiliate-program.amazon.in/help/operating/agreement

API availability and terms can change. Re-check official documentation at implementation time. Access to an API is conditional on programme enrollment, approval, account eligibility, and credentials; this code repository alone cannot grant it.
