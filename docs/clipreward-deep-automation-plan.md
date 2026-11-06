# ClipReward Studio — Deep Automation Plan & Audit

**Audit date:** 2026-11-06  
**Repository:** `fayisaftha786/-ai-commerce-hub-`  
**Scope:** Content Rewards campaign discovery and creator-side preparation for India, focused on Instagram, Facebook and YouTube. TikTok is excluded from the supported workflow.

## 1. Evidence-backed current state

The latest saved official public Discover snapshot was generated at **2026-11-06 12:34:54 UTC**.

| Check | Observed result |
|---|---:|
| Campaign links in latest official listing | 67 |
| Current campaigns retained in the app snapshot | 67 |
| Historical campaigns retained for reference | 61 |
| Current campaign detail pages fetched and readable | 67 / 67 |
| Current campaigns with Join-locked creator requirements | 67 / 67 |
| Current campaigns with a detected deadline | 0 / 67 |
| Saved detail-page records | 100 (67 current readable, 33 stale) |
| Current platform mentions in visible listing | Instagram 60, YouTube 44, Facebook 1 |
| Latest scan result | Success; 67 detail pages attempted, 67 available, 0 failed |

**Interpretation:** Public listing discovery works, but it does not reveal the complete campaign brief. The current public dataset cannot safely support a final production-ready campaign pack: every current campaign hides at least one creator requirement, and no current deadline was recognised. Historical rows and stale details must never be ranked as fresh opportunities.

## 2. Platform constraints that shape the design

- Content Rewards' public help documentation currently says an official public API is not available. Therefore, private campaign details and Join/Apply/submission/payout actions cannot be claimed as API-automated.
- Content Rewards' account-connection help requires an Instagram **Business** account. A Creator account or an Instagram connection made elsewhere must not be shown as verified inside Content Rewards.
- Content Rewards' documented workflow requires the creator to post first and submit the post link within 30 minutes. The brand then reviews the submitted clip; the app cannot assume approval or payout.
- YouTube/Meta OAuth in ClipReward is a separate integration. Connecting a social account to this app would not itself connect or verify that account in Content Rewards.

These are platform-level limits, not code defects that can be fixed by retrying a private endpoint or using stored browser cookies. Do not bypass sign-in, Join gates, CAPTCHAs or access controls.

## 3. Automation that can be made reliable without private access

1. **Official discovery only:** read the public Discover index, fetch campaign detail pages, validate canonical official URLs, deduplicate by campaign ID/URL, preserve scan history, and mark source failures honestly.
2. **Source integrity:** never silently replace an official scan with a third-party campaign feed. On official source outage, retain the last known official snapshot and mark the latest scan failed. An explicitly requested official public URL may still be checked directly.
3. **Freshness and evidence analysis:** classify each result using the latest scan, detail-page fetch status, deadline, accepted channels, payout model/caps, minimum payout/views, budget, creator requirements and disclosed restrictions. Missing/hidden information reduces confidence; it is not guessed.
4. **Auto-tracking:** import only deduplicated, current, readable, supported-platform Promising leads. Keep Verify/Blocked/Historical leads out of the active work queue.
5. **Bilingual preparation:** prepare English + Malayalam hooks, captions and storyboards from verified visible evidence only. No invented benefits, claims, results, rates or deadlines.
6. **Review-only exports for locked briefs:** allow draft text, JSON, subtitles, local video and ZIP exports so the creator can inspect a concept. Stamp every preliminary video with a permanent **PRELIMINARY · DO NOT POST** watermark; put warnings into subtitles, filenames, and the ZIP. These exports are not production-cleared.
7. **Local video workflow:** use only media the creator owns or is authorised to use. Rendering remains on-device; browser codec/MediaRecorder support is checked at runtime. No automatic AI footage or voice generation is implied.
8. **Submission timing support:** retain an accurate 30-minute post-to-link reminder and local record of the actual post and submission times. Do not claim the app can submit links to Content Rewards.

## 4. Work executed in this change

