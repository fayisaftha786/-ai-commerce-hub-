"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const monitor = require("../scripts/creator-program-discovery");

function html(title, description) {
  return "<!doctype html><html><head><title>" + title +
    "</title><meta name='description' content=\"" + description +
    "\"></head><body><main>Official help page</main></body></html>";
}

function response(url, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    url: options.finalUrl || url,
    headers: { get(name) {
      if (name === "content-type") return options.contentType || "text/html; charset=utf-8";
      if (name === "content-length") return String(options.contentLength || 200);
      return null;
    } },
    async text() { return options.body == null ? html("Official help", "Eligibility information") : options.body; }
  };
}

test("source registry contains only HTTPS public documentation on approved official hosts", () => {
  assert.equal(monitor.SOURCE_REGISTRY.length, 4);
  for (const source of monitor.SOURCE_REGISTRY) {
    assert.equal(monitor.isApprovedSourceUrl(source.sourceUrl), true, source.sourceUrl);
    assert.ok(source.accountCheck);
    assert.ok(source.limitation);
  }
  assert.equal(monitor.isApprovedSourceUrl("http://about.fb.com/"), false);
  assert.equal(monitor.isApprovedSourceUrl("https://about.fb.com.evil.example/"), false);
  assert.equal(monitor.isApprovedSourceUrl("https://user:pass@about.fb.com/"), false);
});

test("extracts page title and description safely from official HTML", () => {
  assert.deepEqual(monitor.extractPageMetadata(html("Creator &amp; Partner", "India&#39;s creator guide")), {
    pageTitle: "Creator & Partner",
    pageDescription: "India's creator guide"
  });
});

test("all successful source checks create a success snapshot without claiming account eligibility", async () => {
  const snapshot = await monitor.scanSources({
    now: Date.parse("2026-11-01T00:00:00.000Z"),
    fetchImpl: async (url) => response(url, { body: html("Official source", "Policy and eligibility guide") })
  });
  assert.equal(snapshot.status, "success");
  assert.deepEqual(snapshot.summary, {
    sourcesAttempted: 4, sourcesAvailable: 4, sourcesUnavailable: 0,
    sourcesWithRuleEvidence: 0, ruleEvidenceCount: 0,
    accountEligibilityChecksRequired: 4
  });
  assert.ok(snapshot.sources.every((source) => source.status === "available"));
  assert.ok(snapshot.sources.every((source) => source.pageTitle === "Official source"));
  assert.ok(snapshot.sources.every((source) => source.accountCheck));
  assert.ok(snapshot.limitations.some((line) => /does not sign in/i.test(line)));
});

test("one failed provider source marks the scan partial and preserves the other results", async () => {
  const snapshot = await monitor.scanSources({
    now: Date.parse("2026-11-01T00:00:00.000Z"),
    fetchImpl: async (url) => url.includes("about.fb.com/news/2026")
      ? response(url, { ok: false, status: 503 })
      : response(url)
  });
  assert.equal(snapshot.status, "partial");
  assert.equal(snapshot.summary.sourcesAvailable, 3);
  assert.equal(snapshot.summary.sourcesUnavailable, 1);
  assert.equal(snapshot.sources.find((source) => source.id === "facebook-content-monetization").status, "unavailable");
});

test("a source that redirects outside the allowlist is rejected", async () => {
  const source = monitor.SOURCE_REGISTRY[0];
  const result = await monitor.checkSource(source, {
    fetchImpl: async (url) => response(url, { finalUrl: "https://evil.example/copy" })
  });
  assert.equal(result.status, "unavailable");
  assert.match(result.error, /redirected outside/i);
  assert.equal(result.pageTitle, "");
});

