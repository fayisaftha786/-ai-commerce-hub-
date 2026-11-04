"use strict";

const { createD1DiscoveryStore, createD1EncryptedTokenVault, createD1OAuthStateStore, createR2MetaMediaStore, normaliseDiscoveryState } = require("./storage.js");
const { createServer } = require("../server.js");

function createAssetBackedDiscoveryStore(database, assets) {
  const persistent = createD1DiscoveryStore(database);
  let fallbackPromise = null;

  async function readState() {
    const saved = await persistent.readState();
    if (saved.campaigns.length || !assets || typeof assets.fetch !== "function") return saved;
    if (!fallbackPromise) {
      fallbackPromise = (async () => {
        try {
          const response = await assets.fetch(new Request("https://clipreward-static.invalid/content-rewards-assistant/discovery-snapshot.json", {
            method: "GET",
            headers: { Accept: "application/json" }
          }));
          if (!response || !response.ok) return saved;
          const snapshot = await response.json();
          if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.campaigns) ||
              !Array.isArray(snapshot.scans)) return saved;
          return normaliseDiscoveryState({
            campaigns: snapshot.campaigns,
            scans: snapshot.scans,
            updatedAt: snapshot.generatedAt || ""
          });
        } catch (_) {
          return saved;
        }
      })();
    }
    return fallbackPromise;
  }

  async function writeState(value) {
    fallbackPromise = null;
    return persistent.writeState(value);
  }

  return Object.freeze({ readState, writeState });
}

function createCloudflareHandler(env, httpServerHandler, options = {}) {
  if (typeof httpServerHandler !== "function") {
    throw new TypeError("Cloudflare httpServerHandler is required.");
  }
  if (!env || !env.DB || !env.MEDIA || !env.ASSETS) {
    throw new Error("Cloudflare bindings DB, MEDIA and ASSETS must all be configured.");
  }
  if (!String(env.SOCIAL_TOKEN_ENCRYPTION_KEY || "").trim()) {
    throw new Error("SOCIAL_TOKEN_ENCRYPTION_KEY Worker secret is required.");
  }

  const appEnv = {
    ...env,
    NODE_ENV: "production",
    HOST: "0.0.0.0",
    PORT: "3000",
    SERVE_STATIC_APP: "false",
    DISCOVERY_SCHEDULER_ENABLED: "false",
    SOCIAL_COOKIE_SAMESITE: "Lax"
  };
  const server = createServer({
    env: appEnv,
    discoveryStore: options.discoveryStore || createAssetBackedDiscoveryStore(env.DB, env.ASSETS),
    socialTokenVault: options.socialTokenVault || createD1EncryptedTokenVault(env.DB, appEnv.SOCIAL_TOKEN_ENCRYPTION_KEY),
    oauthStateStore: options.oauthStateStore || createD1OAuthStateStore(env.DB, appEnv.SOCIAL_TOKEN_ENCRYPTION_KEY),
    metaMediaStore: options.metaMediaStore || createR2MetaMediaStore(env.MEDIA, appEnv.META_MEDIA_BASE_URL),
    publicCampaignPageLimiter: options.publicCampaignPageLimiter,
    now: options.now
  });
  return httpServerHandler(server);
}

module.exports = { createAssetBackedDiscoveryStore, createCloudflareHandler };
