"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const appHealth = fs.readFileSync(path.join(root, "app-health.js"), "utf8");
const catalog = fs.readFileSync(path.join(root, "catalog-import.js"), "utf8");

test("every direct app event-listener target exists in the HTML", () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const targets = [...app.matchAll(/\$\("([^"]+)"\)\.addEventListener\(/g)].map((match) => match[1]);
  assert.ok(targets.length > 0, "expected app event listeners");
  assert.deepEqual([...new Set(targets.filter((id) => !ids.has(id)))], []);
});

test("catalog import UI explains source and freshness fields required for shortlist readiness", () => {
  assert.match(html, /name, platform, url, price, commission, rating, reviews, clicks, orders, returns, period_days, stock, source, checked_at/);
  assert.match(html, /<code>source<\/code>/);
  assert.match(html, /<code>checked_at<\/code> \(YYYY-MM-DD\)/);
  assert.match(html, /Evidence older than 7 days/);
  assert.match(app, /checked_at\\n/);
});

test("catalog importer is loaded exactly once before app.js", () => {
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(scripts.filter((src) => src === "catalog-import.js").length, 1);
  assert.ok(scripts.indexOf("catalog-import.js") < scripts.indexOf("app.js"));
});


test("imported catalog products can be transferred to Content Studio without stale claims", () => {
  assert.match(app, /contentButton\.textContent = "Use in Content Studio"/);
  assert.match(app, /contentButton\.addEventListener\("click", \(\) => useCatalogProductInContent\(record\)\)/);
  assert.match(app, /\$\("contentName"\)\.value = record\.name/);
  assert.match(app, /\$\("contentBenefit"\)\.value = ""/);
  assert.match(app, /\$\("contentProof"\)\.value = ""/);
});


test("campaign registry controls exist and are wired to local campaign storage and CSV export", () => {
  for (const id of ["saveContentCampaign", "exportCampaigns", "campaignList", "campaignMessage"]) {
    assert.ok(html.includes('id="' + id + '"'), "missing campaign UI id: " + id);
  }
  assert.ok(app.includes('const CAMPAIGN_KEY = "ai-commerce-hub.campaigns.v1"'));
  assert.ok(app.includes("campaigns.push(campaign)"));
  assert.ok(app.includes("campaign_id"));
  assert.ok(html.includes("does not track external clicks"));
  assert.ok(app.includes('parsed.protocol === "https:"'));
});