test("unexpected content types and oversized responses are rejected", async () => {
  const source = monitor.SOURCE_REGISTRY[0];
  const wrongType = await monitor.checkSource(source, {
    fetchImpl: async (url) => response(url, { contentType: "application/json" })
  });
  assert.match(wrongType.error, /content type/i);
  const tooLarge = await monitor.checkSource(source, {
    fetchImpl: async (url) => response(url, { contentLength: monitor.MAX_RESPONSE_BYTES + 1 })
  });
  assert.match(tooLarge.error, /2 MB/i);
});

test("writes a complete JSON snapshot to the requested path", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "creator-program-monitor-"));
  const output = path.join(directory, "snapshot.json");
  try {
    const snapshot = await monitor.scanSources({ fetchImpl: async (url) => response(url) });
    assert.equal(monitor.writeSnapshot(snapshot, output), output);
    const stored = JSON.parse(fs.readFileSync(output, "utf8"));
    assert.equal(stored.schemaVersion, 1);
    assert.equal(stored.sources.length, 4);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});


test("extracts full YPP thresholds from visible official text while stripping scripts", () => {
  const page = "<html><body><p>1,000 subscribers with 4,000 qualified public watch hours in the last 12 months, or 1,000 subscribers with 10 million qualified Shorts views in the last 90 days.</p><script>1,000 subscribers with 4,000 qualified public watch hours in the last 12 months</script></body></html>";
  const evidence = monitor.extractRuleEvidence({ id: "youtube-ypp" }, page);
  assert.deepEqual(evidence.map((item) => item.key), ["standard-watch-hours", "standard-shorts-views"]);
  assert.ok(evidence.every((item) => !item.excerpt.includes("<script>")));
  assert.ok(evidence.every((item) => /full YPP/i.test(item.interpretation)));
});

test("keeps expanded YPP thresholds distinct from full ad-revenue eligibility", () => {
  const page = "<html><body>500 subscribers and 3 valid public uploads in the last 90 days, plus 3,000 valid public watch hours in the last 12 months.</body></html>";
  const evidence = monitor.extractRuleEvidence({ id: "youtube-expanded-ypp" }, page);
  assert.deepEqual(evidence.map((item) => item.key), ["expanded-ypp-watch-hours"]);
  assert.match(evidence[0].interpretation, /not the full ad-revenue threshold/i);
});

test("extracts Facebook invitation and Fast Track facts without converting them into a user payout promise", () => {
  const page = "<html><body>Facebook Content Monetization is invite-only. In the Professional Dashboard, complete the interest form. Creator Fast Track creators can earn $1,000 per month if they have at least 100,000 followers on Instagram, TikTok, or YouTube.</body></html>";
  const evidence = monitor.extractRuleEvidence({ id: "facebook-content-monetization" }, page);
  assert.deepEqual(evidence.map((item) => item.key), ["facebook-invite-only", "facebook-interest-form", "creator-fast-track-100k"]);
  assert.ok(evidence.every((item) => /not a general Facebook monetization rate|not an invitation/i.test(item.interpretation)));
});

test("records Instagram's historical India rollout and creator dashboard path as public evidence only", () => {
  const page = "<html><body>We plan to invite creators and brands based in Canada, Australia, India and Brazil. Creators join from their Professional Dashboard. See your Partnership Messages folder.</body></html>";
  const evidence = monitor.extractRuleEvidence({ id: "instagram-creator-marketplace" }, page);
  assert.deepEqual(evidence.map((item) => item.key), ["instagram-india-rollout", "instagram-professional-dashboard", "instagram-partnership-messages"]);
  assert.ok(evidence[0].interpretation.includes("historical rollout"));
});

test("unknown or missing public text produces no inferred eligibility", () => {
  assert.deepEqual(monitor.extractRuleEvidence({ id: "youtube-ypp" }, "<html><body>Welcome</body></html>"), []);
});

test("all-unavailable sources are represented as failed instead of a false success", async () => {
  const snapshot = await monitor.scanSources({
    fetchImpl: async (url) => response(url, { ok: false, status: 502 })
  });
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.summary.sourcesAvailable, 0);
  assert.equal(snapshot.summary.sourcesUnavailable, 4);
});
