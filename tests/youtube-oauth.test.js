"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  REQUIRED_SCOPES,
  createYouTubeOAuthService,
  parseRedirectUri,
  parseReturnUrl,
  sha256
} = require("../youtube-oauth.js");

const ENV = {
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  GOOGLE_REDIRECT_URI: "https://api.example.com/api/social/youtube/callback",
  SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  SOCIAL_TOKEN_STORE_PATH: "/tmp/test-vault.json",
  SOCIAL_CORS_ORIGINS: "https://app.example.com",
  SOCIAL_RETURN_URL: "https://app.example.com/"
};

function makeStore() {
  const records = new Map();
  return {
    get(sessionHash, provider) { return records.get(sessionHash + ":" + provider) || null; },
    set(sessionHash, provider, record) { records.set(sessionHash + ":" + provider, structuredClone(record)); return true; },
    deleteProvider(sessionHash, provider) { return records.delete(sessionHash + ":" + provider); },
    records
  };
}

function jsonResponse(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, async text() { return JSON.stringify(data); } };
}

function tokenResponse(extra = {}) {
  return {
    access_token: "access-token-secret",
    refresh_token: "refresh-token-secret",
    expires_in: 3600,
    token_type: "Bearer",
    scope: REQUIRED_SCOPES.join(" "),
    ...extra
  };
}

test("requires HTTPS callback, a return origin in the CORS allowlist and an encryption key", () => {
  assert.equal(parseRedirectUri("http://api.example.com/api/social/youtube/callback"), null);
  assert.equal(parseRedirectUri("https://api.example.com/elsewhere"), null);
  assert.equal(parseReturnUrl("https://evil.example/", ["https://app.example.com"]), null);
  const store = makeStore();
  const service = createYouTubeOAuthService({ env: { ...ENV, SOCIAL_TOKEN_ENCRYPTION_KEY: "" }, tokenVault: store });
  assert.equal(service.getReadiness().configured, false);
  assert.ok(service.getReadiness().missing.includes("SOCIAL_TOKEN_ENCRYPTION_KEY"));
});

test("requests the read and upload scopes required for channel identification and publishing", () => {
  assert.deepEqual(REQUIRED_SCOPES, [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube.upload"
  ]);
});

test("builds a Google OAuth URL with minimal YouTube scopes, state and PKCE", () => {
  const service = createYouTubeOAuthService({ env: ENV, tokenVault: makeStore(), now: () => 1000 });
  const result = service.createAuthorizationRequest();
  assert.equal(result.ok, true);
  assert.match(result.sessionId, /^[A-Za-z0-9_-]{43}$/);
  const url = new URL(result.url);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("client_id"), ENV.GOOGLE_CLIENT_ID);
  assert.equal(url.searchParams.get("redirect_uri"), ENV.GOOGLE_REDIRECT_URI);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), REQUIRED_SCOPES.join(" "));
  assert.match(url.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
});

test("rejects callback state from a different browser session and prevents replay", async () => {
  const service = createYouTubeOAuthService({ env: ENV, tokenVault: makeStore(), now: () => 1000 });
  const started = service.createAuthorizationRequest();
  const state = new URL(started.url).searchParams.get("state");
  const otherSession = Buffer.from(crypto.randomBytes(32)).toString("base64url");
  assert.deepEqual(await service.completeAuthorization({ state, code: "authorization-code-123", sessionId: otherSession }), {
    ok: false, error: "invalid_or_expired_state"
  });
  assert.deepEqual(await service.completeAuthorization({ state, code: "authorization-code-123", sessionId: started.sessionId }), {
    ok: false, error: "invalid_or_expired_state"
  });
});

test("rejects expired and provider-denied authorizations without exchanging a code", async () => {
  let now = 1000;
  let calls = 0;
  const service = createYouTubeOAuthService({
    env: ENV, tokenVault: makeStore(), now: () => now,
    fetchImpl: async () => { calls += 1; return jsonResponse({}); }
  });
  const expired = service.createAuthorizationRequest();
  const expiredState = new URL(expired.url).searchParams.get("state");
  now += 10 * 60 * 1000;
  assert.equal((await service.completeAuthorization({ state: expiredState, sessionId: expired.sessionId, code: "authorization-code-123" })).error, "invalid_or_expired_state");

  const denied = service.createAuthorizationRequest();
  const deniedState = new URL(denied.url).searchParams.get("state");
  assert.equal((await service.completeAuthorization({ state: deniedState, sessionId: denied.sessionId, providerError: "access_denied" })).error, "access_denied");
  assert.equal(calls, 0);
});

