"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const VAULT_VERSION = 1;
const MAX_VAULT_BYTES = 5 * 1024 * 1024;
const MAX_SESSIONS = 500;
const AAD = Buffer.from("ai-commerce-hub-social-token-vault:v1", "utf8");
const ALLOWED_PROVIDERS = new Set(["youtube", "instagram", "facebook"]);

function parseEncryptionKey(value) {
  const raw = String(value || "").trim();
  let key;
  if (/^[a-f0-9]{64}$/i.test(raw)) key = Buffer.from(raw, "hex");
  else key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("SOCIAL_TOKEN_ENCRYPTION_KEY must be a 32-byte key encoded as 64 hex characters or base64.");
  }
  return key;
}

function safeClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createEncryptedTokenVault(options = {}) {
  const filePath = path.resolve(options.filePath || path.join(process.cwd(), ".data", "social-token-vault.json"));
  const fsImpl = options.fsImpl || fs;
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const key = parseEncryptionKey(options.encryptionKey);
  let state = null;
  let loaded = false;

  function validateState(value) {
    if (!value || typeof value !== "object" || value.version !== VAULT_VERSION ||
        !value.sessions || typeof value.sessions !== "object" || Array.isArray(value.sessions)) {
      throw new Error("Social token vault data has an unrecognised format.");
    }
    const entries = Object.entries(value.sessions);
    if (entries.length > MAX_SESSIONS) throw new Error("Social token vault contains too many sessions.");
    const clean = {};
    for (const [sessionHash, providers] of entries) {
      if (!/^[a-f0-9]{64}$/.test(sessionHash) || !providers || typeof providers !== "object" || Array.isArray(providers)) {
        throw new Error("Social token vault contains an invalid session record.");
      }
      const cleanProviders = {};
      for (const [provider, record] of Object.entries(providers)) {
        if (!ALLOWED_PROVIDERS.has(provider) || !record || typeof record !== "object" || Array.isArray(record)) {
          throw new Error("Social token vault contains an invalid provider record.");
        }
        cleanProviders[provider] = safeClone(record);
      }
      clean[sessionHash] = cleanProviders;
    }
    return { version: VAULT_VERSION, sessions: clean };
  }

  function encrypt(value) {
    const iv = randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(AAD);
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      version: VAULT_VERSION,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };
  }

  function decrypt(envelope) {
    if (!envelope || envelope.version !== VAULT_VERSION || envelope.algorithm !== "aes-256-gcm" ||
        typeof envelope.iv !== "string" || typeof envelope.tag !== "string" ||
        typeof envelope.ciphertext !== "string") {
      throw new Error("Social token vault envelope is invalid.");
    }
    try {
      const iv = Buffer.from(envelope.iv, "base64");
      const tag = Buffer.from(envelope.tag, "base64");
      const ciphertext = Buffer.from(envelope.ciphertext, "base64");
      if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_VAULT_BYTES) {
        throw new Error("invalid envelope dimensions");
      }
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(AAD);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return validateState(JSON.parse(plaintext.toString("utf8")));
    } catch (_) {
      throw new Error("Social token vault could not be decrypted. Check its encryption key and file integrity.");
    }
  }

  function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    if (!fsImpl.existsSync(filePath)) {
      state = { version: VAULT_VERSION, sessions: {} };
      return;
    }
    const stats = fsImpl.statSync(filePath);
    if (!stats.isFile() || stats.size > MAX_VAULT_BYTES) throw new Error("Social token vault file is invalid or exceeds 5 MB.");
    const envelope = JSON.parse(fsImpl.readFileSync(filePath, "utf8"));
    state = decrypt(envelope);
  }

  function persist(next) {
    const checked = validateState(next);
    const envelope = JSON.stringify(encrypt(checked));
    if (Buffer.byteLength(envelope, "utf8") > MAX_VAULT_BYTES) {
      throw new Error("Social token vault would exceed 5 MB.");
    }
    const directory = path.dirname(filePath);
    fsImpl.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { fsImpl.chmodSync(directory, 0o700); } catch (_) {}
    const tempPath = filePath + "." + randomBytes(8).toString("hex") + ".tmp";
    let fd;
    try {
      fd = fsImpl.openSync(tempPath, "wx", 0o600);
      fsImpl.writeFileSync(fd, envelope, "utf8");
      fsImpl.fsyncSync(fd);
      fsImpl.closeSync(fd);
      fd = null;
      fsImpl.renameSync(tempPath, filePath);
      try { fsImpl.chmodSync(filePath, 0o600); } catch (_) {}
    } catch (error) {
      if (fd !== undefined && fd !== null) {
        try { fsImpl.closeSync(fd); } catch (_) {}
      }
      try { fsImpl.unlinkSync(tempPath); } catch (_) {}
      throw error;
    }
    state = checked;
    loaded = true;
  }

  function validateKey(sessionHash, provider) {
    if (typeof sessionHash !== "string" || !/^[a-f0-9]{64}$/.test(sessionHash)) {
      throw new TypeError("sessionHash must be a SHA-256 hex digest.");
    }
    if (!ALLOWED_PROVIDERS.has(provider)) throw new TypeError("Unsupported token provider.");
  }

  function get(sessionHash, provider) {
    validateKey(sessionHash, provider);
    ensureLoaded();
    const record = state.sessions[sessionHash] && state.sessions[sessionHash][provider];
    return record ? safeClone(record) : null;
  }

  function set(sessionHash, provider, record) {
    validateKey(sessionHash, provider);
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new TypeError("Token record must be an object.");
    ensureLoaded();
    const next = safeClone(state);
    if (!next.sessions[sessionHash]) {
      if (Object.keys(next.sessions).length >= MAX_SESSIONS) throw new Error("Social token vault session limit reached.");
      next.sessions[sessionHash] = {};
    }
    next.sessions[sessionHash][provider] = safeClone(record);
    persist(next);
    return true;
  }

  function deleteProvider(sessionHash, provider) {
    validateKey(sessionHash, provider);
    ensureLoaded();
    if (!state.sessions[sessionHash] || !state.sessions[sessionHash][provider]) return false;
    const next = safeClone(state);
    delete next.sessions[sessionHash][provider];
    if (!Object.keys(next.sessions[sessionHash]).length) delete next.sessions[sessionHash];
    persist(next);
    return true;
  }

  return Object.freeze({ get, set, deleteProvider, filePath });
}

module.exports = { VAULT_VERSION, MAX_VAULT_BYTES, MAX_SESSIONS, parseEncryptionKey, createEncryptedTokenVault };
