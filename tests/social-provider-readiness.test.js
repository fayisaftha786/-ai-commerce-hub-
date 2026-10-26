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

test("rejects unsupported providers", () => {
  assert.equal(getProviderReadiness("instagram", {}).error, "Unsupported provider");
});
