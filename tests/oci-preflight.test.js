"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateOciEnvironment, formatReport } = require("../scripts/oci-preflight.js");

function validEnvironment(overrides = {}) {
  return {
    SITE_HOST: "hub.example.com",
    ACME_EMAIL: "owner@example.com",
    NODE_ENV: "production",
    SERVE_STATIC_APP: "true",
    SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    SOCIAL_TOKEN_STORE_PATH: "/data/social-token-vault.json",
    DISCOVERY_STORE_PATH: "/data/content-rewards-discovery.json",
    SOCIAL_CORS_ORIGINS: "https://hub.example.com",
    SOCIAL_RETURN_URL: "https://hub.example.com/",
    SOCIAL_COOKIE_SAMESITE: "Lax",
    META_MEDIA_BASE_URL: "https://hub.example.com",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    GOOGLE_REDIRECT_URI: "",
    META_APP_ID: "",
    META_APP_SECRET: "",
    META_REDIRECT_URI: "",
    DISCOVERY_SCHEDULER_ENABLED: "false",
    ...overrides
  };
}

test("accepts a persistent single-origin HTTPS backend with a valid encrypted-token key", () => {
  const result = validateOciEnvironment(validEnvironment({
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GOOGLE_REDIRECT_URI: "https://hub.example.com/api/social/youtube/callback",
    META_APP_ID: "meta-app-id",
    META_APP_SECRET: "meta-app-secret",
    META_REDIRECT_URI: "https://hub.example.com/api/social/meta/callback"
  }));
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.ok(result.checks.every((item) => item.passed));
  assert.match(formatReport(result), /RESULT: READY TO DEPLOY/);
});

test("allows deployment before provider OAuth apps are created but reports them as not configured", () => {
  const result = validateOciEnvironment(validEnvironment());
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((item) => /Google OAuth/.test(item)));
  assert.ok(result.warnings.some((item) => /Meta OAuth/.test(item)));
});

test("rejects placeholder hosts, invalid email, wrong origin and unsafe storage paths", () => {
  const result = validateOciEnvironment(validEnvironment({
    SITE_HOST: "your-subdomain.duckdns.org",
    ACME_EMAIL: "not-an-email",
    SOCIAL_CORS_ORIGINS: "*",
    SOCIAL_RETURN_URL: "https://other.example/",
    SOCIAL_TOKEN_STORE_PATH: "/tmp/token.json",
    DISCOVERY_STORE_PATH: "/root/discovery.json"
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.startsWith("SITE_HOST:")));
  assert.ok(result.errors.some((item) => item.startsWith("ACME_EMAIL:")));
  assert.ok(result.errors.some((item) => item.startsWith("SOCIAL_CORS_ORIGINS:")));
  assert.ok(result.errors.some((item) => item.startsWith("SOCIAL_RETURN_URL:")));
  assert.ok(result.errors.some((item) => item.startsWith("SOCIAL_TOKEN_STORE_PATH:")));
  assert.ok(result.errors.some((item) => item.startsWith("DISCOVERY_STORE_PATH:")));
});

test("rejects an invalid token encryption key without revealing its value", () => {
  const secret = "do-not-print-this-secret";
  const result = validateOciEnvironment(validEnvironment({ SOCIAL_TOKEN_ENCRYPTION_KEY: secret }));
  assert.equal(result.ok, false);
  const report = formatReport(result);
  assert.doesNotMatch(report, new RegExp(secret));
  assert.match(report, /32-byte key/);
});

test("rejects partial provider credentials and callbacks from another hostname", () => {
  const partial = validateOciEnvironment(validEnvironment({
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_REDIRECT_URI: "https://hub.example.com/api/social/youtube/callback"
  }));
  assert.equal(partial.ok, false);
  assert.ok(partial.errors.some((item) => /Google OAuth credentials/.test(item)));

  const wrongCallback = validateOciEnvironment(validEnvironment({
    META_APP_ID: "meta-id",
    META_APP_SECRET: "meta-secret",
    META_REDIRECT_URI: "https://wrong.example/api/social/meta/callback"
  }));
  assert.equal(wrongCallback.ok, false);
  assert.ok(wrongCallback.errors.some((item) => /Meta OAuth callback/.test(item)));
});

test("requires exact same-origin media host and SameSite=Lax", () => {
  const result = validateOciEnvironment(validEnvironment({
    META_MEDIA_BASE_URL: "https://media.example.com",
    SOCIAL_COOKIE_SAMESITE: "None"
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.startsWith("META_MEDIA_BASE_URL:")));
  assert.ok(result.errors.some((item) => item.startsWith("SOCIAL_COOKIE_SAMESITE:")));
});
