"use strict";

const crypto = require("node:crypto");

const DISCOVERY_MAX_BYTES = 1_500_000;
const TOKEN_PROVIDERS = new Set(["youtube", "meta"]);
const STATE_PROVIDERS = new Set(["youtube", "meta"]);
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function requiredD1(value) {
  if (!value || typeof value.prepare !== "function") {
    throw new TypeError("A Cloudflare D1 binding is required.");
  }
  return value;
}

function requiredR2(value) {
  if (!value || typeof value.put !== "function" || typeof value.get !== "function" ||
      typeof value.delete !== "function") {
    throw new TypeError("A Cloudflare R2 bucket binding is required.");
  }
  return value;
}

function parseEncryptionKey(value) {
  const raw = String(value || "").trim();
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("SOCIAL_TOKEN_ENCRYPTION_KEY must be a 32-byte key encoded as 64 hex characters or base64.");
  }
  return key;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function sealJson(value, key, associatedData) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return JSON.stringify({
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  });
}

function openJson(serialized, key, associatedData) {
  let envelope;
  try { envelope = JSON.parse(String(serialized || "")); }
  catch (_) { throw new Error("Encrypted Cloudflare record is not valid JSON."); }
  if (!envelope || envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm" ||
      typeof envelope.iv !== "string" || typeof envelope.tag !== "string" ||
      typeof envelope.ciphertext !== "string") {
    throw new Error("Encrypted Cloudflare record has an invalid envelope.");
  }
  try {
    const iv = Buffer.from(envelope.iv, "base64");
    const tag = Buffer.from(envelope.tag, "base64");
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > 5 * 1024 * 1024) {
      throw new Error("invalid envelope dimensions");
    }
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(associatedData, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch (_) {
    throw new Error("Cloudflare encrypted record could not be decrypted. Check the encryption key and record integrity.");
  }
}

function normaliseDiscoveryState(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    campaigns: Array.isArray(input.campaigns) ? input.campaigns.slice(0, 500) : [],
    scans: Array.isArray(input.scans) ? input.scans.slice(0, 50) : [],
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt.slice(0, 40) : ""
  };
}

function createD1DiscoveryStore(database) {
  const db = requiredD1(database);

  async function readState() {
    const row = await db.prepare("SELECT state_json FROM discovery_state WHERE id = 1").first();
    if (!row || typeof row.state_json !== "string") {
      return { campaigns: [], scans: [], updatedAt: "" };
    }
    let parsed;
    try { parsed = JSON.parse(row.state_json); }
    catch (_) { throw new Error("Cloudflare discovery state is corrupt; refusing to reset saved campaign history."); }
    return normaliseDiscoveryState(parsed);
  }

  async function writeState(value) {
    const state = normaliseDiscoveryState(value);
    const serialized = JSON.stringify(state);
    if (Buffer.byteLength(serialized, "utf8") > DISCOVERY_MAX_BYTES) {
      throw new Error("Cloudflare discovery state exceeds the 1.5 MB row safety limit.");
    }
    await db.prepare(
      "INSERT INTO discovery_state (id, state_json, updated_at) VALUES (1, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at"
    ).bind(serialized, state.updatedAt || new Date().toISOString()).run();
    return true;
  }

  return Object.freeze({ readState, writeState });
}

function createD1EncryptedTokenVault(database, encryptionKey) {
  const db = requiredD1(database);
  const key = parseEncryptionKey(encryptionKey);

  function validateKey(sessionHash, provider) {
    if (typeof sessionHash !== "string" || !/^[a-f0-9]{64}$/.test(sessionHash)) {
      throw new TypeError("sessionHash must be a SHA-256 hex digest.");
    }
    if (!TOKEN_PROVIDERS.has(provider)) throw new TypeError("Unsupported token provider.");
  }

  function aad(sessionHash, provider) {
    return "clipreward-d1-token:v1|" + sessionHash + "|" + provider;
  }

  async function get(sessionHash, provider) {
    validateKey(sessionHash, provider);
    const row = await db.prepare(
      "SELECT encrypted_json FROM social_tokens WHERE session_hash = ? AND provider = ?"
    ).bind(sessionHash, provider).first();
    if (!row) return null;
    const record = openJson(row.encrypted_json, key, aad(sessionHash, provider));
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error("Cloudflare token record has an invalid data shape.");
    }
    return record;
  }

  async function set(sessionHash, provider, record) {
    validateKey(sessionHash, provider);
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new TypeError("Token record must be an object.");
    }
    const current = await db.prepare(
      "SELECT session_hash FROM social_tokens WHERE session_hash = ? LIMIT 1"
    ).bind(sessionHash).first();
    if (!current) {
      const count = await db.prepare("SELECT COUNT(DISTINCT session_hash) AS count FROM social_tokens").first();
      if (Number(count && count.count || 0) >= 500) {
        throw new Error("Social token vault session limit reached.");
      }
    }
    const encrypted = sealJson(record, key, aad(sessionHash, provider));
    await db.prepare(
      "INSERT INTO social_tokens (session_hash, provider, encrypted_json, updated_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(session_hash, provider) DO UPDATE SET encrypted_json = excluded.encrypted_json, updated_at = excluded.updated_at"
    ).bind(sessionHash, provider, encrypted, Date.now()).run();
    return true;
  }

  async function deleteProvider(sessionHash, provider) {
    validateKey(sessionHash, provider);
    const result = await db.prepare(
      "DELETE FROM social_tokens WHERE session_hash = ? AND provider = ?"
    ).bind(sessionHash, provider).run();
    return Number(result && result.meta && result.meta.changes || 0) > 0;
  }

  return Object.freeze({ get, set, deleteProvider });
}

