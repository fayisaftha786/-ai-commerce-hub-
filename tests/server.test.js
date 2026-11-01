"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer, getListenConfig, buildSessionCookie } = require("../server.js");

async function withServer(run, options = {}) {
  const server = createServer({
    ...options,
    env: {
      META_APP_SECRET: "sentinel-meta-secret-value",
      GOOGLE_CLIENT_SECRET: "sentinel-google-secret-value",
      ...(options.env || {})
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run("http://127.0.0.1:" + address.port);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("development server defaults to loopback and the standard port", () => {
  assert.deepEqual(getListenConfig({}), { host: "127.0.0.1", port: 3000 });
});

test("production server binds to all interfaces for container hosting", () => {
  assert.deepEqual(
    getListenConfig({ NODE_ENV: "production", PORT: "8080" }),
    { host: "0.0.0.0", port: 8080 }
  );
});

test("explicit HOST overrides the production default", () => {
  assert.deepEqual(
    getListenConfig({ NODE_ENV: "production", HOST: "127.0.0.1", PORT: "4000" }),
    { host: "127.0.0.1", port: 4000 }
  );
});

test("rejects invalid ports and host strings before listening", () => {
  for (const PORT of ["0", "65536", "not-a-port"]) {
    assert.throws(() => getListenConfig({ PORT }), /PORT must be an integer/);
  }
  for (const HOST of ["bad host", "https://example.com/path", "/tmp/socket"]) {
    assert.throws(() => getListenConfig({ HOST }), /HOST must be a hostname or IP address/);
  }
});

test("health endpoint confirms API status and reports implemented OAuth routes", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/health");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      ok: true,
      service: "ai-commerce-hub-social-api",
      oauthImplemented: true,
      staticAppServed: false
    });
  });
});

test("provider endpoint returns readiness without leaking credential values", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/social/providers");
    const data = await response.json();
    const serialized = JSON.stringify(data);
    assert.equal(response.status, 200);
    assert.equal(data.providers.length, 3);
    assert.equal(data.providers[0].provider, "instagram");
    assert.equal(data.providers[0].configured, false);
    assert.match(data.note, /YouTube OAuth routes are implemented/i);
    assert.equal(data.youtubeOAuth.configured, false);
    assert.ok(data.youtubeOAuth.missing.includes("GOOGLE_CLIENT_ID"));
    assert.equal(data.providers[0].configured, false);
    assert.equal(serialized.includes("sentinel-meta-secret-value"), false);
    assert.equal(serialized.includes("sentinel-google-secret-value"), false);
    assert.match(data.note, /Instagram and Facebook OAuth are not implemented yet/i);
  });
});


function fakeYouTubeOAuth() {
  const calls = [];
  const sessionId = "a".repeat(43);
  return {
    calls,
    sessionId,
    getReadiness() { return { provider: "youtube", configured: true, missing: [], status: "oauth_ready_not_connected" }; },
    createAuthorizationRequest(existing) {
      calls.push({ action: "start", existing });
      return { ok: true, url: "https://accounts.google.com/o/oauth2/v2/auth?state=fake", sessionId, setCookie: !existing };
    },
    async completeAuthorization(input) {
      calls.push({ action: "callback", input });
      return { ok: true, connection: { provider: "youtube", status: "connected", channelTitle: "Test channel" } };
    },
    async getConnection(id) {
      calls.push({ action: "status", id });
      return id ? { provider: "youtube", status: "connected", channelTitle: "Test channel" } : { provider: "youtube", status: "not_connected" };
    },
    disconnect(id) {
      calls.push({ action: "disconnect", id });
      return Boolean(id);
    },
    buildReturnUrl(outcome, reason) {
      const url = new URL("https://app.example.com/");
      url.searchParams.set("social_connect", outcome);
      if (reason) url.searchParams.set("social_reason", reason);
      return url.href;
    }
  };
}

