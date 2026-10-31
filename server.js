"use strict";

const http = require("node:http");
const { getProviderReadiness } = require("./social-provider-readiness.js");
const { createFileStore } = require("./discovery-store.js");
const { createDiscoveryService } = require("./discovery-service.js");

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
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

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
        oauthImplemented: false
      });
    }

    if (pathname === "/api/social/providers") {
      return sendJson(response, 200, {
        providers: [
          getProviderReadiness("instagram", env),
          getProviderReadiness("meta", env),
          getProviderReadiness("youtube", env)
        ],
        note: "Configuration readiness only; no accounts are connected and OAuth is not implemented."
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
  if (/\\s|[/?#]/.test(host)) {
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

module.exports = { sendJson, allowedOrigins, applyDiscoveryCors, createServer, getListenConfig, startServer };
