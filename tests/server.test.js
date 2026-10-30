"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("../server.js");

async function withServer(run) {
  const server = createServer({
    env: {
      META_APP_SECRET: "sentinel-meta-secret-value",
      GOOGLE_CLIENT_SECRET: "sentinel-google-secret-value"
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run("http://127.0.0.1:" + address.port);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("health endpoint confirms service status without claiming OAuth works", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/health");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      ok: true,
      service: "ai-commerce-hub-social-api",
      oauthImplemented: false
    });
  });
});

test("provider endpoint returns readiness without leaking credential values", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/social/providers");
    const data = await response.json();
    const serialized = JSON.stringify(data);
    assert.equal(response.status, 200);
    assert.equal(data.providers.length, 3);
    assert.equal(data.providers[0].provider, "instagram");
    assert.equal(data.providers[0].configured, false);
    assert.match(data.note, /OAuth is not implemented/i);
    assert.equal(data.providers[0].configured, false);
    assert.equal(serialized.includes("sentinel-meta-secret-value"), false);
    assert.equal(serialized.includes("sentinel-google-secret-value"), false);
    assert.match(data.note, /no accounts are connected/i);
  });
});

test("rejects non-GET methods", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/health", { method: "POST" });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET");
    assert.deepEqual(await response.json(), { error: "method_not_allowed" });
  });
});

test("returns JSON 404 for unknown routes", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/missing");
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not_found" });
  });
});
