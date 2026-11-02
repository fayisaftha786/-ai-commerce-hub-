"use strict";

const crypto = require("node:crypto");

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_TTL_MS = 15 * 60 * 1000;

function createEphemeralMetaMediaStore(options = {}) {
  const baseUrl = String(options.publicBaseUrl || "").replace(/\/+$/, "");
  const now = options.now || (() => Date.now());
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const ttlMs = Number.isSafeInteger(options.ttlMs) ? Math.max(60_000, Math.min(60 * 60 * 1000, options.ttlMs)) : DEFAULT_TTL_MS;
  const entries = new Map();

  function prune() {
    const current = now();
    for (const [token, record] of entries) {
      if (record.expiresAt <= current) entries.delete(token);
    }
  }

  function create(buffer, mimeType) {
    if (!baseUrl || !/^https:\/\//.test(baseUrl)) throw new Error("meta_media_base_url_not_configured");
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 50 * 1024 * 1024) {
      throw new Error("meta_media_size_invalid");
    }
    const type = String(mimeType || "").toLowerCase().split(";")[0].trim();
    if (!["video/mp4", "video/quicktime"].includes(type)) throw new Error("meta_media_type_invalid");
    prune();
    const token = randomBytes(32).toString("hex");
    entries.set(token, { buffer, mimeType: type, expiresAt: now() + ttlMs });
    let disposed = false;
    return {
      url: baseUrl + "/media/instagram/" + token,
      dispose() {
        if (disposed) return;
        disposed = true;
        entries.delete(token);
      }
    };
  }

  function get(token) {
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return null;
    const record = entries.get(token);
    if (!record || record.expiresAt <= now()) {
      entries.delete(token);
      return null;
    }
    return { buffer: record.buffer, mimeType: record.mimeType, size: record.buffer.length };
  }

  function size() {
    prune();
    return entries.size;
  }

  return Object.freeze({ create, get, size, prune });
}

module.exports = { TOKEN_PATTERN, DEFAULT_TTL_MS, createEphemeralMetaMediaStore };