function createD1OAuthStateStore(database, encryptionKey, options = {}) {
  const db = requiredD1(database);
  const key = parseEncryptionKey(encryptionKey);
  const now = typeof options.now === "function" ? options.now : () => Date.now();

  function validate(provider, state) {
    if (!STATE_PROVIDERS.has(provider)) throw new TypeError("Unsupported OAuth state provider.");
    if (typeof state !== "string" || !STATE_PATTERN.test(state)) throw new TypeError("OAuth state must be a 43-character base64url string.");
  }

  function stateHash(state) {
    return sha256(state);
  }

  function aad(provider, hash) {
    return "clipreward-d1-oauth-state:v1|" + provider + "|" + hash;
  }

  async function put(provider, state, payload, expiresAt) {
    validate(provider, state);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TypeError("OAuth state payload must be an object.");
    }
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Number(now())) {
      throw new TypeError("OAuth state expiry must be a future timestamp.");
    }
    const hash = stateHash(state);
    const encrypted = sealJson(payload, key, aad(provider, hash));
    await db.prepare("DELETE FROM oauth_pending_states WHERE expires_at <= ?").bind(Number(now())).run();
    await db.prepare(
      "INSERT INTO oauth_pending_states (state_hash, provider, encrypted_json, expires_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(state_hash) DO UPDATE SET provider = excluded.provider, encrypted_json = excluded.encrypted_json, expires_at = excluded.expires_at"
    ).bind(hash, provider, encrypted, expiresAt).run();
    return true;
  }

  async function consume(provider, state) {
    validate(provider, state);
    const hash = stateHash(state);
    const row = await db.prepare(
      "DELETE FROM oauth_pending_states WHERE state_hash = ? AND provider = ? AND expires_at > ? " +
      "RETURNING encrypted_json"
    ).bind(hash, provider, Number(now())).first();
    if (!row || typeof row.encrypted_json !== "string") return null;
    const payload = openJson(row.encrypted_json, key, aad(provider, hash));
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  }

  return Object.freeze({ put, consume });
}

function createR2MetaMediaStore(bucket, publicBaseUrl, options = {}) {
  const r2 = requiredR2(bucket);
  const baseUrl = String(publicBaseUrl || "").replace(/\/+$/, "");
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const ttlMs = Number.isSafeInteger(options.ttlMs)
    ? Math.max(60_000, Math.min(60 * 60 * 1000, options.ttlMs))
    : 15 * 60 * 1000;

  async function create(buffer, mimeType) {
    if (!baseUrl || !/^https:\/\//.test(baseUrl)) throw new Error("Meta media base URL is not configured.");
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 50 * 1024 * 1024) {
      throw new Error("Meta media size is invalid.");
    }
    const type = String(mimeType || "").toLowerCase().split(";")[0].trim();
    if (!["video/mp4", "video/quicktime"].includes(type)) throw new Error("Meta media type is invalid.");
    const token = randomBytes(32).toString("hex");
    const key = "instagram/" + token;
    const expiresAt = now() + ttlMs;
    await r2.put(key, buffer, {
      httpMetadata: { contentType: type, cacheControl: "private, no-store, max-age=0" },
      customMetadata: { expiresAt: String(expiresAt) }
    });
    let disposed = false;
    return {
      url: baseUrl + "/media/instagram/" + token,
      async dispose() {
        if (disposed) return;
        disposed = true;
        await r2.delete(key);
      }
    };
  }

  async function get(token) {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
    const key = "instagram/" + token;
    const object = await r2.get(key);
    if (!object) return null;
    const expiresAt = Number(object.customMetadata && object.customMetadata.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Number(now())) {
      await r2.delete(key);
      return null;
    }
    const mimeType = String(object.httpMetadata && object.httpMetadata.contentType || "");
    if (!["video/mp4", "video/quicktime"].includes(mimeType)) {
      await r2.delete(key);
      return null;
    }
    const buffer = Buffer.from(await object.arrayBuffer());
    if (!buffer.length || buffer.length > 50 * 1024 * 1024) {
      await r2.delete(key);
      return null;
    }
    return { buffer, mimeType, size: buffer.length };
  }

  return Object.freeze({ create, get });
}

module.exports = {
  DISCOVERY_MAX_BYTES,
  parseEncryptionKey,
  sealJson,
  openJson,
  normaliseDiscoveryState,
  createD1DiscoveryStore,
  createD1EncryptedTokenVault,
  createD1OAuthStateStore,
  createR2MetaMediaStore
};
