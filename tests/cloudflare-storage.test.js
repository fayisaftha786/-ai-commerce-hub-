"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createD1DiscoveryStore,
  createD1EncryptedTokenVault,
  createD1OAuthStateStore,
  createR2MetaMediaStore
} = require("../cloudflare/storage.js");

function fakeD1() {
  const discovery = { state: null };
  const tokens = new Map();
  const states = new Map();

  function prepare(query) {
    const sql = query.replace(/\s+/g, " ").trim();
    return {
      bind(...values) {
        return {
          async first() {
            if (sql.startsWith("SELECT state_json FROM discovery_state")) {
              return discovery.state == null ? null : { state_json: discovery.state };
            }
            if (sql.startsWith("SELECT encrypted_json FROM social_tokens")) {
              return tokens.get(values[0] + ":" + values[1]) || null;
            }
            if (sql.startsWith("SELECT session_hash FROM social_tokens")) {
              return tokens.has(values[0] + ":youtube") || tokens.has(values[0] + ":meta")
                ? { session_hash: values[0] } : null;
            }
            if (sql.startsWith("SELECT COUNT(DISTINCT session_hash)")) {
              return { count: new Set([...tokens.keys()].map((key) => key.split(":")[0])).size };
            }
            if (sql.startsWith("DELETE FROM oauth_pending_states") && sql.includes("RETURNING")) {
              const [hash, provider, current] = values;
              const record = states.get(hash);
              if (!record || record.provider !== provider || record.expiresAt <= current) return null;
              states.delete(hash);
              return { encrypted_json: record.encryptedJson };
            }
            return null;
          },
          async run() {
            if (sql.startsWith("INSERT INTO discovery_state")) {
              discovery.state = values[0];
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith("INSERT INTO social_tokens")) {
              const key = values[0] + ":" + values[1];
              const existed = tokens.has(key);
              tokens.set(key, { encrypted_json: values[2], updated_at: values[3] });
              return { meta: { changes: existed ? 1 : 1 } };
            }
            if (sql.startsWith("DELETE FROM social_tokens")) {
              const existed = tokens.delete(values[0] + ":" + values[1]);
              return { meta: { changes: existed ? 1 : 0 } };
            }
            if (sql.startsWith("DELETE FROM oauth_pending_states WHERE expires_at")) {
              const current = values[0];
              for (const [hash, record] of states) if (record.expiresAt <= current) states.delete(hash);
              return { meta: { changes: 0 } };
            }
            if (sql.startsWith("INSERT INTO oauth_pending_states")) {
              states.set(values[0], { provider: values[1], encryptedJson: values[2], expiresAt: values[3] });
              return { meta: { changes: 1 } };
            }
            throw new Error("Unexpected fake D1 SQL: " + sql);
          }
        };
      }
    };
  }

  return { prepare, tables: { discovery, tokens, states } };
}

const KEY = Buffer.alloc(32, 9).toString("base64");
const HASH = "a".repeat(64);
const STATE = "b".repeat(43);

test("D1 discovery store persists and normalises bounded public campaign history", async () => {
  const db = fakeD1();
  const store = createD1DiscoveryStore(db);
  assert.deepEqual(await store.readState(), { campaigns: [], scans: [], updatedAt: "" });
  await store.writeState({
    campaigns: Array.from({ length: 520 }, (_, i) => ({ id: String(i) })),
    scans: Array.from({ length: 60 }, (_, i) => ({ id: i })),
    updatedAt: "2026-11-05T00:00:00.000Z"
  });
  const restored = await store.readState();
  assert.equal(restored.campaigns.length, 500);
  assert.equal(restored.scans.length, 50);
  assert.equal(restored.updatedAt, "2026-11-05T00:00:00.000Z");
});

test("D1 token vault encrypts provider records and survives adapter recreation", async () => {
  const db = fakeD1();
  const first = createD1EncryptedTokenVault(db, KEY);
  await first.set(HASH, "youtube", { accessToken: "private-access-token", refreshToken: "private-refresh-token" });
  const saved = db.tables.tokens.get(HASH + ":youtube");
  assert.ok(saved);
  assert.equal(saved.encrypted_json.includes("private-access-token"), false);
  const second = createD1EncryptedTokenVault(db, KEY);
  assert.deepEqual(await second.get(HASH, "youtube"), {
    accessToken: "private-access-token",
    refreshToken: "private-refresh-token"
  });
  assert.equal(await second.deleteProvider(HASH, "youtube"), true);
  assert.equal(await second.get(HASH, "youtube"), null);
  assert.equal(await second.deleteProvider(HASH, "youtube"), false);
});

test("D1 token vault refuses decryption with a different encryption key", async () => {
  const db = fakeD1();
  await createD1EncryptedTokenVault(db, KEY).set(HASH, "meta", { userAccessToken: "secret" });
  const wrongKey = Buffer.alloc(32, 3).toString("base64");
  await assert.rejects(createD1EncryptedTokenVault(db, wrongKey).get(HASH, "meta"), /could not be decrypted/i);
});

test("D1 OAuth state is encrypted, scoped to one provider and consumed exactly once", async () => {
  let current = 1_000;
  const db = fakeD1();
  const store = createD1OAuthStateStore(db, KEY, { now: () => current });
  const payload = { sessionHash: HASH, verifier: "pkce-verifier-secret" };
  await store.put("youtube", STATE, payload, current + 60_000);
  const record = [...db.tables.states.values()][0];
  assert.equal(record.encryptedJson.includes("pkce-verifier-secret"), false);
  assert.equal(await store.consume("meta", STATE), null);
  assert.deepEqual(await store.consume("youtube", STATE), payload);
  assert.equal(await store.consume("youtube", STATE), null);
  await store.put("meta", STATE, { sessionHash: HASH }, current + 5);
  current += 10;
  assert.equal(await store.consume("meta", STATE), null);
});

test("R2 media store retains only allowlisted video media until expiry or disposal", async () => {
  let current = 1000;
  const objects = new Map();
  const bucket = {
    async put(key, value, options) {
      objects.set(key, { value: Buffer.from(value), options });
    },
    async get(key) {
      const entry = objects.get(key);
      if (!entry) return null;
      return {
        customMetadata: entry.options.customMetadata,
        httpMetadata: entry.options.httpMetadata,
        async arrayBuffer() {
          return entry.value.buffer.slice(entry.value.byteOffset, entry.value.byteOffset + entry.value.byteLength);
        }
      };
    },
    async delete(key) { objects.delete(key); }
  };
  const store = createR2MetaMediaStore(bucket, "https://api.example.com", {
    now: () => current,
    ttlMs: 60_000,
    randomBytes: (size) => Buffer.alloc(size, 1)
  });
  const media = await store.create(Buffer.from("video bytes"), "video/mp4");
  const token = media.url.split("/").pop();
  assert.equal((await store.get(token)).mimeType, "video/mp4");
  assert.equal(objects.size, 1);
  await media.dispose();
  await media.dispose();
  assert.equal(objects.size, 0);
  const expiring = await store.create(Buffer.from("video bytes"), "video/quicktime");
  current += 60_001;
  assert.equal(await store.get(expiring.url.split("/").pop()), null);
  await assert.rejects(store.create(Buffer.from("not a video"), "text/plain"), /media type is invalid/i);
});

