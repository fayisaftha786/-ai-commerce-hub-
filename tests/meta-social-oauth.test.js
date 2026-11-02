"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  META_SCOPES,
  parseRedirectUri,
  parsePublicMediaBase,
  graphVersion,
  createMetaSocialService
} = require("../meta-social-oauth.js");

const SESSION = "a".repeat(43);
const PAGE_ID = "1234567890";
const IG_ID = "17841400000000000";
const VIDEO_ID = "9876543210";
const VIDEO = Buffer.from("mock rendered video");
const ENV = {
  META_APP_ID: "meta-app-id",
  META_APP_SECRET: "meta-app-secret",
  META_REDIRECT_URI: "https://api.example.com/api/social/meta/callback",
  META_GRAPH_API_VERSION: "v26.0",
  META_MEDIA_BASE_URL: "https://api.example.com",
  SOCIAL_CORS_ORIGINS: "https://app.example.com",
  SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64")
};

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function makeVault() {
  const records = new Map();
  return {
    records,
    get(hash, provider) { return records.get(hash + ":" + provider) || null; },
    set(hash, provider, record) { records.set(hash + ":" + provider, structuredClone(record)); return true; },
    deleteProvider(hash, provider) { return records.delete(hash + ":" + provider); }
  };
}

function connectedRecord(overrides = {}) {
  return {
    userAccessToken: "user-access-secret",
    expiresAt: Date.parse("2026-12-01T00:00:00.000Z"),
    graphVersion: "v26.0",
    pages: [{
      id: PAGE_ID,
      name: "Creator Page",
      accessToken: "page-access-secret",
      tasks: ["CREATE_CONTENT", "ANALYZE", "MANAGE"],
      instagramAccountId: IG_ID,
      instagramUsername: "creator_handle"
    }],
    connectedAt: Date.parse("2026-11-02T00:00:00.000Z"),
    ...overrides
  };
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(data); }
  };
}

function makeConnectedService(options = {}) {
  const tokenVault = options.tokenVault || makeVault();
  tokenVault.set(sha256(SESSION), "meta", connectedRecord());
  const service = createMetaSocialService({
    env: ENV,
    tokenVault,
    mediaStore: options.mediaStore || { create() { return { url: "https://api.example.com/media/instagram/" + "b".repeat(64), dispose() {} }; } },
    now: () => Date.parse("2026-11-02T00:00:00.000Z"),
    pollAttempts: options.pollAttempts || 4,
    pollIntervalMs: 0,
    sleep: async () => {},
    fetchImpl: options.fetchImpl || (async () => jsonResponse({}))
  });
  return { service, tokenVault };
}

test("validates secure callback URLs, temporary media base URLs and Graph API versions", () => {
  assert.equal(parseRedirectUri(ENV.META_REDIRECT_URI), ENV.META_REDIRECT_URI);
  assert.equal(parseRedirectUri("http://api.example.com/api/social/meta/callback"), "");
  assert.equal(parseRedirectUri("https://api.example.com/other"), "");
  assert.equal(parsePublicMediaBase("https://media.example.com/"), "https://media.example.com");
  assert.equal(parsePublicMediaBase("http://media.example.com/"), "");
  assert.equal(parsePublicMediaBase("https://media.example.com/path"), "");
  assert.equal(graphVersion("v26.0"), "v26.0");
  assert.equal(graphVersion("latest"), "");
});

test("requires app credentials, an HTTPS callback, a token encryption key and Instagram media hosting", () => {
  const vault = makeVault();
  const incomplete = createMetaSocialService({
    env: { ...ENV, META_APP_SECRET: "", META_MEDIA_BASE_URL: "" },
    tokenVault: vault
  });
  const readiness = incomplete.getReadiness();
  assert.equal(readiness.configured, false);
  assert.equal(readiness.facebookReady, false);
  assert.equal(readiness.instagramReady, false);
  assert.ok(readiness.missing.includes("META_APP_SECRET"));
  assert.ok(readiness.instagramMissing.includes("META_MEDIA_BASE_URL"));

  const facebookOnly = createMetaSocialService({
    env: { ...ENV, META_MEDIA_BASE_URL: "" },
    tokenVault: vault
  }).getReadiness();
  assert.equal(facebookOnly.facebookReady, true);
  assert.equal(facebookOnly.instagramReady, false);
});

