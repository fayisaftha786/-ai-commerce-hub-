"use strict";

// Server-side configuration readiness only. This module never returns secret values
// and does not perform OAuth or claim that a provider is connected.

const PROVIDERS = Object.freeze({
  instagram: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "INSTAGRAM_REDIRECT_URI"],
  meta: ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"],
  youtube: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"]
});

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function getProviderReadiness(provider, env = process.env) {
  if (!Object.prototype.hasOwnProperty.call(PROVIDERS, provider)) {
    return { provider, configured: false, missing: [], error: "Unsupported provider" };
  }

  const required = PROVIDERS[provider];
  const missing = required.filter((name) => typeof env[name] !== "string" || !env[name].trim());
  const redirectName = required[required.length - 1];
  if (!missing.includes(redirectName) && !isHttpsUrl(env[redirectName])) {
    missing.push(redirectName);
  }

  return {
    provider,
    configured: missing.length === 0,
    missing,
    status: missing.length === 0
      ? "credentials_present_oauth_not_verified"
      : "configuration_incomplete"
  };
}

module.exports = { getProviderReadiness };
