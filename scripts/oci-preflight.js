"use strict";

const { parseEncryptionKey } = require("../social-token-vault.js");

function validateOciEnvironment(env = process.env) {
  const errors = [];
  const warnings = [];
  const checks = [];
  const check = (name, passed, detail) => {
    checks.push({ name, passed: Boolean(passed), detail });
    if (!passed) errors.push(name + ": " + detail);
  };
  const warning = (name, detail) => warnings.push(name + ": " + detail);
  const value = (name) => String(env[name] || "").trim();

  const host = value("SITE_HOST").toLowerCase();
  const hostLabels = host.split(".");
  const validHost = host.length <= 253 && hostLabels.length >= 2 &&
    hostLabels.every((label) => label.length >= 1 && label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) &&
    !/^\d+(?:\.\d+){3}$/.test(host) && !host.startsWith("your-");
  check("SITE_HOST", validHost, "Set a real DNS hostname; do not leave the example placeholder.");
  check("ACME_EMAIL", /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value("ACME_EMAIL")),
    "Set a valid contact email for HTTPS certificate issuance.");

  const origin = validHost ? "https://" + host : "";
  check("NODE_ENV", value("NODE_ENV") === "production", "Set NODE_ENV=production.");
  check("SERVE_STATIC_APP", value("SERVE_STATIC_APP") === "true", "Set SERVE_STATIC_APP=true for the same-origin app and API.");

  const key = value("SOCIAL_TOKEN_ENCRYPTION_KEY");
  let keyValid = false;
  try {
    parseEncryptionKey(key);
    keyValid = true;
  } catch (_) {}
  check("SOCIAL_TOKEN_ENCRYPTION_KEY", keyValid,
    "Set a 32-byte key encoded as 64 hex characters or base64. The key itself is never printed.");

  check("SOCIAL_TOKEN_STORE_PATH", value("SOCIAL_TOKEN_STORE_PATH").startsWith("/data/"),
    "Store encrypted OAuth tokens on the persistent /data volume.");
  check("DISCOVERY_STORE_PATH", value("DISCOVERY_STORE_PATH").startsWith("/data/"),
    "Store backend discovery data on the persistent /data volume.");

  const socialOrigins = value("SOCIAL_CORS_ORIGINS").split(",").map((item) => item.trim()).filter(Boolean);
  check("SOCIAL_CORS_ORIGINS", Boolean(origin) && socialOrigins.includes(origin) && !socialOrigins.includes("*"),
    "Include the exact HTTPS site origin, without a path or wildcard.");
  const discoveryOrigins = value("DISCOVERY_CORS_ORIGINS").split(",").map((item) => item.trim()).filter(Boolean);
  check("DISCOVERY_CORS_ORIGINS", Boolean(origin) && discoveryOrigins.includes(origin) && !discoveryOrigins.includes("*"),
    "Include the exact HTTPS site origin, without a path or wildcard.");
  check("SOCIAL_RETURN_URL", Boolean(origin) && value("SOCIAL_RETURN_URL") === origin + "/",
    "Set the same-origin return URL to " + (origin ? origin + "/" : "https://YOUR_HOSTNAME/") + ".");
  check("SOCIAL_COOKIE_SAMESITE", value("SOCIAL_COOKIE_SAMESITE") === "Lax",
    "Use SameSite=Lax for the recommended same-origin HTTPS deployment.");
  check("META_MEDIA_BASE_URL", !value("META_MEDIA_BASE_URL") || value("META_MEDIA_BASE_URL") === origin,
    "When set, META_MEDIA_BASE_URL must equal the same public HTTPS origin.");

  function oauthGroup(label, names, callbackPath) {
    const entries = names.map(value);
    const configured = entries.some(Boolean);
    if (!configured) {
      warning(label, "OAuth credentials are not configured yet; social publishing stays disabled.");
      return;
    }
    const complete = entries.every(Boolean);
    check(label + " credentials", complete, "Provide every credential in this group or leave the entire group blank.");
    if (complete) {
      check(label + " callback", entries[2] === origin + callbackPath,
        "Register the exact HTTPS callback URL " + origin + callbackPath + " in the provider developer console.");
    }
  }

  oauthGroup("Google OAuth", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"],
    "/api/social/youtube/callback");
  oauthGroup("Meta OAuth", ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"],
    "/api/social/meta/callback");

  if (!value("META_MEDIA_BASE_URL")) {
    warning("Instagram publishing", "Set META_MEDIA_BASE_URL to the public HTTPS origin after the Meta app and publishing permissions are configured.");
  }
  if (value("DISCOVERY_SCHEDULER_ENABLED") !== "false") {
    warning("Discovery scheduler", "GitHub Actions is the canonical public campaign scanner; keep the backend scheduler disabled to avoid duplicate scans.");
  }

  return { ok: errors.length === 0, errors, warnings, checks };
}

function formatReport(result) {
  const lines = ["AI Commerce Hub · OCI deployment preflight"];
  for (const item of result.checks) {
    lines.push((item.passed ? "PASS " : "FAIL ") + item.name + " — " + item.detail);
  }
  for (const item of result.warnings) lines.push("WARN " + item);
  lines.push(result.ok ? "RESULT: READY TO DEPLOY" : "RESULT: BLOCKED — fix the failures above.");
  return lines.join("\n");
}

if (require.main === module) {
  const result = validateOciEnvironment(process.env);
  process.stdout.write(formatReport(result) + "\n");
  if (!result.ok) process.exitCode = 1;
}

module.exports = { validateOciEnvironment, formatReport };
