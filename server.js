"use strict";

const http = require("node:http");
const { getProviderReadiness } = require("./social-provider-readiness.js");
const { createFileStore } = require("./discovery-store.js");
const { createDiscoveryService } = require("./discovery-service.js");
const { createYouTubeOAuthService } = require("./youtube-oauth.js");
const { createEncryptedTokenVault } = require("./social-token-vault.js");
const { createMetaSocialService } = require("./meta-social-oauth.js");
const { createEphemeralMetaMediaStore } = require("./meta-media-store.js");
const { createStaticSite } = require("./static-site.js");
const PublicCampaignScanner = require("./scripts/content-rewards-discovery-scan.js");

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...extraHeaders
  });
  response.end(body);
}

function allowedOrigins(env = process.env) {
  return String(env.DISCOVERY_CORS_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
}

function applyDiscoveryCors(request, response, env = process.env) {
  const origin = request.headers.origin;
  if (!origin) return true; // Same-origin and non-browser clients do not need CORS headers.
  const allowed = allowedOrigins(env);
  if (!allowed.includes(origin)) return false;
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "Accept, Content-Type");
  response.setHeader("access-control-max-age", "600");
  response.setHeader("vary", "Origin");
  return true;
}


function allowedSocialOrigins(env = process.env) {
  return String(env.SOCIAL_CORS_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
}

function applySocialCors(request, response, env = process.env) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const allowed = allowedSocialOrigins(env);
  if (!allowed.includes(origin)) return false;
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-credentials", "true");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "Accept, Content-Type, X-AI-Commerce-Action");
  response.setHeader("access-control-max-age", "600");
  response.setHeader("vary", "Origin");
  return true;
}

function socialSessionCookieName(env = process.env) {
  return env.NODE_ENV === "production" || env.SOCIAL_COOKIE_SECURE === "true"
    ? "__Host-aihub_session"
    : "aihub_session";
}

function parseCookie(request, name) {
  const raw = String(request.headers.cookie || "");
  for (const item of raw.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() !== name) continue;
    const value = item.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : "";
  }
  return "";
}

function buildSessionCookie(sessionId, env = process.env) {
  const productionSecure = env.NODE_ENV === "production" || env.SOCIAL_COOKIE_SECURE === "true";
  const requestedSameSite = String(env.SOCIAL_COOKIE_SAMESITE || (productionSecure ? "None" : "Lax"));
  const sameSite = requestedSameSite === "None" || requestedSameSite === "Lax"
    ? requestedSameSite
    : "Lax";
  const secure = productionSecure || sameSite === "None";
  const name = socialSessionCookieName(env);
  return name + "=" + sessionId + "; Path=/; Max-Age=2592000; HttpOnly; SameSite=" +
    sameSite + (secure ? "; Secure" : "");
}

function socialRedirect(response, url, setCookie = "") {
  const headers = {
    location: url,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff"
  };
  if (setCookie) headers["set-cookie"] = setCookie;
  response.writeHead(303, headers);
  response.end();
}

async function readRawBody(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("request_body_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}


function createPublicCampaignPageRateLimiter(options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit >= 1 && options.limit <= 100 ? options.limit : 20;
  const windowMs = Number.isInteger(options.windowMs) && options.windowMs >= 1000 ? Math.min(options.windowMs, 3600000) : 600000;
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const buckets = new Map();
  function consume(key) {
    const bucketKey = String(key || "unknown").slice(0, 120);
    const current = Number(now());
    if (!Number.isFinite(current)) return { allowed: false, retryAfterSeconds: 60 };
    const recent = (buckets.get(bucketKey) || []).filter((stamp) => current >= stamp && current - stamp < windowMs);
    if (recent.length >= limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - current) / 1000)) };
    recent.push(current);
    buckets.set(bucketKey, recent);
    if (buckets.size > 1000) {
      for (const [candidate, stamps] of buckets.entries()) {
        if (!stamps.some((stamp) => current >= stamp && current - stamp < windowMs)) buckets.delete(candidate);
        if (buckets.size <= 800) break;
      }
    }
    return { allowed: true, remaining: limit - recent.length };
  }
  return Object.freeze({ consume, limit, windowMs });
}