test("builds a session-bound Meta authorization URL with only publishing permissions", () => {
  const service = createMetaSocialService({ env: ENV, tokenVault: makeVault(), now: () => 1000 });
  const result = service.createAuthorizationRequest();
  assert.equal(result.ok, true);
  assert.match(result.sessionId, /^[A-Za-z0-9_-]{43}$/);
  const url = new URL(result.url);
  assert.equal(url.origin, "https://www.facebook.com");
  assert.equal(url.pathname, "/v26.0/dialog/oauth");
  assert.equal(url.searchParams.get("client_id"), ENV.META_APP_ID);
  assert.equal(url.searchParams.get("redirect_uri"), ENV.META_REDIRECT_URI);
  assert.deepEqual(url.searchParams.get("scope").split(","), META_SCOPES);
  assert.match(url.searchParams.get("state"), /^[A-Za-z0-9_-]{43}$/);
});

test("exchanges a Meta code, discovers linked Pages and Instagram professional account without exposing tokens", async () => {
  const store = makeVault();
  const requests = [];
  const service = createMetaSocialService({
    env: ENV, tokenVault: store, now: () => 1000,
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      requests.push(parsed);
      if (parsed.pathname.endsWith("/oauth/access_token") && parsed.searchParams.get("grant_type") === "fb_exchange_token") {
        return jsonResponse({ access_token: "long-lived-user-secret", expires_in: 5184000 });
      }
      if (parsed.pathname.endsWith("/oauth/access_token")) {
        assert.equal(parsed.searchParams.get("code"), "valid-code-123456");
        return jsonResponse({ access_token: "short-user-secret", expires_in: 3600 });
      }
      if (parsed.pathname.endsWith("/me/accounts")) {
        assert.equal(parsed.searchParams.get("appsecret_proof"), crypto.createHmac("sha256", ENV.META_APP_SECRET).update("long-lived-user-secret").digest("hex"));
        return jsonResponse({ data: [{
          id: PAGE_ID, name: "Creator Page", access_token: "page-token-secret",
          tasks: ["CREATE_CONTENT", "ANALYZE"],
          instagram_business_account: { id: IG_ID, username: "creator_handle" }
        }] });
      }
      throw new Error("unexpected URL " + url);
    }
  });
  const started = service.createAuthorizationRequest();
  const state = new URL(started.url).searchParams.get("state");
  const result = await service.completeAuthorization({ state, code: "valid-code-123456", sessionId: started.sessionId });
  assert.equal(result.ok, true);
  assert.equal(result.connection.status, "connected");
  assert.equal(result.connection.pages[0].id, PAGE_ID);
  assert.equal(result.connection.pages[0].name, "Creator Page");
  assert.equal(result.connection.pages[0].canPublishFacebook, true);
  assert.equal(result.connection.pages[0].instagramUsername, "creator_handle");
  assert.equal(JSON.stringify(result).includes("long-lived-user-secret"), false);
  assert.equal(JSON.stringify(result).includes("page-token-secret"), false);
  const saved = store.get(sha256(started.sessionId), "meta");
  assert.equal(saved.userAccessToken, "long-lived-user-secret");
  assert.equal(saved.pages[0].accessToken, "page-token-secret");
  assert.equal(service.getConnection(started.sessionId).pageCount, 1);
  assert.ok(requests.every((url) => url.protocol === "https:"));
});