test("saved product cards provide a one-click Content Studio handoff without stale claims", () => {
  assert.match(app, /contentButton\.textContent = "Create content"/);
  assert.match(app, /useCatalogProductInContent\(\{\s*name: product\.name \|\| ""/);
  assert.match(app, /evidenceFreshness: "unknown"/);
  assert.match(app, /checkedAt: ""/);
  assert.match(app, /body\.append\(platform, title, link, contentButton, videoButton, scoreButton\)/);
  assert.match(app, /function useCatalogProductInContent\(record\)/);
  assert.match(app, /\$\("contentBenefit"\)\.value = ""/);
  assert.match(app, /\$\("contentProof"\)\.value = ""/);
});

test("product workspace blocks duplicate links on the same marketplace before saving", () => {
  assert.match(app, /const duplicate = products\.some\(\(saved\) =>/);
  assert.match(app, /saved\.platform === result\.product\.platform && saved\.url === result\.product\.url/);
  assert.match(app, /if \(duplicate\) \{/);
  assert.match(app, /This product link is already saved for /);
  assert.ok(app.indexOf("if (duplicate)") < app.indexOf("products.push(result.product)"));
});

test("campaign records reject unsafe stored URLs and require a parseable timestamp", () => {
  assert.match(app, /function safeCampaignUrl\(value\)/);
  assert.match(app, /parsed\.protocol === "https:" && parsed\.hostname && !parsed\.username && !parsed\.password/);
  assert.match(app, /link\.href = safeLink/);
  assert.match(app, /Number\.isFinite\(Date\.parse\(item\.createdAt\)\)/);
  assert.match(html, /not sales analytics/);
});

test("full workspace backup includes Earning Hub records", () => {
  const keys = [
    "ai-commerce-hub.earning-opportunities.v1",
    "ai-commerce-hub.earning-tasks.v1",
    "ai-commerce-hub.earning-records.v1"
  ];
  const backupKeys = app.slice(app.indexOf("const BACKUP_KEYS"), app.indexOf("const MAX_BACKUP_BYTES"));
  const backupExport = app.slice(app.indexOf("function exportWorkspaceBackup"), app.indexOf("function validateBackup"));
  for (const key of keys) assert.ok(backupKeys.includes('"' + key + '"'), "backup must include " + key);
  assert.ok(app.includes("function exportWorkspaceBackup()"));
  assert.ok(app.includes("function validateBackup(payload)"));
  assert.match(html, /Earning opportunities, task plans and earnings records are included in Full Workspace Backup & Restore/);
  assert.doesNotMatch(html, /until backup schema support is added/i);
});

test("workspace backup and restore controls are present and validated", () => {
  assert.ok(html.includes('id="exportWorkspaceBackup"'));
  assert.ok(html.includes('id="importWorkspaceBackup"'));
  assert.ok(html.includes('id="backupMessage"'));
  assert.match(app, /format: "ai-commerce-hub-backup", version: 1/);
  assert.ok(app.includes("function validateBackup(payload)"));
  assert.match(app, /MAX_BACKUP_BYTES = 2 \* 1024 \* 1024/);
  assert.match(app, /window\.confirm\("Restore this backup\?/);
  assert.match(app, /best-effort rollback/);
  assert.ok(app.includes("function exportWorkspaceBackup()"));
  assert.match(backupExport, /anchor\.click\(\);[\s\S]*anchor\.remove\(\);[\s\S]*setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 1000\)/);
  assert.doesNotMatch(backupExport, /URL\.revokeObjectURL\(url\);/);
});

test("workspace backup validates each dataset before replacing browser storage", () => {
  assert.match(app, /products\.length > MAX_PRODUCTS/);
  assert.match(app, /productValidator\(item\)\.valid/);
  assert.match(app, /campaignIds\.has\(item\.id\)/);
  assert.match(app, /campaignRecords\.length > MAX_CAMPAIGNS/);
  assert.match(app, /candidateRecords\.length > 50/);
  assert.match(app, /item\.score < 0 \|\| item\.score > 100/);
  assert.match(app, /catalogRecords\.length > 5000/);
  assert.match(app, /item\.recommendationReasons\.some/);
  assert.match(app, /invalid\("contains an invalid or duplicate campaign record"\)/);
  assert.match(app, /invalid\("contains an invalid ranked catalogue record"\)/);
});


test("saved candidate shortlist uses readiness-first sorting", () => {
  assert.match(app, /compareCandidatesByReadiness/);
  assert.match(app, /\.sort\(typeof compareCandidates === "function" \? compareCandidates/);
});


test("shortlist removal targets the exact candidate and restores it when storage save fails", () => {
  assert.match(app, /const index = candidates\.indexOf\(candidate\)/);
  assert.match(app, /candidates\.splice\(index, 1\);\s*const saved = saveCandidates\(\);\s*if \(!saved\) candidates\.splice\(index, 0, candidate\)/);
  assert.match(app, /Candidate removed and saved on this device/);
  assert.match(app, /The shortlist was restored; try again after freeing storage space/);
  assert.match(app, /\$\("candidateResult"\)\.textContent = saved/);
});

test("saved candidate cards explain evidence coverage and handle older records", () => {
  assert.match(app, /Evidence coverage:/);
  assert.match(app, /candidate\.evidenceCoverage/);
  assert.match(app, /Evidence coverage unavailable for this older saved record/);
  assert.match(app, /card\.append\(title, details, provenance, evidence\)/);
  assert.match(app, /card\.append\(recheckButton, contentButton, remove\)/);
});


test("content pack download control exists and exports generated text safely", () => {
  assert.ok(html.includes('id="downloadContent"'));
  assert.match(app, /\$\("downloadContent"\)\.addEventListener\("click"/);
  assert.match(app, /new Blob\(\[output \+ "\\n"\], \{ type: "text\/plain;charset=utf-8" \}\)/);
  assert.match(app, /anchor\.download = "ai-commerce-" \+ safeName \+ "\.txt"/);
  assert.match(app, /replace\(\/\[\^a-zA-Z0-9_-\]\+\/g, "-"/);
  assert.match(app, /Create a post or video plan before downloading/);
});

test("saved campaigns expose a confirmed delete action and preserve records if storage save fails", () => {
  assert.match(app, /deleteButton\.textContent = "Delete campaign"/);
  assert.match(app, /window\.confirm\("Delete this campaign record\?/);
  assert.match(app, /campaigns\.splice\(index, 1\)/);
  assert.match(app, /if \(!saved\) \{\s*campaigns\.splice\(index, 0, campaign\)/);
  assert.match(app, /Campaign record deleted from this device/);
});

test("campaign register search filters by product, platform, format, and campaign ID", () => {
  assert.ok(html.includes('id="campaignSearch"'));
  assert.match(app, /\$\("campaignSearch"\)\.addEventListener\("input", renderCampaigns\)/);
  assert.match(app, /\[campaign\.productName, campaign\.platform, campaign\.format, campaign\.id\]/);
  assert.match(app, /No campaigns match this search/);
});

test("campaign register CSV import validates the exported schema and protects existing records", () => {
  assert.ok(html.includes('id="importCampaignsCsv"'));
  assert.ok(html.includes('id="importCampaigns"'));
  assert.match(app, /function parseCampaignCsv\(text\)/);
  assert.match(app, /CSV columns do not match the exported campaign register format/);
  assert.match(app, /file\.size > 1024 \* 1024/);
  assert.match(app, /const duplicates = parsed\.records\.length - unique\.length/);
  assert.match(app, /Existing records will be kept/);
  assert.match(app, /Import could not be saved to browser storage\. Existing records were preserved/);
  assert.match(app, /safeCampaignUrl\(link\.trim\(\)\)/);
});

test("saved campaign cards offer a copy action only for validated affiliate links", () => {
  assert.match(app, /copyLinkButton\.textContent = "Copy affiliate link"/);
  assert.match(app, /navigator\.clipboard\.writeText\(safeLink\)/);
  assert.match(app, /safeCampaignUrl\(campaign\.link\)/);
  assert.match(app, /Clipboard unavailable\. Open the saved affiliate link and copy its address manually/);
});


test("CSV exports neutralize formula-like cells before quoting", () => {
  assert.match(app, /function csvCell\(value\)/);
  assert.match(app, /\^\[\\u0000-\\u0020\]\*\[=\+\\-@\]/);
  assert.match(app, /text = "'" \+ text/);
  assert.match(app, /text\.replace\(\/"\/g, '""'\)/);
});


test("Content Studio includes an honest pre-publish review checklist", () => {
  for (const id of ["reviewClaims", "reviewPrice", "reviewAffiliate", "reviewLink", "contentReviewStatus"]) {
    assert.ok(html.includes('id="' + id + '"'));
  }
  assert.match(app, /function contentReviewComplete\(\)/);
  assert.match(app, /Checklist marked complete by you\. This does not independently verify claims, prices or links/);
  assert.match(app, /Review all four items before copying, downloading, or saving this draft/);
});

test("Content Studio requires all four review checks before copy, download, or campaign save", () => {
  assert.match(app, /function requireContentReview\(action\)/);
  assert.match(app, /CONTENT_REVIEW_IDS\.find\(\(id\) => !\$\(id\)\.checked\)/);
  assert.match(app, /if \(!requireContentReview\("copy this content"\)\) return/);
  assert.match(app, /if \(!requireContentReview\("download this content"\)\) return/);
  assert.match(app, /if \(!requireContentReview\("save this campaign"\)\)/);
  assert.match(html, /All four items must be reviewed and checked before copying, downloading, or saving this draft/);
});

test("Content Studio resets review whenever a draft or its inputs change", () => {
  assert.match(app, /function resetContentReview\(message\)/);
  assert.match(app, /function invalidateContentDraftOnInput\(\)/);
  assert.match(app, /\$\("contentForm"\)\.addEventListener\("input", invalidateContentDraftOnInput\)/);
  assert.match(app, /\$\("contentForm"\)\.addEventListener\("change", invalidateContentDraftOnInput\)/);
  assert.match(app, /\$\("contentOutput"\)\.addEventListener\("input"/);
  assert.match(app, /New draft created\. Review all claims/);
  assert.match(app, /Draft text changed\. Review the full edited draft/);
  assert.match(app, /Content inputs changed\. Generate a fresh draft/);
  assert.match(app, /Product selection changed\. Generate a fresh draft/);
  assert.match(app, /\$\(id\)\.checked = false/);
  assert.match(app, /\$\("contentOutput"\)\.value = ""/);
});


test("product discovery does not prefill demand or competition as if they were verified", () => {
  assert.match(html, /<select id="candidateDemand"><option value="" selected>Not checked yet<\/option>/);
  assert.match(html, /<select id="candidateCompetition"><option value="" selected>Not checked yet<\/option>/);
  assert.doesNotMatch(html, /id="candidateDemand"[\s\S]{0,300}value="3" selected/);
  assert.doesNotMatch(html, /id="candidateCompetition"[\s\S]{0,300}value="3" selected/);
  assert.match(html, /Demand and competition and stock status start as “Not checked yet”/);
  assert.match(html, /<select id="candidateStock">[\s\S]{0,100}<option value="" selected>Not checked yet/);
});


test("ranked catalog report export has a button and uses the safe CSV exporter", () => {
  assert.ok(html.includes('id="exportCatalogReport"'));
  assert.match(app, /function exportRankedCatalogReport\(\)/);
  assert.match(app, /catalogRecordsToCsv/);
  assert.match(app, /ai-commerce-hub-ranked-catalog-report\.csv/);
});


test("catalog import UI states the link and commission prerequisites for shortlisting", () => {
  assert.match(html, /valid HTTPS product\/approved affiliate link/);
  assert.match(html, /positive confirmed commission rate/);
  assert.match(catalog, /Affiliate commission is missing or not confirmed/);
});


test("manual product discovery captures link, source, checked date, and explicit stock state", () => {
  for (const id of ["candidateUrl", "candidateSource", "candidateCheckedAt", "candidateStock"]) {
    assert.ok(html.includes('id="' + id + '"'), "missing manual evidence control: " + id);
  }
  assert.match(app, /\$\("candidateUrl"\)\.value/);
  assert.match(app, /\$\("candidateSource"\)\.value/);
  assert.match(app, /\$\("candidateCheckedAt"\)\.value/);
  assert.match(app, /\$\("candidateStock"\)\.value === "yes" \? true/);
  assert.match(app, /Evidence freshness:/);
  assert.match(app, /confirmed in stock/);
});


test("manual discovery results and saved candidates can be handed to Content Studio safely", () => {
  assert.match(app, /function useCandidateInContent\(candidate\)/);
  assert.match(app, /useCatalogProductInContent\(\{/);
  assert.match(app, /const contentButton = document\.createElement\("button"\)/);
  assert.match(app, /contentButton\.textContent = "Use in Content Studio"/);
  assert.match(app, /contentButton\.addEventListener\("click", \(\) => useCandidateInContent\(candidate\)\)/);
  assert.match(app, /contentButton\.addEventListener\("click", \(\) => useCandidateInContent\(result\.candidate\)\)/);
  assert.match(app, /url: safeCampaignUrl\(candidate\.url\)/);
  assert.match(app, /\$\("contentBenefit"\)\.value = ""/);
  assert.match(app, /Product selection changed\. Generate a fresh draft/);
});


test("workflow section numbers run sequentially without duplicates", () => {
  const numbers = [...html.matchAll(/<h2\b[^>]*>(\d+)\./g)].map((match) => Number(match[1]));
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});


test("manual candidate shortlist exports evidence, confidence and safety checks as CSV", () => {
  assert.ok(html.includes('id="exportCandidatesCsv"'));
  assert.ok(html.includes('id="candidateExportStatus"'));
  assert.match(app, /function exportCandidateShortlistCsv\(\)/);
  assert.match(app, /ai-commerce-hub-product-shortlist\.csv/);
  assert.match(app, /const csv = "\\uFEFF" \+ lines\.join\("\\r\\n"\) \+ "\\r\\n"/);
  assert.match(app, /columns\.map\(\(\[, value\]\) => csvCell\(value\(candidate, index\)\)\)/);
  assert.match(app, /evidence_traceable/);
  assert.match(app, /checks_and_warnings/);
  assert.match(app, /\$\("exportCandidatesCsv"\)\.disabled = candidates\.length === 0/);
});


test("App Self-Check panel loads its diagnostic script and labels external integrations honestly", () => {
  assert.ok(html.includes('id="runAppHealthCheck"'));
  assert.ok(html.includes('id="appHealthSummary"'));
  assert.ok(html.includes('id="appHealthResults"'));
  assert.match(html, /<script src="app-health\.js"><\/script>/);
  assert.match(appHealth, /function collectEnvironmentChecks\(environment\)/);
  assert.match(appHealth, /Browser storage/);
  assert.match(appHealth, /Secure browser context/);
  assert.match(appHealth, /External integrations/);
  assert.match(appHealth, /Live marketplace data APIs, a live AI text API, and automatic social publishing are not connected/);
});


test("product workspace supports safe optional image URLs and premium image cards", () => {
  assert.ok(html.includes('id="productImageUrl"'));
  assert.match(app, /imageUrl: \$\("productImageUrl"\)\.value/);
  assert.match(app, /className = "product-media"/);
  assert.match(app, /className = "product-image-fallback"/);
  assert.match(app, /image\.addEventListener\("error", \(\) => image\.remove\(\)\)/);
  assert.match(app, /image\.addEventListener\("load", \(\) => fallback\.remove\(\)\)/);
  assert.match(css, /\.product-grid/);
});


test("saved products can prefill the scoring form without inventing evidence", () => {
  assert.match(app, /scoreButton\.textContent = "Score this product"/);
  assert.match(app, /\$\("candidateName"\)\.value = product\.name \|\| ""/);
  assert.match(app, /\$\("candidateUrl"\)\.value = product\.url \|\| ""/);
  assert.match(app, /\$\("candidateSource"\)\.value = ""/);
  assert.match(app, /\$\("candidateCheckedAt"\)\.value = ""/);
  assert.match(app, /A saved product link is not proof of current price, commission, stock or demand/);
  assert.match(app, /\$\("candidateForm"\)\.scrollIntoView/);
});

test("saved product cards offer a video-maker handoff without inventing product claims", () => {
  assert.match(app, /videoButton\.textContent = "Make a video"/);
  assert.match(app, /commerce:prepare-video/);
  assert.match(app, /imageUrl: product\.imageUrl \|\| ""/);
  assert.match(html, /id="videoMakerImageUrl"/);
  assert.match(app, /\$\("videoMakerForm"\)\.scrollIntoView/);
});


test("bulk Content Studio has a bounded tab-separated input and reuses the reviewed export gate", () => {
  for (const id of ["bulkContentRows", "generateBulkContent", "bulkContentStatus"]) {
    assert.ok(html.includes('id="' + id + '"'), "missing bulk content UI id: " + id);
  }
  assert.match(app, /function parseBulkContentRows\(text\)/);
  assert.match(app, /lines\.length > 50/);
  assert.match(app, /engine\.createBulkContentPacks\(rows/);
  assert.match(app, /Bulk batch generated\. Review every product claim/);
  assert.match(app, /function requireContentReview\(action\)/);
  assert.match(html, /tab-separated columns/);
});


test("catalogue-to-content handoff carries evidence guardrails and suppresses stale or undated prices", () => {
  assert.ok(html.includes('id="contentEvidenceStatus"'));
  assert.match(app, /function catalogEvidenceSummary\(record\)/);
  assert.match(app, /priceEvidenceIsCurrent = record\.evidenceFreshness === "current" && Boolean\(record\.checkedAt\)/);
  assert.match(app, /price omitted because evidence is stale, future-dated or undated/);
  assert.match(app, /PRODUCT EVIDENCE GUARDRAILS/);
  assert.match(app, /Do not infer stock, discounts, product benefits or guarantees/);
  assert.match(app, /Manual product name entered\. Catalogue evidence context cleared/);
});


test("Content Studio permits conservative draft generation without requiring a product benefit", () => {
  assert.match(html, /id="contentBenefit" maxlength="200" placeholder="Optional: add only a benefit you verified"/);
  assert.doesNotMatch(html, /id="contentBenefit" maxlength="200" required/);
  assert.match(app, /createContentPack\(\{/);
});


test("saved shortlist can restart evidence review without carrying stale product metrics", () => {
  assert.match(app, /recheckButton\.textContent = "Recheck evidence"/);
  assert.match(app, /recheckButton\.addEventListener\("click", \(\) => \{/);
  for (const id of ["candidatePrice", "candidateCommission", "candidateRating", "candidateReviews", "candidateDemand", "candidateCompetition", "candidateStock", "candidateSource", "candidateCheckedAt"]) {
    assert.match(app, new RegExp('\\$\\("' + id + '"\\)\\.value = ""'));
  }
  assert.match(app, /Previous price, commission, rating, reviews, demand, competition, stock, source and date were cleared/);
  assert.match(app, /card\.append\(recheckButton, contentButton, remove\)/);
});


test("marketplace integration panel links only to official programme and API documentation", () => {
  assert.match(html, /Amazon India · Creators API/);
  assert.match(html, /at least 10 qualifying sales in the past 30 days/);
  assert.match(html, /old PA-API 5\.0 has been deprecated/);
  assert.ok(html.includes('href="https://affiliate-program.amazon.in/creatorsapi/docs/en-us/introduction"'));
  assert.match(html, /Flipkart · Affiliate API/);
  assert.match(html, /20 calls per second per affiliate/);
  assert.ok(html.includes('href="https://affiliate.flipkart.com/api-docs/af_prod_ref.html"'));
  assert.match(html, /Meesho · Creator Program/);
  assert.ok(html.includes('href="https://affiliate.meesho.com/influencer-home"'));
  assert.match(html, /does not sign in to the portal or read private creator metrics/);
  assert.match(html, /cannot safely hold marketplace API secrets/);
  assert.match(html, /do not use private endpoints or scrape logged-in pages/);
});