- [x] Changed scheduled discovery to use the official public Discover source only.
- [x] On official Discover outage, preserve the prior snapshot and record a failed scan; do not substitute third-party campaign rows.
- [x] Keep direct, explicitly requested official campaign-page checks available without mixing in third-party rows.
- [x] Enable local review exports from current, readable, platform-matched Join-locked briefs.
- [x] Keep the preliminary label visible in pack metadata and text.
- [x] Burn a permanent warning into both text-only and user-media-rendered video drafts.
- [x] Add a warning to every SRT/VTT cue.
- [x] Prefix preliminary filenames and include a standalone `PRELIMINARY-DO-NOT-POST.txt` in ZIP exports.
- [x] Update tests and user-facing documentation.
- [x] Bump the service-worker cache so installed app clients can fetch the new assets.

## 5. Remaining phases and acceptance gates

### Phase A — Production verification
- Confirm GitHub Pages deploy action succeeds after merge.
- Open the deployed app in Android Chrome, reload once online, and verify the PWA refreshes to the new cache.
- Run the official scan and verify the audit report and freshness metadata.
- Export one preliminary sample; inspect the visible watermark, SRT/VTT warnings, ZIP warning file, and filenames.
- Check that a later full unlocked pack removes preliminary labels only after a newly fetched full brief passes the evidence gates.

**Pass condition:** app deployment, snapshot freshness, and all review-export warnings are independently verified; no success is inferred from a unit-test count alone.

### Phase B — Full-brief intake after Join
The creator must complete the Content Rewards Join/Apply step inside Content Rewards. If the page then exposes requirements and reference files, build an explicit, consent-based intake path for that complete brief. Keep the source timestamp and evidence attached; compare the unlocked brief with the public listing. Do not scrape authenticated browser sessions or store Content Rewards passwords/cookies.

**Pass condition:** required platform, duration, asset rights, tags, mentions, disclosure, restrictions, deadline and payout rules are explicitly captured or marked unknown. A missing field blocks final clearance.

### Phase C — Creator-account readiness
- Reflect Content Rewards' own connected/verified account state; do not infer it from the app's OAuth.
- For Instagram campaigns, show a blocking readiness message until Content Rewards confirms the required Business account is connected.
- For Facebook and YouTube, require the platform connection/verification status shown inside Content Rewards.
- Keep YouTube/Meta publishing integrations optional; manual download/post remains supported.

**Pass condition:** only provider-verified account status is shown as connected; a local handle or OAuth token alone is insufficient.

### Phase D — Post and 30-minute submission workflow
- The creator posts through the relevant native platform app unless a separate official publishing integration is explicitly configured and approved.
- Capture the actual post-publication time and post URL.
- Start the 30-minute countdown from that timestamp; show local reminders while the app is active.
- Keep Content Rewards link submission under user control until a supported official API exists.
- Record submission acknowledgement only when the Content Rewards UI itself confirms it.

**Pass condition:** no false “submitted” status, accurate actual timestamps, and a clear reminder before the platform's stated submission window ends.

### Phase E — Review and earnings evidence
- Track brand review status only from a real Content Rewards status/notification or user-supplied evidence.
- Capture approved/rejected status, views, payout and payout date only when visible in official account records.
- Separate projected earnings from confirmed earnings; never calculate a promised payout from public CPM alone.

**Pass condition:** each status and amount is source-backed, timestamped and traceable.

## 6. Explicitly out of scope / not honestly automatable today

- Automated Content Rewards Join/Apply, private creator eligibility or hidden requirement access without the user's authenticated action.
- Automated Content Rewards link submission, approval decisions or payout confirmation without an official supported integration.
- Bypassing access controls or using an unofficial/private endpoint as if it were supported.
- Guaranteeing notifications while the Android browser/PWA is closed or suspended.
- Claiming that this app's YouTube/Meta OAuth connection verifies accounts inside Content Rewards.

## 7. Definition of done

The project is not “100% complete” merely because CI passes. Completion requires: a successfully deployed and opened app; recent official scan with source-integrity audit; correct current/historical separation; zero unsupported platform claims; working preliminary draft exports with permanent warnings; an unlocked full-brief test; verified provider account status; accurate 30-minute timing; and source-backed submission/review/payout state. Any unavailable platform capability must remain labelled **not supported / requires user action**, not green.