test("rejects replayed or cross-session Meta OAuth callbacks before token exchange", async () => {
  let exchanges = 0;
  const service = createMetaSocialService({
    env: ENV, tokenVault: makeVault(),
    fetchImpl: async () => { exchanges += 1; return jsonResponse({ access_token: "token", expires_in: 3600 }); }
  });
  const started = service.createAuthorizationRequest();
  const state = new URL(started.url).searchParams.get("state");
  assert.deepEqual(await service.completeAuthorization({ state, code: "valid-code-123456", sessionId: "b".repeat(43) }), {
    ok: false, error: "invalid_or_expired_state"
  });
  const allowed = await service.completeAuthorization({ state, code: "valid-code-123456", sessionId: started.sessionId });
  assert.equal(allowed.ok, false);
  assert.equal(exchanges, 0);
});

test("publishes a Facebook Page Reel through start, binary upload and finish phases", async () => {
  const requests = [];
  const { service } = makeConnectedService({
    fetchImpl: async (url, init = {}) => {
      requests.push({ url: String(url), init });
      const parsed = new URL(url);
      if (parsed.hostname === "graph.facebook.com" && parsed.pathname.endsWith("/me/video_reels") &&
          parsed.searchParams.get("upload_phase") === "start") {
        assert.equal(parsed.searchParams.get("appsecret_proof"), crypto.createHmac("sha256", ENV.META_APP_SECRET).update("page-access-secret").digest("hex"));
        return jsonResponse({ video_id: VIDEO_ID, upload_url: "https://rupload.facebook.com/video-upload/v26.0/" + VIDEO_ID });
      }
      if (parsed.hostname === "rupload.facebook.com") {
        assert.equal(init.headers.Authorization, "OAuth page-access-secret");
        assert.equal(init.headers.offset, "0");
        assert.equal(init.headers.file_size, String(VIDEO.length));
        assert.deepEqual(init.body, VIDEO);
        return jsonResponse({ success: true });
      }
      if (parsed.hostname === "graph.facebook.com" && parsed.pathname.endsWith("/" + PAGE_ID + "/video_reels") &&
          parsed.searchParams.get("upload_phase") === "finish") {
        assert.equal(parsed.searchParams.get("video_state"), "PUBLISHED");
        assert.equal(parsed.searchParams.get("description"), "Caption #Creator");
        return jsonResponse({ success: true });
      }
      if (parsed.pathname.endsWith("/" + VIDEO_ID)) {
        return jsonResponse({
          id: VIDEO_ID,
          status: { video_status: "ready", publishing_phase: { status: "complete" }, processing_phase: { status: "complete" } },
          permalink_url: "https://www.facebook.com/reel/" + VIDEO_ID + "/",
          created_time: "2026-11-02T00:05:00.000Z"
        });
      }
      throw new Error("unexpected URL " + url);
    }
  });
  const upload = await service.uploadFacebookReel(SESSION, {
    pageId: PAGE_ID, video: VIDEO, mimeType: "video/mp4",
    durationSeconds: 30, title: "Creator video", caption: "Caption #Creator"
  });
  assert.deepEqual(upload, {
    ok: true, provider: "facebook", pageId: PAGE_ID, videoId: VIDEO_ID, status: "processing", published: false
  });
  const status = await service.getFacebookReelStatus(SESSION, { pageId: PAGE_ID, videoId: VIDEO_ID });
  assert.equal(status.published, true);
  assert.equal(status.permalink, "https://www.facebook.com/reel/" + VIDEO_ID + "/");
  assert.equal(status.privacyStatus, "public");
  assert.equal(status.publishedAt, "2026-11-02T00:05:00.000Z");
  assert.equal(requests.length, 4);
});

test("blocks Facebook publishing without Page creation permission or valid Reel specs", async () => {
  const store = makeVault();
  store.set(sha256(SESSION), "meta", connectedRecord({
    pages: [{ id: PAGE_ID, name: "Read-only Page", accessToken: "token", tasks: ["ANALYZE"] }]
  }));
  const service = createMetaSocialService({ env: ENV, tokenVault: store, fetchImpl: async () => jsonResponse({}) });
  assert.deepEqual(await service.uploadFacebookReel(SESSION, {
    pageId: PAGE_ID, video: VIDEO, mimeType: "video/mp4", durationSeconds: 30
  }), { ok: false, error: "facebook_page_create_content_permission_required" });
  const allowedService = makeConnectedService().service;
  assert.equal((await allowedService.uploadFacebookReel(SESSION, {
    pageId: PAGE_ID, video: VIDEO, mimeType: "video/webm", durationSeconds: 30
  })).error, "facebook_reel_requires_mp4_or_mov");
  assert.equal((await allowedService.uploadFacebookReel(SESSION, {
    pageId: PAGE_ID, video: VIDEO, mimeType: "video/mp4", durationSeconds: 3
  })).error, "facebook_reel_duration_must_be_4_to_60_seconds");
});