test("exchanges the code, verifies requested scopes and resolves the authorised channel", async () => {
  const store = makeStore();
  const calls = [];
  const service = createYouTubeOAuthService({
    env: ENV, tokenVault: store, now: () => Date.parse("2026-11-01T00:00:00.000Z"),
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      if (url === "https://oauth2.googleapis.com/token") return jsonResponse(tokenResponse());
      return jsonResponse({ items: [{ id: "channel-123", snippet: { title: "Creator channel" } }] });
    }
  });
  const started = service.createAuthorizationRequest();
  const state = new URL(started.url).searchParams.get("state");
  const result = await service.completeAuthorization({ state, sessionId: started.sessionId, code: "authorization-code-123" });
  assert.equal(result.ok, true);
  assert.equal(result.connection.channelId, "channel-123");
  assert.equal(result.connection.channelTitle, "Creator channel");
  assert.equal(result.connection.status, "connected");
  assert.equal(JSON.stringify(result).includes("access-token-secret"), false);
  assert.equal(JSON.stringify(result).includes("refresh-token-secret"), false);
  assert.equal(calls.length, 2);
  assert.match(calls[0].request.body.toString(), /code_verifier=/);
  const stored = store.get(sha256(started.sessionId), "youtube");
  assert.equal(stored.accessToken, "access-token-secret");
  assert.equal(stored.refreshToken, "refresh-token-secret");
  assert.equal((await service.getConnection(started.sessionId)).channelTitle, "Creator channel");
});

test("refuses to connect when required permissions are missing", async () => {
  const store = makeStore();
  const service = createYouTubeOAuthService({
    env: ENV, tokenVault: store,
    fetchImpl: async () => jsonResponse(tokenResponse({ scope: "" }))
  });
  const started = service.createAuthorizationRequest();
  const state = new URL(started.url).searchParams.get("state");
  const result = await service.completeAuthorization({ state, sessionId: started.sessionId, code: "authorization-code-123" });
  assert.deepEqual(result, { ok: false, error: "required_permissions_not_granted" });
  assert.equal(store.records.size, 0);
});

test("refreshes expired access tokens without exposing stored refresh tokens", async () => {
  const store = makeStore();
  let now = 1000000;
  store.set(sha256("0123456789012345678901234567890123456789012"), "youtube", {});
  const sessionId = "0123456789012345678901234567890123456789012";
  store.set(sha256(sessionId), "youtube", {
    accessToken: "expired-access",
    refreshToken: "stored-refresh",
    expiresAt: now - 1,
    scopes: [...REQUIRED_SCOPES],
    channelId: "channel-9",
    channelTitle: "Refresh channel",
    connectedAt: new Date(now - 10000).toISOString()
  });
  const service = createYouTubeOAuthService({
    env: ENV, tokenVault: store, now: () => now,
    fetchImpl: async () => jsonResponse(tokenResponse({ refresh_token: undefined, expires_in: 7200 }))
  });
  const result = await service.getConnection(sessionId);
  assert.equal(result.status, "connected");
  assert.equal(result.channelId, "channel-9");
  assert.equal(result.refreshAvailable, true);
  assert.equal(store.get(sha256(sessionId), "youtube").accessToken, "access-token-secret");
  assert.equal(JSON.stringify(result).includes("stored-refresh"), false);
});

test("reports expired connections as reconnect required when no refresh token is stored", async () => {
  const store = makeStore();
  const sessionId = "1234567890123456789012345678901234567890123";
  store.set(sha256(sessionId), "youtube", {
    accessToken: "access", refreshToken: "", expiresAt: 999,
    scopes: [...REQUIRED_SCOPES], channelId: "id", channelTitle: "Title",
    connectedAt: new Date(0).toISOString()
  });
  const service = createYouTubeOAuthService({ env: ENV, tokenVault: store, now: () => 1000 });
  const result = await service.getConnection(sessionId);
  assert.equal(result.status, "reconnect_required");
});

test("uploads a video through the official resumable API and returns its verified permalink", async () => {
  const store = makeStore();
  const sessionId = "1234567890123456789012345678901234567890123";
  store.set(sha256(sessionId), "youtube", {
    accessToken: "valid-access",
    refreshToken: "valid-refresh",
    expiresAt: Date.now() + 3600000,
    scopes: [...REQUIRED_SCOPES],
    channelId: "channel-upload",
    channelTitle: "Upload channel",
    connectedAt: new Date().toISOString()
  });
  const calls = [];
  const service = createYouTubeOAuthService({
    env: ENV, tokenVault: store,
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      if (url === "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status") {
        return {
          ok: true, status: 200,
          headers: { get(name) { return name.toLowerCase() === "location" ? "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=unit-test" : null; } },
          async text() { return ""; }
        };
      }
      return jsonResponse({ id: "video-987" }, 201);
    }
  });
  const result = await service.uploadVideo(sessionId, {
    video: Buffer.alloc(2048, 7),
    mimeType: "video/mp4",
    title: "Test publish",
    description: "Description",
    privacyStatus: "private"
  });
  assert.equal(result.ok, true);
  assert.equal(result.videoId, "video-987");
  assert.equal(result.url, "https://www.youtube.com/watch?v=video-987");
  assert.equal(result.privacyStatus, "private");
  assert.ok(result.uploadedAt);
  assert.equal("publishedAt" in result, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].request.method, "PUT");
  assert.equal(calls[1].request.body.length, 2048);
  assert.equal(JSON.stringify(result).includes("valid-access"), false);
});

