import { httpServerHandler } from "cloudflare:node";
import factory from "./worker-factory.js";

let handler;

export default {
  fetch(request, env) {
    try {
      if (!handler) handler = factory.createCloudflareHandler(env, httpServerHandler);
      return handler(request);
    } catch (_) {
      return Response.json({
        ok: false,
        error: "cloudflare_backend_not_configured",
        message: "The persistent backend bindings or required Worker secrets are not configured."
      }, { status: 503, headers: { "cache-control": "no-store" } });
    }
  }
};