function createServer(options = {}) {
  const env = options.env ?? process.env;
  const sharedSocialTokenVault = options.socialTokenVault ||
    (env.SOCIAL_TOKEN_ENCRYPTION_KEY
      ? createEncryptedTokenVault({
        encryptionKey: env.SOCIAL_TOKEN_ENCRYPTION_KEY,
        filePath: env.SOCIAL_TOKEN_STORE_PATH
      })
      : null);
  const metaMediaStore = options.metaMediaStore || createEphemeralMetaMediaStore({
    publicBaseUrl: env.META_MEDIA_BASE_URL,
    now: options.now
  });
  const discoveryService = options.discoveryService || createDiscoveryService({
    store: options.discoveryStore || createFileStore({ filePath: env.DISCOVERY_STORE_PATH }),
    feed: options.discoveryFeed,
    fetchImpl: options.fetchImpl,
    enabled: env.DISCOVERY_SCHEDULER_ENABLED === "true",
    intervalMinutes: env.DISCOVERY_INTERVAL_MINUTES,
    now: options.now,
    setInterval: options.setInterval,
    clearInterval: options.clearInterval
  });
  const ownsDiscoveryService = !options.discoveryService;
  const publicCampaignPageFetcher = options.publicCampaignPageFetcher || PublicCampaignScanner.fetchPublicCampaignPage;
  const publicCampaignPageLimiter = options.publicCampaignPageLimiter || createPublicCampaignPageRateLimiter({ now: options.now });
  const maxConcurrentPublicCampaignScans = Number.isInteger(options.maxConcurrentPublicCampaignScans)
    ? Math.max(1, Math.min(4, options.maxConcurrentPublicCampaignScans)) : 2;
  let activePublicCampaignScans = 0;
  const socialOAuthService = options.socialOAuthService || createYouTubeOAuthService({
    env,
    tokenVault: sharedSocialTokenVault,
    fetchImpl: options.socialFetchImpl || options.fetchImpl,
    now: options.now
  });
  const metaSocialService = options.metaSocialService || createMetaSocialService({
    env,
    tokenVault: sharedSocialTokenVault,
    mediaStore: metaMediaStore,
    fetchImpl: options.socialFetchImpl || options.fetchImpl,
    now: options.now,
    sleep: options.metaSleep,
    pollAttempts: options.metaPollAttempts,
    pollIntervalMs: options.metaPollIntervalMs
  });
  const ownsStaticSite = !options.staticSite && env.SERVE_STATIC_APP === "true";
  const staticSite = options.staticSite || (ownsStaticSite
    ? createStaticSite({
      rootDir: options.staticRootDir || __dirname,
      outputDir: env.STATIC_SITE_DIR
    })
    : null);
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

    if (pathname.startsWith("/media/instagram/")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("allow", "GET, HEAD");
        return sendJson(response, 405, { error: "method_not_allowed" });
      }
      const token = pathname.slice("/media/instagram/".length);
      const media = metaMediaStore.get(token);
      if (!media) return sendJson(response, 404, { error: "media_not_found_or_expired" });
      response.writeHead(200, {
        "content-type": media.mimeType,
        "content-length": String(media.size),
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
        "content-disposition": "inline"
      });
      return response.end(request.method === "HEAD" ? undefined : media.buffer);
    }

    if (pathname.startsWith("/api/social/")) {
      const sessionId = parseCookie(request, socialSessionCookieName(env));
      const isNavigationRoute = pathname === "/api/social/youtube/connect" || pathname === "/api/social/youtube/callback" || pathname === "/api/social/meta/connect" || pathname === "/api/social/meta/callback";

      if (isNavigationRoute && request.headers.origin && !allowedSocialOrigins(env).includes(request.headers.origin)) {
        return sendJson(response, 403, { error: "origin_not_allowed" });
      }
      if (!isNavigationRoute && !applySocialCors(request, response, env)) {
        return sendJson(response, 403, { error: "origin_not_allowed" });
      }
      if (request.method === "OPTIONS" && !isNavigationRoute) {
        response.writeHead(204, {
          "cache-control": "no-store",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "Accept, Content-Type, X-AI-Commerce-Action"
        });
        return response.end();
      }

      if (pathname === "/api/social/youtube/connect") {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET");
          return sendJson(response, 405, { error: "method_not_allowed" });
        }
        const started = socialOAuthService.createAuthorizationRequest(sessionId);
        if (!started.ok) return sendJson(response, 503, {
          error: "youtube_oauth_not_configured",
          missing: started.missing || [],
          status: started.error
        });
        return socialRedirect(response, started.url, started.setCookie ? buildSessionCookie(started.sessionId, env) : "");
      }

      if (pathname === "/api/social/youtube/callback") {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET");
          return sendJson(response, 405, { error: "method_not_allowed" });
        }
        const url = new URL(request.url ?? "/", "http://localhost");
        const result = await socialOAuthService.completeAuthorization({
          state: url.searchParams.get("state") || "",
          code: url.searchParams.get("code") || "",
          providerError: url.searchParams.get("error") || "",
          sessionId
        });
        const destination = socialOAuthService.buildReturnUrl(
          result.ok ? "success" : "error",
          result.ok ? "" : result.error
        );
        if (!destination) return sendJson(response, 503, { error: "social_return_url_not_configured" });
        return socialRedirect(response, destination);
      }

      if (pathname === "/api/social/meta/connect") {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET");
          return sendJson(response, 405, { error: "method_not_allowed" });
        }
        const started = metaSocialService.createAuthorizationRequest(sessionId);
        if (!started.ok) return sendJson(response, 503, {
          error: started.error || "meta_oauth_not_configured",
          missing: started.missing || []
        });
        return socialRedirect(response, started.url, started.setCookie ? buildSessionCookie(started.sessionId, env) : "");
      }

      if (pathname === "/api/social/meta/callback") {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET");
          return sendJson(response, 405, { error: "method_not_allowed" });
        }
        const url = new URL(request.url ?? "/", "http://localhost");
        const result = await metaSocialService.completeAuthorization({
          state: url.searchParams.get("state") || "",
          code: url.searchParams.get("code") || "",
          providerError: url.searchParams.get("error") || "",
          sessionId
        });
        const destination = metaSocialService.buildReturnUrl(
          result.ok ? "success" : "error",
          result.ok ? "" : result.error
        );
        if (!destination) return sendJson(response, 503, { error: "social_return_url_not_configured" });
        return socialRedirect(response, destination);
      }

      if (pathname === "/api/social/meta/disconnect") {
        if (request.method !== "POST") {
          response.setHeader("allow", "POST, OPTIONS");
          return sendJson(response, 405, { error: "method_not_allowed" });
        }
        if (!sessionId || !request.headers.origin || !allowedSocialOrigins(env).includes(request.headers.origin) ||
            request.headers["x-ai-commerce-action"] !== "meta-disconnect") {
          return sendJson(response, 403, { error: "social_request_not_authorized" });
        }
        try {
          metaSocialService.disconnect(sessionId);
          return sendJson(response, 200, { provider: "meta", status: "not_connected" });
        } catch (_) {
          return sendJson(response, 503, { error: "social_disconnect_failed" });
        }
      }

      if (pathname === "/api/social/meta/facebook/publish" || pathname === "/api/social/meta/instagram/publish") {
        if (request.method !== "POST") {
          response.setHeader("allow", "POST, OPTIONS");
          return sendJson(response, 405, { error: "method_not_allowed" });
        }
        if (!sessionId || !request.headers.origin || !allowedSocialOrigins(env).includes(request.headers.origin) ||
            request.headers["x-ai-commerce-action"] !== "meta-publish" ||
            !String(request.headers["content-type"] || "").toLowerCase().startsWith("video/")) {
          return sendJson(response, 403, { error: "social_request_not_authorized" });
        }
        const url = new URL(request.url ?? "/", "http://localhost");
        const provider = pathname.includes("/instagram/") ? "instagram" : "facebook";
        try {
          const video = await readRawBody(request, 50 * 1024 * 1024);
          const input = {
            video,
            mimeType: String(request.headers["content-type"]).split(";")[0].trim(),
            pageId: url.searchParams.get("pageId") || "",
            title: url.searchParams.get("title") || "",
            caption: url.searchParams.get("caption") || "",
            durationSeconds: Number(url.searchParams.get("durationSeconds"))
          };
          const result = provider === "instagram"
            ? await metaSocialService.uploadInstagramReel(sessionId, input)
            : await metaSocialService.uploadFacebookReel(sessionId, input);
          return sendJson(response, result.ok ? 201 : 400, result);
        } catch (error) {
          return sendJson(response, String(error && error.message) === "request_body_too_large" ? 413 : 400, {
            error: String(error && error.message) === "request_body_too_large" ? "video_too_large_max_50mb" : "meta_video_upload_request_failed"
          });
        }
      }

      if (pathname === "/api/social/meta/facebook/status") {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET, OPTIONS");
          return sendJson(response, 405, { error: "method_not_allowed" });
        }
        if (!sessionId || !request.headers.origin || !allowedSocialOrigins(env).includes(request.headers.origin)) {
          return sendJson(response, 403, { error: "social_request_not_authorized" });
        }
        const url = new URL(request.url ?? "/", "http://localhost");
        try {
          const result = await metaSocialService.getFacebookReelStatus(sessionId, {
            pageId: url.searchParams.get("pageId") || "",
            videoId: url.searchParams.get("videoId") || ""
          });
          return sendJson(response, result.ok ? 200 : (result.error === "reconnect_required" ? 401 : 400), result);
        } catch (_) {
          return sendJson(response, 503, { ok: false, error: "facebook_video_status_unavailable" });
        }
      }

      if (pathname === "/api/social/connections") {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET, OPTIONS");
          return sendJson(response, 405, { error: "method_not_allowed" });
        }
        try {
          const youtube = await socialOAuthService.getConnection(sessionId);
          const meta = metaSocialService.getConnection(sessionId);
          return sendJson(response, 200, { connections: [youtube, meta] });
        } catch (_) {
          return sendJson(response, 503, { error: "social_connection_status_unavailable" });
        }
      }

      if (pathname === "/api/social/youtube/status") {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET, OPTIONS");
          return sendJson(response, 405, { error: "method_not_allowed" });
        }
        if (!sessionId || !request.headers.origin || !allowedSocialOrigins(env).includes(request.headers.origin)) {
          return sendJson(response, 403, { error: "social_request_not_authorized" });
        }
        const url = new URL(request.url ?? "/", "http://localhost");
        try {
          const result = await socialOAuthService.getVideoStatus(sessionId, url.searchParams.get("videoId") || "");
          return sendJson(response, result.ok ? 200 : (result.error === "not_connected" || result.error === "reconnect_required" ? 401 : 400), result);
        } catch (_) {
          return sendJson(response, 503, { ok: false, error: "youtube_video_status_unavailable" });
        }
      }

      if (pathname === "/api/social/youtube/publish") {
        if (request.method !== "POST") {
          response.setHeader("allow", "POST, OPTIONS");
          return sendJson(response, 405, { error: "method_not_allowed" });
        }
        if (!sessionId || !request.headers.origin || !allowedSocialOrigins(env).includes(request.headers.origin) ||
            request.headers["x-ai-commerce-action"] !== "youtube-publish" ||
            !String(request.headers["content-type"] || "").toLowerCase().startsWith("video/")) {
          return sendJson(response, 403, { error: "social_request_not_authorized" });
        }
        const url = new URL(request.url ?? "/", "http://localhost");
        const title = url.searchParams.get("title") || "";
        const description = url.searchParams.get("description") || "";
        const privacyStatus = url.searchParams.get("privacy") || "private";
        try {
          const video = await readRawBody(request, 64 * 1024 * 1024);
          const result = await socialOAuthService.uploadVideo(sessionId, {
            video,
            mimeType: String(request.headers["content-type"]).split(";")[0].trim(),
            title,
            description,
            privacyStatus
          });
          return sendJson(response, result.ok ? 201 : 400, result);
        } catch (error) {
          return sendJson(response, String(error && error.message) === "request_body_too_large" ? 413 : 400, {
            error: String(error && error.message) === "request_body_too_large" ? "video_too_large_max_64mb" : "video_upload_request_failed"
          });
        }
      }

      if (pathname === "/api/social/youtube/disconnect") {
        if (request.method !== "POST") {
          response.setHeader("allow", "POST, OPTIONS");
          return sendJson(response, 405, { error: "method_not_allowed" });
        }
        if (!sessionId || !request.headers.origin || !allowedSocialOrigins(env).includes(request.headers.origin) ||
            request.headers["x-ai-commerce-action"] !== "social-disconnect") {
          return sendJson(response, 403, { error: "social_request_not_authorized" });
        }
        try {
          socialOAuthService.disconnect(sessionId);
          return sendJson(response, 200, { provider: "youtube", status: "not_connected" });
        } catch (_) {
          return sendJson(response, 503, { error: "social_disconnect_failed" });
        }
      }

      if (pathname === "/api/social/providers") {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET, OPTIONS");
          return sendJson(response, 405, { error: "method_not_allowed" });
        }
        return sendJson(response, 200, {
          providers: [
            getProviderReadiness("instagram", env),
            getProviderReadiness("meta", env),
            getProviderReadiness("youtube", env)
          ],
          youtubeOAuth: socialOAuthService.getReadiness(),
          metaOAuth: metaSocialService.getReadiness(),
          note: "YouTube OAuth/upload is available after Google backend setup. Meta OAuth can connect Facebook Pages and linked Instagram Professional accounts; publishing is available after Meta app review/permissions and backend credentials are configured. Content Rewards account verification and Submit Clip remain in Content Rewards."
        });
      }

      return sendJson(response, 404, { error: "not_found" });
    }

    if (pathname.startsWith("/api/discovery/")) {
      if (!applyDiscoveryCors(request, response, env)) {
        return sendJson(response, 403, { error: "origin_not_allowed" });
      }
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "cache-control": "no-store",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "Accept, Content-Type"
        });
        return response.end();
      }
      if (pathname === "/api/discovery/analyze-public-campaign") {
        if (request.method !== "POST") {
          response.setHeader("allow", "POST, OPTIONS");
          return sendJson(response, 405, { error: "method_not_allowed" });
        }
        const quota = publicCampaignPageLimiter.consume(request.socket && request.socket.remoteAddress || "unknown");
        if (!quota.allowed) {
          response.setHeader("retry-after", String(quota.retryAfterSeconds));
          return sendJson(response, 429, { error: "public_campaign_scan_rate_limited", message: "Too many live campaign-page scans. Wait before trying again.", retryAfterSeconds: quota.retryAfterSeconds });
        }
        if (activePublicCampaignScans >= maxConcurrentPublicCampaignScans) {
          response.setHeader("retry-after", "5");
          return sendJson(response, 429, { error: "public_campaign_scan_busy", message: "The public campaign scanner is busy. Try again shortly." });
        }
        if (!/^application\/json(?:\s*;|$)/i.test(String(request.headers["content-type"] || ""))) {
          return sendJson(response, 415, { error: "json_required", message: "Send the public campaign URL as a JSON body." });
        }
        activePublicCampaignScans += 1;
        try {
          const raw = await readRawBody(request, 4096);
          let input;
          try { input = JSON.parse(raw.toString("utf8")); }
          catch (_) { return sendJson(response, 400, { error: "invalid_json", message: "The request must contain valid JSON." }); }
          const suppliedUrl = input && typeof input.url === "string" ? input.url.trim() : "";
          if (!suppliedUrl || suppliedUrl.length > 500) return sendJson(response, 400, { error: "invalid_campaign_url", message: "Provide one public campaign URL (500 characters maximum)." });
          const campaignUrl = PublicCampaignScanner.canonicalPublicCampaignDetailUrl(suppliedUrl);
          if (!campaignUrl) return sendJson(response, 400, {
            error: "unsupported_campaign_url",
            message: "Only public HTTPS Content Rewards /c/campaigns/{id} pages are supported."
          });
          const scanNow = typeof options.now === "function" ? options.now() : options.now;
          const detail = await publicCampaignPageFetcher(campaignUrl, {
            fetchImpl: options.publicCampaignFetchImpl || globalThis.fetch,
            now: scanNow,
            timeoutMs: 10000
          });
          if (!detail || detail.status !== "ok" || detail.url !== campaignUrl ||
              typeof detail.pageText !== "string" || detail.pageText.trim().length < 20 || detail.pageText.length > 20000) {
            return sendJson(response, 502, { error: "public_campaign_scan_invalid_result", message: "The scanner did not return a valid readable public campaign page." });
          }
          return sendJson(response, 200, {
            sourceVerification: "official-public-page",
            detail,
            note: "Fetched from the public campaign page without Content Rewards login, cookies or private account data."
          });
        } catch (error) {
          const message = String(error && error.message || "Public campaign scan failed.").slice(0, 300);
          const status = message === "request_body_too_large" ? 413 : /timed out/i.test(message) ? 504 : 422;
          return sendJson(response, status, {
            error: status === 504 ? "public_campaign_scan_timeout" : status === 413 ? "request_too_large" : "public_campaign_scan_failed",
            message: status === 413 ? "The request exceeded the 4 KB limit." : message
          });
        } finally {
          activePublicCampaignScans = Math.max(0, activePublicCampaignScans - 1);
        }
      }
      if (request.method !== "GET") {
        response.setHeader("allow", "GET, POST, OPTIONS");
        return sendJson(response, 405, { error: "method_not_allowed" });
      }

      try {
        if (pathname === "/api/discovery/status") {
          return sendJson(response, 200, await discoveryService.getStatus());
        }
        if (pathname === "/api/discovery/campaigns") {
          const url = new URL(request.url ?? "/", "http://localhost");
          const result = await discoveryService.getCampaigns({
            platform: url.searchParams.get("platform") || "",
            search: url.searchParams.get("search") || "",
            limit: url.searchParams.get("limit") || "100"
          });
          return sendJson(response, 200, result);
        }
        if (pathname === "/api/discovery/sources") {
          const status = await discoveryService.getStatus();
          return sendJson(response, 200, {
            sources: status.sourceRegistry,
            scheduler: status.scheduler,
            intervalMinutes: status.intervalMinutes
          });
        }
        return sendJson(response, 404, { error: "not_found" });
      } catch (_) {
        return sendJson(response, 503, { error: "discovery_unavailable", message: "Discovery data is temporarily unavailable." });
      }
    }

    if (pathname === "/health") {
      if (!["GET", "HEAD"].includes(request.method)) {
        response.setHeader("allow", "GET, HEAD");
        return sendJson(response, 405, { error: "method_not_allowed" });
      }
      const payload = {
        ok: true,
        service: "ai-commerce-hub-social-api",
        oauthImplemented: true,
        staticAppServed: Boolean(staticSite)
      };
      if (request.method === "HEAD") {
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff"
        });
        return response.end();
      }
      return sendJson(response, 200, payload);
    }

    if (staticSite && staticSite.handle(request, response)) return;

    if (request.method !== "GET") {
      response.setHeader("allow", "GET, HEAD");
      return sendJson(response, 405, { error: "method_not_allowed" });
    }

    return sendJson(response, 404, { error: "not_found" });
  });

  if (ownsDiscoveryService) server.on("close", () => discoveryService.stop());
  if (ownsStaticSite) server.on("close", () => staticSite.dispose());
  if (env.DISCOVERY_SCHEDULER_ENABLED === "true") discoveryService.start();
  return server;
}

function getListenConfig(env = process.env) {
  const rawPort = typeof env.PORT === "string" && env.PORT.trim()
    ? env.PORT.trim()
    : env.PORT ?? 3000;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }

  const configuredHost = typeof env.HOST === "string" ? env.HOST.trim() : "";
  const host = configuredHost || (env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  if (/\s|[/?#]/.test(host)) {
    throw new Error("HOST must be a hostname or IP address without whitespace or URL path characters");
  }

  return { host, port };
}

function startServer(options = {}) {
  const env = options.env ?? process.env;
  const { host, port } = getListenConfig(env);
  const server = createServer({ ...options, env });
  const write = typeof options.write === "function"
    ? options.write
    : (message) => process.stdout.write(message);

  server.listen(port, host, () => {
    write("AI Commerce Hub API listening on " + host + ":" + port + "\\n");
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  sendJson, allowedOrigins, applyDiscoveryCors, allowedSocialOrigins, applySocialCors, readRawBody,
  createPublicCampaignPageRateLimiter, socialSessionCookieName, parseCookie, buildSessionCookie, createServer, getListenConfig, startServer
};