test("publishes an Instagram Reel only after the public media container is ready", async () => {
  const requests = [];
  let created = 0;
  let disposed = 0;
  const { service } = makeConnectedService({
    mediaStore: {
      create(buffer, mime) {
        assert.deepEqual(buffer, VIDEO);
        assert.equal(mime, "video/mp4");
        created += 1;
        return { url: "https://api.example.com/media/instagram/" + "b".repeat(64), dispose() { disposed += 1; } };
      }
    },
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      requests.push(parsed);
      if (parsed.pathname.endsWith("/" + IG_ID + "/media")) {
        assert.equal(parsed.searchParams.get("media_type"), "REELS");
        assert.equal(parsed.searchParams.get("video_url"), "https://api.example.com/media/instagram/" + "b".repeat(64));
        return jsonResponse({ id: "container12345" });
      }
      if (parsed.pathname.endsWith("/container12345")) {
        return jsonResponse({ status_code: requests.filter((item) => item.pathname.endsWith("/container12345")).length > 1 ? "FINISHED" : "IN_PROGRESS" });
      }
      if (parsed.pathname.endsWith("/" + IG_ID + "/media_publish")) {
        assert.equal(parsed.searchParams.get("creation_id"), "container12345");
        return jsonResponse({ id: "media123456" });
      }
      if (parsed.pathname.endsWith("/media123456")) {
        return jsonResponse({
          id: "media123456",
          permalink: "https://www.instagram.com/reel/AbCdEf123/",
          timestamp: "2026-11-02T00:06:00.000Z"
        });
      }
      throw new Error("unexpected URL " + url);
    }
  });
  const result = await service.uploadInstagramReel(SESSION, {
    pageId: PAGE_ID, video: VIDEO, mimeType: "video/mp4", durationSeconds: 30,
    caption: "A creator Reel #ad"
  });
  assert.equal(result.ok, true);
  assert.equal(result.published, true);
  assert.equal(result.privacyStatus, "public");
  assert.equal(result.permalink, "https://www.instagram.com/reel/AbCdEf123/");
  assert.equal(result.publishedAt, "2026-11-02T00:06:00.000Z");
  assert.equal(created, 1);
  assert.equal(disposed, 1);
});

test("does not publish Instagram Reels when no professional account is linked to the selected Page", async () => {
  const store = makeVault();
  store.set(sha256(SESSION), "meta", connectedRecord({
    pages: [{ id: PAGE_ID, name: "Facebook only", accessToken: "token", tasks: ["CREATE_CONTENT"], instagramAccountId: "" }]
  }));
  const service = createMetaSocialService({ env: ENV, tokenVault: store, mediaStore: { create() { throw new Error("must not create media"); } } });
  const result = await service.uploadInstagramReel(SESSION, {
    pageId: PAGE_ID, video: VIDEO, mimeType: "video/mp4", durationSeconds: 30
  });
  assert.deepEqual(result, { ok: false, error: "instagram_professional_account_not_linked_to_page" });
});

test("disconnect deletes only the Meta Page connection for this browser session", () => {
  const store = makeVault();
  const service = createMetaSocialService({ env: ENV, tokenVault: store });
  store.set(sha256(SESSION), "meta", connectedRecord());
  store.set(sha256(SESSION), "youtube", { accessToken: "youtube-token" });
  assert.equal(service.disconnect(SESSION), true);
  assert.equal(service.getConnection(SESSION).status, "not_connected");
  assert.ok(store.get(sha256(SESSION), "youtube"));
  assert.equal(service.disconnect(SESSION), false);
});
