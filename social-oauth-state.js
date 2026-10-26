"use strict";

// Minimal OAuth state helper for a single Node.js process.
// Production deployments must use a shared, expiring server-side store (for example,
// Redis) and bind each state to an authenticated user/session. This module does
// not perform OAuth, exchange tokens, or connect to any social platform.

const { randomBytes, timingSafeEqual } = require("node:crypto");

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_STATES = 10_000;
const pendingStates = new Map();

function pruneExpired(now) {
  for (const [state, expiresAt] of pendingStates) {
    if (expiresAt <= now) pendingStates.delete(state);
  }
}

function createOAuthState(options = {}) {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("now must be a non-negative safe integer");
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 30 * 60 * 1000) {
    throw new RangeError("ttlMs must be between 1 ms and 30 minutes");
  }

  pruneExpired(now);
  if (pendingStates.size >= MAX_PENDING_STATES) {
    throw new Error("Too many pending OAuth states; try again later");
  }

  const state = randomBytes(32).toString("base64url");
  pendingStates.set(state, now + ttlMs);
  return state;
}

function consumeOAuthState(state, options = {}) {
  const now = options.now ?? Date.now();
  if (typeof state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state)) return false;
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("now must be a non-negative safe integer");

  const expiresAt = pendingStates.get(state);
  if (expiresAt === undefined) return false;

  // Consume before returning so a callback cannot replay the same state.
  pendingStates.delete(state);
  if (expiresAt <= now) return false;

  // Constant-time self-comparison avoids introducing a value-dependent comparison
  // for the token format; unpredictability comes from crypto.randomBytes above.
  const bytes = Buffer.from(state);
  return timingSafeEqual(bytes, Buffer.from(state));
}

function clearPendingStatesForTests() {
  pendingStates.clear();
}

module.exports = { createOAuthState, consumeOAuthState, clearPendingStatesForTests };
