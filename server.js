"use strict";

const http = require("node:http");
const { getProviderReadiness } = require("./social-provider-readiness.js");
const { createFileStore } = require("./discovery-store.js");
const { createDiscoveryService } = require("./discovery-service.js");
const { createYouTubeOAuthService } = require("./youtube-oauth.js");

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
  response.setHeader("access-control-allow-methods", "GET, OPTIONS");
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
  const secure = env.NODE_ENV === "production" || env.SOCIAL_COOKIE_SECURE === "true";
  const name = socialSessionCookieName(env);
  return name + "=" + sessionId + "; Path=/; Max-Age=2592000; HttpOnly; SameSite=" +
    (secure ? "None; Secure" : "Lax");
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

function createServer(options = {}) {
  const env = options.env ?? process.env;
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
  const socialOAuthService = options.socialOAuthService || createYouTubeOAuthService({
    env,
    tokenVault: options.socialTokenVault,
    fetchImpl: options.socialFetchImpl || options.fetchImpl,
    now: options.now
  });
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

    if (pathname.startsWith("/api/social/")) {
      const sessionId = parseCookie(request, socialSessionCookieName(env));
      const isNavigationRoute = pathname === "/api/social/youtube/connect" || pathname === "/api/social/youtube/callback";

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

      if (pathname === "/api/social/connections") {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET, OPTIONS");
          return sendJson(response, 405, { error: "method_not_allowed" });
        }
        try {
          const youtube = await socialOAuthService.getConnection(sessionId);
          return sendJson(response, 200, { connections: [youtube] });
        } catch (_) {
          return sendJson(response, 503, { error: "social_connection_status_unavailable" });
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
          note: "YouTube OAuth routes are implemented but remain unconfigured until server credentials, HTTPS callback, CORS origin, and encrypted token storage are supplied. Instagram and Facebook OAuth are not implemented yet."
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
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": "Accept, Content-Type"
        });
        return response.end();
      }
      if (request.method !== "GET") {
        response.setHeader("allow", "GET, OPTIONS");
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

    if (request.method !== "GET") {
      response.setHeader("allow", "GET");
      return sendJson(response, 405, { error: "method_not_allowed" });
    }

    if (pathname === "/health") {
      return sendJson(response, 200, {
        ok: true,
        service: "ai-commerce-hub-social-api",
        oauthImplemented: true
      });
    }

    return sendJson(response, 404, { error: "not_found" });
  });

  if (ownsDiscoveryService) server.on("close", () => discoveryService.stop());
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
  sendJson, allowedOrigins, applyDiscoveryCors, allowedSocialOrigins, applySocialCors,
  socialSessionCookieName, parseCookie, buildSessionCookie, createServer, getListenConfig, startServer
};
