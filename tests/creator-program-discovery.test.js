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
  assert.equal(monitor.SOURCE_REGISTRY.length, 3);
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
    sourcesAttempted: 3, sourcesAvailable: 3, sourcesUnavailable: 0,
    accountEligibilityChecksRequired: 3
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
  assert.equal(snapshot.summary.sourcesAvailable, 2);
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
    assert.equal(stored.sources.length, 3);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("all-unavailable sources are represented as failed instead of a false success", async () => {
  const snapshot = await monitor.scanSources({
    fetchImpl: async (url) => response(url, { ok: false, status: 502 })
  });
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.summary.sourcesAvailable, 0);
  assert.equal(snapshot.summary.sourcesUnavailable, 3);
});
