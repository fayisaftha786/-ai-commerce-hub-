"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createAssetBackedDiscoveryStore, createCloudflareHandler } = require("../cloudflare/worker-factory.js");

function fakeD1() {
  let state = null;
  return {
    prepare(query) {
      return {
        async first() {
          if (query.includes("SELECT state_json")) return state == null ? null : { state_json: state };
          return null;
        },
        bind(...values) {
          return {
            async first() {
              if (query.includes("SELECT state_json")) return state == null ? null : { state_json: state };
              return null;
            },
            async run() {
              if (query.includes("INSERT INTO discovery_state")) {
                state = values[0];
                return { meta: { changes: 1 } };
              }
              throw new Error("Unexpected fake D1 query");
            }
          };
        }
      };
    },
    get state() { return state; }
  };
}

function fakeR2() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options) { objects.set(key, { value, options }); },
    async get(key) {
      const item = objects.get(key);
      if (!item) return null;
      return {
        customMetadata: item.options.customMetadata,
        httpMetadata: item.options.httpMetadata,
        async arrayBuffer() { return item.value.buffer.slice(item.value.byteOffset, item.value.byteOffset + item.value.byteLength); }
      };
    },
    async delete(key) { objects.delete(key); }
  };
}

test("asset-backed discovery store falls back to the latest static GitHub snapshot before D1 is seeded", async () => {
  const db = fakeD1();
  const snapshot = {
    schemaVersion: 1,
    generatedAt: "2026-11-05T00:00:00.000Z",
    campaigns: [{ id: "public-campaign" }],
    scans: [{ status: "success" }]
  };
  const assets = {
    async fetch(request) {
      assert.match(request.url, /content-rewards-assistant\/discovery-snapshot\.json$/);
      return new Response(JSON.stringify(snapshot), { status: 200 });
    }
  };
  const store = createAssetBackedDiscoveryStore(db, assets);
  assert.deepEqual(await store.readState(), {
    campaigns: snapshot.campaigns,
    scans: snapshot.scans,
    updatedAt: snapshot.generatedAt
  });
  await store.writeState({ campaigns: [{ id: "persisted" }], scans: [], updatedAt: "later" });
  assert.equal((await store.readState()).campaigns[0].id, "persisted");
});

test("Cloudflare worker factory creates the existing Node HTTP app with persistent bindings", async () => {
  const env = {
    DB: fakeD1(),
    MEDIA: fakeR2(),
    ASSETS: { async fetch() { return new Response("{}"); } },
    SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"),
    META_MEDIA_BASE_URL: "https://clipreward.example.workers.dev",
    SOCIAL_CORS_ORIGINS: "https://clipreward.example.workers.dev",
    DISCOVERY_CORS_ORIGINS: "https://clipreward.example.workers.dev",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    META_APP_ID: "",
    META_APP_SECRET: ""
  };
  let captured = null;
  const handler = createCloudflareHandler(env, (server) => {
    captured = server;
    assert.ok(server instanceof http.Server);
    return {
      async fetch(request) {
        assert.equal(request.url, "https://clipreward.example.workers.dev/health");
        return new Response("worker-handler-ready");
      }
    };
  });
  assert.equal(typeof handler.fetch, "function");
  assert.ok(captured);
  const response = await handler.fetch(new Request("https://clipreward.example.workers.dev/health"));
  assert.equal(await response.text(), "worker-handler-ready");
});

test("Cloudflare worker factory fails closed when a persistent binding or token key is absent", () => {
  assert.throws(() => createCloudflareHandler({}, () => async () => new Response("unused")), /bindings DB, MEDIA and ASSETS/i);
  assert.throws(() => createCloudflareHandler({
    DB: fakeD1(), MEDIA: fakeR2(), ASSETS: { async fetch() { return new Response("{}"); } }
  }, () => async () => new Response("unused")), /SOCIAL_TOKEN_ENCRYPTION_KEY/i);
});

