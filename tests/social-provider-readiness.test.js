"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getProviderReadiness } = require("../social-provider-readiness.js");

test("reports missing provider configuration without exposing values", () => {
  const result = getProviderReadiness("meta", {});
  assert.equal(result.configured, false);
  assert.deepEqual(result.missing, ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"]);
  assert.equal(JSON.stringify(result).includes("secret-value"), false);
});

test("marks complete HTTPS configuration as present, not as connected", () => {
  const result = getProviderReadiness("youtube", {
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "secret-value",
    GOOGLE_REDIRECT_URI: "https://example.com/api/social/youtube/callback"
  });
  assert.equal(result.configured, true);
  assert.equal(result.status, "credentials_present_oauth_not_verified");
  assert.equal(JSON.stringify(result).includes("secret-value"), false);
});

test("rejects insecure redirect URIs", () => {
  const result = getProviderReadiness("meta", {
    META_APP_ID: "id",
    META_APP_SECRET: "secret-value",
    META_REDIRECT_URI: "http://example.com/callback"
  });
  assert.equal(result.configured, false);
  assert.deepEqual(result.missing, ["META_REDIRECT_URI"]);
});

test("recognizes Instagram Login configuration without claiming a connection", () => {
  const missing = getProviderReadiness("instagram", {});
  assert.equal(missing.configured, false);
  assert.deepEqual(missing.missing, ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "INSTAGRAM_REDIRECT_URI"]);
  const ready = getProviderReadiness("instagram", {
    INSTAGRAM_APP_ID: "instagram-app-id",
    INSTAGRAM_APP_SECRET: "secret-value",
    INSTAGRAM_REDIRECT_URI: "https://api.example.com/api/social/instagram/callback"
  });
  assert.equal(ready.configured, true);
  assert.equal(ready.status, "credentials_present_oauth_not_verified");
  assert.equal(JSON.stringify(ready).includes("secret-value"), false);
});

test("rejects an insecure Instagram callback URI", () => {
  const result = getProviderReadiness("instagram", {
    INSTAGRAM_APP_ID: "id",
    INSTAGRAM_APP_SECRET: "secret-value",
    INSTAGRAM_REDIRECT_URI: "http://localhost/callback"
  });
  assert.equal(result.configured, false);
  assert.deepEqual(result.missing, ["INSTAGRAM_REDIRECT_URI"]);
});

test("rejects unsupported providers", () => {
  assert.equal(getProviderReadiness("unknown", {}).error, "Unsupported provider");
});
