"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { runScheduledScan, decodeHtmlEntities, extractVisibleText, fetchPublicCampaignPage, fetchCampaignDetails } = require("../scripts/content-rewards-discovery-scan.js");

function sample(id) {
  return {
    id, title: "Campaign " + id, brand: "Sample brand",
    payouts: [{ platform: "Instagram", ratePerKViews: 2.5, minViewsRequired: 1000, maxPayoutPerSubmission: 50 }],
    ageDays: 1, freshness: "recent", officialUrl: "https://contentrewards.com/c/campaigns/" + id,
    source: "Third-party scraped snapshot"
  };
}

test("scheduled scan writes a schema-versioned snapshot and deduplicates new campaign rows", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clipreward-cron-"));
  const filePath = path.join(directory, "snapshot.json");
  try {
    const result = await runScheduledScan({
      filePath,
      now: Date.parse("2026-10-31T00:00:00Z"),
      feed: { fetchCampaigns: async () => ({
        campaigns: [sample("one"), sample("one"), sample("two")],
        totalReceived: 3,
        fetchedAt: "2026-10-31T00:00:00.000Z",
        sourceLabel: "Third-party public snapshot",
        sourceUrl: "https://contentrewards.xyz/api/cr/campaigns"
      }) }
    });
    assert.equal(result.ok, true);
    assert.equal(result.snapshot.schemaVersion, 1);
    assert.equal(result.snapshot.campaigns.length, 2);
    assert.equal(result.snapshot.lastScan.status, "success");
    assert.equal(result.snapshot.lastScan.newCount, 2);
    assert.equal(JSON.parse(await fs.readFile(filePath, "utf8")).campaigns.length, 2);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("failed scheduled scan retains prior campaign results and publishes a failure record", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clipreward-cron-"));
  const filePath = path.join(directory, "snapshot.json");
  const previous = {
    schemaVersion: 1, generatedAt: "2026-10-30T00:00:00Z",
    source: { id: "contentrewards-snapshot", verification: "third-party", url: "", label: "Public snapshot" },
    totalReceived: 1, campaigns: [sample("kept")], scans: [], lastScan: { status: "success" }
  };
  try {
    await fs.writeFile(filePath, JSON.stringify(previous), "utf8");
    const result = await runScheduledScan({
      filePath,
      now: Date.parse("2026-10-31T00:00:00Z"),
      feed: { fetchCampaigns: async () => { throw new Error("upstream unavailable"); } }
    });
    assert.equal(result.ok, false);
    assert.equal(result.snapshot.campaigns[0].id, "kept");
    assert.equal(result.snapshot.lastScan.status, "failed");
    assert.match(result.snapshot.lastScan.error, /upstream unavailable/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("scheduled scan refuses to overwrite a malformed existing snapshot", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clipreward-cron-"));
  const filePath = path.join(directory, "snapshot.json");
  try {
    await fs.writeFile(filePath, "{bad", "utf8");
    const result = await runScheduledScan({ filePath, feed: { fetchCampaigns: async () => ({ campaigns: [] }) } });
    assert.equal(result.ok, false);
    assert.match(result.error, /could not be read/i);
    assert.equal(await fs.readFile(filePath, "utf8"), "{bad");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("GitHub scheduled workflow writes no credentials and redeploys the static snapshot", async () => {
  const fs = require("node:fs");
  const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "scheduled-content-rewards-discovery.yml"), "utf8");
  assert.match(workflow, /schedule:/);
  assert.ok(workflow.includes('cron: "17 */6 * * *"'));
  assert.match(workflow, /contents: write/);
  assert.ok(workflow.includes("uses: actions/deploy-pages@v5"));
  assert.match(workflow, /git push origin HEAD:main/);
  assert.match(workflow, /continue-on-error: true/);
});

const PUBLIC_HTML = `<!doctype html><html><body>
<nav>Discover My work Analytics Settings</nav>
<main>
  <h1>Public Campaign: Seasonal Creator Clips</h1>
  <p>Get paid for original short videos and use only licensed audio.</p>
  <div>Accepting clips</div>
  <div>Instagram</div>
  <div>CPM</div>
  <div>Per 1K views</div>
  <div>$2.50</div>
  <div>Min payout</div><div>$5.00</div>
  <div>Max payout</div><div>$125.00</div>
  <div>Budget</div><div>$250 / $2,000</div>
  <div>Minimum 5K views</div>
  <div>Minimum 1K followers</div>
  <div>Deadline: December 20, 2026</div>
  <div>Join Campaign</div>
  <div>Join to unlock 2 requirements and 1 file</div>
</main>
<script>const privateToken = "must-not-be-indexed";</script>
</body></html>`;

test("HTML extraction reads visible main content, decodes entities and excludes navigation/scripts", () => {
  assert.equal(decodeHtmlEntities("A &amp; B &#36; &#x20B9; &nbsp;"), "A & B $ ₹  ");
  const visible = extractVisibleText(PUBLIC_HTML);
  assert.match(visible, /Seasonal Creator Clips/);
  assert.match(visible, /Budget/);
  assert.doesNotMatch(visible, /must-not-be-indexed|Discover My work Analytics/);
});

test("direct public page fetch is restricted to Content Rewards HTTPS campaign pages", async () => {
  let requested;
  const url = "https://contentrewards.com/c/campaigns/direct-test";
  const detail = await fetchPublicCampaignPage(url, {
    now: Date.parse("2026-10-31T00:00:00Z"),
    fetchImpl: async (input, options) => {
      requested = { input, options };
      return {
        ok: true, status: 200, url,
        headers: { get: (name) => name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : "" },
        text: async () => PUBLIC_HTML
      };
    }
  });
  assert.equal(requested.input, url);
  assert.equal(requested.options.method, "GET");
  assert.equal(requested.options.credentials, "omit");
  assert.equal(requested.options.redirect, "follow");
  assert.equal(detail.status, "ok");
  assert.equal(detail.pageTitle, "Public Campaign: Seasonal Creator Clips");
  assert.equal(detail.detected.rate.model, "CPM");
  assert.equal(detail.detected.rate.amount.value, 2.5);
  assert.equal(detail.detected.budget.remaining.value, 1750);
  assert.equal(detail.detected.minimumViews, 5000);
  assert.equal(detail.detected.minimumFollowers, 1000);
  assert.equal(detail.detected.hiddenRequirements.locked, true);
  assert.doesNotMatch(detail.pageText, /must-not-be-indexed/);
  await assert.rejects(fetchPublicCampaignPage("https://evil.example/c/campaigns/x"), /Only public HTTPS Content Rewards/);
});

test("direct public page fetch rejects redirects outside Content Rewards and non-HTML responses", async () => {
  const url = "https://contentrewards.com/c/campaigns/safe";
  await assert.rejects(fetchPublicCampaignPage(url, {
    fetchImpl: async () => ({ ok: true, status: 200, url: "https://evil.example/c/campaigns/safe", headers: { get: () => "text/html" }, text: async () => PUBLIC_HTML })
  }), /redirected outside/);
  await assert.rejects(fetchPublicCampaignPage(url, {
    fetchImpl: async () => ({ ok: true, status: 200, url, headers: { get: () => "application/json" }, text: async () => "{}" })
  }), /did not return an HTML/);
});

test("detail crawler caps concurrency, stores public page text and preserves old detail on fetch errors", async () => {
  let running = 0;
  let maxRunning = 0;
  const urls = ["one", "two", "three", "four"].map((id) => ({
    officialUrl: "https://contentrewards.com/c/campaigns/" + id
  }));
  const fetched = await fetchCampaignDetails(urls, {
    concurrency: 2,
    now: Date.parse("2026-10-31T00:00:00Z"),
    fetchImpl: async (url) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setImmediate(resolve));
      running -= 1;
      if (url.endsWith("/two")) throw new Error("temporary block");
      return { ok: true, status: 200, url, headers: { get: () => "text/html" }, text: async () => PUBLIC_HTML };
    }
  });
  assert.equal(maxRunning, 2);
  assert.equal(fetched.attempted, 4);
  assert.equal(fetched.available, 3);
  assert.equal(fetched.failed, 1);
  const prior = fetched.details.find((row) => row.url.endsWith("/two"));
  assert.equal(prior.status, "unavailable");

  const refreshed = await fetchCampaignDetails(urls.slice(1, 2), {
    previous: [fetched.details.find((row) => row.url.endsWith("/two"))],
    fetchImpl: async () => { throw new Error("still blocked"); }
  });
  assert.equal(refreshed.details[0].status, "unavailable");
  assert.match(refreshed.details[0].lastError, /still blocked/);
});

test("scheduled scan publishes campaign detail pages beside lead metadata", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clipreward-cron-details-"));
  const filePath = path.join(directory, "snapshot.json");
  try {
    const result = await runScheduledScan({
      filePath,
      now: Date.parse("2026-10-31T00:00:00Z"),
      detailLimit: 2,
      feed: { fetchCampaigns: async () => ({
        campaigns: [sample("one")], totalReceived: 1,
        fetchedAt: "2026-10-31T00:00:00.000Z",
        sourceLabel: "Third-party public snapshot", sourceUrl: "https://contentrewards.xyz/api/cr/campaigns"
      }) },
      fetchPageImpl: async (url) => ({
        ok: true, status: 200, url,
        headers: { get: () => "text/html" },
        text: async () => PUBLIC_HTML
      })
    });
    assert.equal(result.ok, true);
    assert.equal(result.snapshot.campaignDetails.length, 1);
    assert.equal(result.snapshot.campaignDetails[0].status, "ok");
    assert.equal(result.snapshot.lastScan.detailPagesAvailable, 1);
    assert.equal(result.snapshot.campaignDetails[0].detected.rate.amount.value, 2.5);
    assert.equal(JSON.parse(await fs.readFile(filePath, "utf8")).campaignDetails.length, 1);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
