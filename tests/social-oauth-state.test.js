"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const oauthState = require("../social-oauth-state.js");

test("creates unique, URL-safe, cryptographically random OAuth state", () => {
  oauthState.clearPendingStatesForTests();
  const first = oauthState.createOAuthState({ now: 1000 });
  const second = oauthState.createOAuthState({ now: 1000 });
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test("accepts a valid state once and rejects replay", () => {
  oauthState.clearPendingStatesForTests();
  const state = oauthState.createOAuthState({ now: 1000, ttlMs: 5000 });
  assert.equal(oauthState.consumeOAuthState(state, { now: 2000 }), true);
  assert.equal(oauthState.consumeOAuthState(state, { now: 2000 }), false);
});

test("rejects expired, malformed, and unknown states", () => {
  oauthState.clearPendingStatesForTests();
  const state = oauthState.createOAuthState({ now: 1000, ttlMs: 1000 });
  assert.equal(oauthState.consumeOAuthState(state, { now: 2000 }), false);
  assert.equal(oauthState.consumeOAuthState("bad-state", { now: 1500 }), false);
  assert.equal(oauthState.consumeOAuthState("A".repeat(43), { now: 1500 }), false);
});

test("validates state lifetime settings", () => {
  assert.throws(() => oauthState.createOAuthState({ now: 1, ttlMs: 0 }), RangeError);
  assert.throws(() => oauthState.createOAuthState({ now: 1, ttlMs: 31 * 60 * 1000 }), RangeError);
});
