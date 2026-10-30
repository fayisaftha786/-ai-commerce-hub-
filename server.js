"use strict";

const http = require("node:http");
const { getProviderReadiness } = require("./social-provider-readiness.js");

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

function createServer(options = {}) {
  const env = options.env ?? process.env;
  return http.createServer((request, response) => {
    if (request.method !== "GET") {
      response.setHeader("allow", "GET");
      return sendJson(response, 405, { error: "method_not_allowed" });
    }

    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
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
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  createServer().listen(port, "127.0.0.1", () => {
    process.stdout.write("Social API starter listening on 127.0.0.1:" + port + "\\n");
  });
}

module.exports = { createServer };