test("YouTube connect starts a server-side OAuth flow and sets an HttpOnly session cookie", async () => {
  const oauth = fakeYouTubeOAuth();
  await withServer(async (base) => {
    const response = await fetch(base + "/api/social/youtube/connect", {
      headers: { Origin: "https://app.example.com" },
      redirect: "manual"
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "https://accounts.google.com/o/oauth2/v2/auth?state=fake");
    const cookie = response.headers.get("set-cookie");
    assert.match(cookie, /__Host-aihub_session=a{43}/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=None/);
    assert.equal(oauth.calls[0].action, "start");
  }, {
    env: { NODE_ENV: "production", SOCIAL_CORS_ORIGINS: "https://app.example.com" },
    socialOAuthService: oauth
  });
});

test("YouTube callback binds the state to the browser cookie and redirects without exposing the auth code", async () => {
  const oauth = fakeYouTubeOAuth();
  await withServer(async (base) => {
    const response = await fetch(base + "/api/social/youtube/callback?code=temporary-auth-code&state=opaque-state", {
      headers: { Cookie: "__Host-aihub_session=" + oauth.sessionId },
      redirect: "manual"
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "https://app.example.com/?social_connect=success");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(oauth.calls[0].input.sessionId, oauth.sessionId);
    assert.equal(oauth.calls[0].input.code, "temporary-auth-code");
  }, {
    env: { NODE_ENV: "production", SOCIAL_CORS_ORIGINS: "https://app.example.com" },
    socialOAuthService: oauth
  });
});

test("connection status enables credentialed CORS only for the exact app origin", async () => {
  const oauth = fakeYouTubeOAuth();
  await withServer(async (base) => {
    const allowed = await fetch(base + "/api/social/connections", {
      headers: { Origin: "https://app.example.com", Cookie: "aihub_session=" + oauth.sessionId }
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://app.example.com");
    assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");
    assert.deepEqual((await allowed.json()).connections[0], {
      provider: "youtube", status: "connected", channelTitle: "Test channel"
    });
    const rejected = await fetch(base + "/api/social/connections", { headers: { Origin: "https://evil.example" } });
    assert.equal(rejected.status, 403);
  }, {
    env: { SOCIAL_CORS_ORIGINS: "https://app.example.com" },
    socialOAuthService: oauth
  });
});

test("YouTube disconnect requires the exact allowlisted origin and action header", async () => {
  const oauth = fakeYouTubeOAuth();
  await withServer(async (base) => {
    const missingHeader = await fetch(base + "/api/social/youtube/disconnect", {
      method: "POST", headers: { Origin: "https://app.example.com", Cookie: "aihub_session=" + oauth.sessionId }
    });
    assert.equal(missingHeader.status, 403);
    const response = await fetch(base + "/api/social/youtube/disconnect", {
      method: "POST",
      headers: {
        Origin: "https://app.example.com",
        Cookie: "aihub_session=" + oauth.sessionId,
        "X-AI-Commerce-Action": "social-disconnect"
      }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { provider: "youtube", status: "not_connected" });
    assert.equal(oauth.calls.filter((call) => call.action === "disconnect").length, 1);
  }, {
    env: { SOCIAL_CORS_ORIGINS: "https://app.example.com" },
    socialOAuthService: oauth
  });
});

test("OAuth connect rejects browser origins outside the exact allowlist", async () => {
  const oauth = fakeYouTubeOAuth();
  await withServer(async (base) => {
    const response = await fetch(base + "/api/social/youtube/connect", {
      headers: { Origin: "https://evil.example" }
    });
    assert.equal(response.status, 403);
  }, {
    env: { SOCIAL_CORS_ORIGINS: "https://app.example.com" },
    socialOAuthService: oauth
  });
});

test("social API preflight allows credentialed requests only from configured app origins", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/social/youtube/disconnect", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "x-ai-commerce-action"
      }
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://app.example.com");
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
    assert.match(response.headers.get("access-control-allow-headers"), /X-AI-Commerce-Action/i);
  }, { env: { SOCIAL_CORS_ORIGINS: "https://app.example.com" } });
});


test("disconnect rejects requests without a browser-bound session", async () => {
  const oauth = fakeYouTubeOAuth();
  await withServer(async (base) => {
    const response = await fetch(base + "/api/social/youtube/disconnect", {
      method: "POST",
      headers: {
        Origin: "https://app.example.com",
        "X-AI-Commerce-Action": "social-disconnect"
      }
    });
    assert.equal(response.status, 403);
    assert.equal(oauth.calls.filter((call) => call.action === "disconnect").length, 0);
  }, { env: { SOCIAL_CORS_ORIGINS: "https://app.example.com" }, socialOAuthService: oauth });
});

test("YouTube OAuth readiness never returns configured credential values", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/social/providers");
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(body.includes("sentinel-google-secret-value"), false);
    assert.equal(body.includes("SOCIAL_TOKEN_ENCRYPTION_KEY="), false);
  }, {
    env: {
      GOOGLE_CLIENT_ID: "private-google-id",
      GOOGLE_CLIENT_SECRET: "private-google-secret",
      GOOGLE_REDIRECT_URI: "https://api.example.com/api/social/youtube/callback",
      SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"),
      SOCIAL_TOKEN_STORE_PATH: "/tmp/unused-test-vault.json",
      SOCIAL_CORS_ORIGINS: "https://app.example.com",
      SOCIAL_RETURN_URL: "https://app.example.com/"
    },
    socialTokenVault: {
      get() { return null; }, set() { return true; }, deleteProvider() { return false; }
    }
  });
});

test("rejects non-GET methods", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/health", { method: "POST" });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
    assert.deepEqual(await response.json(), { error: "method_not_allowed" });
  });
});

test("returns JSON 404 for unknown routes", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/missing");
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not_found" });
  });
});

