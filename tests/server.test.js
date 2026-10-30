"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer, getListenConfig } = require("../server.js");

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

test("development server defaults to loopback and the standard port", () => {
  assert.deepEqual(getListenConfig({}), { host: "127.0.0.1", port: 3000 });
});

test("production server binds to all interfaces for container hosting", () => {
  assert.deepEqual(
    getListenConfig({ NODE_ENV: "production", PORT: "8080" }),
    { host: "0.0.0.0", port: 8080 }
  );
});

test("explicit HOST overrides the production default", () => {
  assert.deepEqual(
    getListenConfig({ NODE_ENV: "production", HOST: "127.0.0.1", PORT: "4000" }),
    { host: "127.0.0.1", port: 4000 }
  );
});

test("rejects invalid ports and host strings before listening", () => {
  for (const PORT of ["0", "65536", "not-a-port"]) {
    assert.throws(() => getListenConfig({ PORT }), /PORT must be an integer/);
  }
  for (const HOST of ["bad host", "https://example.com/path", "/tmp/socket"]) {
    assert.throws(() => getListenConfig({ HOST }), /HOST must be a hostname or IP address/);
  }
});

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
