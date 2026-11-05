import { httpServerHandler } from "cloudflare:node";
import factory from "./worker-factory.js";

let handler;

export default {
  fetch(request, env) {
    try {
      if (!handler) handler = factory.createCloudflareHandler(env, httpServerHandler);
      return handler(request);
    } catch (error) {
      // Keep detailed initialization errors in Worker logs only; never echo secrets or stack traces to callers.
      const safeError = String(error && error.message || error || "unknown_initialization_error").slice(0, 240);
      console.error("ClipReward Cloudflare Worker initialization failed:", String(error && error.stack || safeError).slice(0, 2500));
      return Response.json({
        ok: false,
        error: "cloudflare_backend_not_configured",
        message: "The persistent backend bindings or required Worker secrets are not configured.",
        ...(env && env.CLIPREWARD_DEBUG_ERRORS === "true" ? { debug: safeError } : {})
      }, { status: 503, headers: { "cache-control": "no-store" } });
    }
  }
};