function fakeDiscovery() {
  return {
    async getStatus() {
      return { enabled: true, scheduler: "server-scheduled", intervalMinutes: 360, running: false,
        campaignCount: 1, updatedAt: "2026-10-31T00:00:00.000Z", lastScan: { status: "success", checkedCount: 1, newCount: 1 },
        sourceRegistry: [{ id: "public-feed", mode: "automatic" }] };
    },
    async getCampaigns(options) {
      return { campaigns: [{ id: "one", title: "Campaign one" }], count: 1, totalSaved: 1, receivedFilter: options };
    }
  };
}

test("discovery API exposes scheduler status and source registry without secrets", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/discovery/status");
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.scheduler, "server-scheduled");
    assert.equal(data.lastScan.newCount, 1);
    assert.equal(JSON.stringify(data).includes("sentinel-meta-secret-value"), false);
  }, { discoveryService: fakeDiscovery() });
});

test("discovery campaign endpoint returns bounded read-only campaign snapshots", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/discovery/campaigns?platform=Instagram&search=gaming&limit=20");
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.count, 1);
    assert.deepEqual(data.receivedFilter, { platform: "Instagram", search: "gaming", limit: "20" });
  }, { discoveryService: fakeDiscovery() });
});

test("discovery API allows only explicitly configured browser origins", async () => {
  await withServer(async (base) => {
    const allowed = await fetch(base + "/api/discovery/status", { headers: { Origin: "https://fayisaftha786.github.io" } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://fayisaftha786.github.io");
    const rejected = await fetch(base + "/api/discovery/status", { headers: { Origin: "https://evil.example" } });
    assert.equal(rejected.status, 403);
    assert.deepEqual(await rejected.json(), { error: "origin_not_allowed" });
  }, {
    env: { DISCOVERY_CORS_ORIGINS: "https://fayisaftha786.github.io" },
    discoveryService: fakeDiscovery()
  });
});

test("discovery API preflight is read-only and rejects write methods", async () => {
  await withServer(async (base) => {
    const preflight = await fetch(base + "/api/discovery/campaigns", {
      method: "OPTIONS", headers: { Origin: "https://fayisaftha786.github.io", "Access-Control-Request-Method": "GET" }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://fayisaftha786.github.io");
    const post = await fetch(base + "/api/discovery/status", { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, OPTIONS");
  }, {
    env: { DISCOVERY_CORS_ORIGINS: "https://fayisaftha786.github.io" },
    discoveryService: fakeDiscovery()
  });
});

test("unknown discovery routes return JSON 404", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/discovery/anything");
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not_found" });
  }, { discoveryService: fakeDiscovery() });
});

test("production session cookies can use same-site Lax without losing Secure and HttpOnly", () => {
  const cookie = buildSessionCookie("a".repeat(43), {
    NODE_ENV: "production",
    SOCIAL_COOKIE_SAMESITE: "Lax"
  });
  assert.match(cookie, /^__Host-aihub_session=/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /HttpOnly/);
  assert.doesNotMatch(cookie, /SameSite=None/);
});

test("single-origin mode serves only the assembled public app and keeps API routes dynamic", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ai-commerce-static-server-"));
  try {
    await withServer(async (base) => {
      const home = await fetch(base + "/");
      assert.equal(home.status, 200);
      assert.match(home.headers.get("content-type"), /text\/html/);
      assert.match(await home.text(), /AI Commerce Hub/);
      assert.equal(home.headers.get("cache-control"), "no-cache");

      const css = await fetch(base + "/style.css");
      assert.equal(css.status, 200);
      assert.match(css.headers.get("content-type"), /text\/css/);

      const providers = await fetch(base + "/api/social/providers");
      assert.equal(providers.status, 200);
      assert.match(providers.headers.get("content-type"), /application\/json/);
      assert.equal((await providers.json()).youtubeOAuth.configured, false);

      const health = await fetch(base + "/health");
      assert.equal(health.status, 200);
      assert.equal((await health.json()).staticAppServed, true);

      for (const privatePath of ["/server.js", "/.env.example", "/docs/BACKEND.md"]) {
        const response = await fetch(base + privatePath);
        assert.equal(response.status, 404, privatePath);
      }
    }, {
      env: {
        SERVE_STATIC_APP: "true",
        STATIC_SITE_DIR: path.join(directory, "site")
      }
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Docker deployment defaults to same-origin app/API serving and private persistent token storage", () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, "..", "Dockerfile"), "utf8");
  const ignore = fs.readFileSync(path.join(__dirname, "..", ".dockerignore"), "utf8");
  assert.match(dockerfile, /FROM node:24-alpine/);
  assert.match(dockerfile, /SERVE_STATIC_APP=true/);
  assert.match(dockerfile, /SOCIAL_COOKIE_SAMESITE=Lax/);
  assert.match(dockerfile, /SOCIAL_TOKEN_STORE_PATH=\/data\/social-token-vault\.json/);
  assert.match(dockerfile, /CMD \["node", "server\.js"\]/);
  assert.match(ignore, /^\.env\n\.env\.\*/m);
  assert.match(ignore, /^\.data$/m);
  assert.match(ignore, /^\.git$/m);
});