test("video status reports processed public visibility and the provider's actual publishedAt", async () => {
  const store = makeStore();
  const sessionId = "1234567890123456789012345678901234567890123";
  store.set(sha256(sessionId), "youtube", {
    accessToken: "valid-access", refreshToken: "valid-refresh",
    expiresAt: Date.now() + 3600000,
    scopes: [...REQUIRED_SCOPES],
    channelId: "channel-upload", channelTitle: "Upload channel",
    connectedAt: new Date().toISOString()
  });
  let requested = "";
  const service = createYouTubeOAuthService({
    env: ENV, tokenVault: store,
    fetchImpl: async (url, request) => {
      requested = url;
      assert.equal(request.method, "GET");
      assert.equal(request.headers.authorization, "Bearer valid-access");
      return jsonResponse({
        items: [{
          id: "video-987",
          snippet: { publishedAt: "2026-11-02T00:02:00.000Z" },
          status: { uploadStatus: "processed", privacyStatus: "public" },
          processingDetails: { processingStatus: "succeeded" }
        }]
      });
    }
  });
  const result = await service.getVideoStatus(sessionId, "video-987");
  assert.equal(result.ok, true);
  assert.equal(result.processingStatus, "succeeded");
  assert.equal(result.privacyStatus, "public");
  assert.equal(result.publishedAt, "2026-11-02T00:02:00.000Z");
  assert.match(requested, /part=processingDetails%2Cstatus%2Csnippet/);
  assert.match(requested, /id=video-987/);
});

test("a processed private or still-processing video never reports a public timestamp", async () => {
  const store = makeStore();
  const sessionId = "1234567890123456789012345678901234567890123";
  store.set(sha256(sessionId), "youtube", {
    accessToken: "valid-access", refreshToken: "valid-refresh",
    expiresAt: Date.now() + 3600000,
    scopes: [...REQUIRED_SCOPES],
    channelId: "channel-upload", channelTitle: "Upload channel",
    connectedAt: new Date().toISOString()
  });
  const responses = [
    { items: [{ id: "video-987", snippet: { publishedAt: "2026-11-02T00:02:00.000Z" }, status: { uploadStatus: "processed", privacyStatus: "private" }, processingDetails: { processingStatus: "succeeded" } }] },
    { items: [{ id: "video-987", status: { uploadStatus: "uploaded", privacyStatus: "public" }, processingDetails: { processingStatus: "processing" } }] }
  ];
  const service = createYouTubeOAuthService({
    env: ENV, tokenVault: store,
    fetchImpl: async () => jsonResponse(responses.shift())
  });
  const privateResult = await service.getVideoStatus(sessionId, "video-987");
  assert.equal(privateResult.privacyStatus, "private");
  assert.equal(privateResult.publishedAt, "");
  const processingResult = await service.getVideoStatus(sessionId, "video-987");
  assert.equal(processingResult.processingStatus, "processing");
  assert.equal(processingResult.publishedAt, "");
});

test("video status validates YouTube video IDs and requires the readonly scope", async () => {
  const store = makeStore();
  const sessionId = "1234567890123456789012345678901234567890123";
  store.set(sha256(sessionId), "youtube", {
    accessToken: "valid-access", refreshToken: "valid-refresh",
    expiresAt: Date.now() + 3600000,
    scopes: ["https://www.googleapis.com/auth/youtube.upload"],
    channelId: "channel-upload", channelTitle: "Upload channel",
    connectedAt: new Date().toISOString()
  });
  let calls = 0;
  const service = createYouTubeOAuthService({
    env: ENV, tokenVault: store,
    fetchImpl: async () => { calls += 1; return jsonResponse({ items: [] }); }
  });
  assert.deepEqual(await service.getVideoStatus(sessionId, "bad id"), { ok: false, error: "invalid_video_id" });
  assert.deepEqual(await service.getVideoStatus(sessionId, "video-987"), { ok: false, error: "video_status_permission_required" });
  assert.equal(calls, 0);
});

test("does not publish when upload scope is missing", async () => {
  const store = makeStore();
  const sessionId = "1234567890123456789012345678901234567890123";
  store.set(sha256(sessionId), "youtube", {
    accessToken: "valid-access", refreshToken: "valid-refresh",
    expiresAt: Date.now() + 3600000,
    scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
    channelId: "channel-readonly", channelTitle: "Read only",
    connectedAt: new Date().toISOString()
  });
  let calls = 0;
  const service = createYouTubeOAuthService({
    env: ENV, tokenVault: store,
    fetchImpl: async () => { calls += 1; return jsonResponse({}); }
  });
  const result = await service.uploadVideo(sessionId, {
    video: Buffer.alloc(2048), mimeType: "video/mp4", title: "No permission"
  });
  assert.deepEqual(result, { ok: false, error: "upload_permission_required" });
  assert.equal(calls, 0);
});

test("disconnect removes the current browser session's YouTube token record", async () => {
  const store = makeStore();
  const sessionId = "1234567890123456789012345678901234567890123";
  store.set(sha256(sessionId), "youtube", { accessToken: "token" });
  const service = createYouTubeOAuthService({ env: ENV, tokenVault: store });
  assert.equal(await service.disconnect(sessionId), true);
  assert.equal(await service.disconnect(sessionId), false);
  assert.equal(store.records.size, 0);
});
