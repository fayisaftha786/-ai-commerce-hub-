"use strict";

const crypto = require("node:crypto");
const { createEncryptedTokenVault } = require("./social-token-vault.js");

const SESSION_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const GRAPH_VERSION_PATTERN = /^v\d{1,2}\.\d{1,2}$/;
const META_AUTH_BASE = "https://www.facebook.com";
const META_GRAPH_BASE = "https://graph.facebook.com";
const META_RUPLOAD_HOST = "rupload.facebook.com";
const DEFAULT_GRAPH_VERSION = "v26.0";
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const META_SCOPES = Object.freeze([
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish"
]);

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function hmacProof(token, secret) {
  return crypto.createHmac("sha256", secret).update(token).digest("hex");
}

function allowedOrigins(env) {
  return String(env.SOCIAL_CORS_ORIGINS || "").split(",")
    .map((item) => item.trim()).filter(Boolean);
}

function parseRedirectUri(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
        url.search || url.hash || (url.port && url.port !== "443") ||
        url.pathname !== "/api/social/meta/callback") return "";
    return url.href;
  } catch (_) {
    return "";
  }
}

function parsePublicMediaBase(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
        url.search || url.hash || url.pathname !== "/") return "";
    return url.origin;
  } catch (_) {
    return "";
  }
}

function graphVersion(value) {
  const version = String(value || DEFAULT_GRAPH_VERSION).trim();
  return GRAPH_VERSION_PATTERN.test(version) ? version : "";
}

async function readJson(response, maxBytes = 128 * 1024) {
  if (!response || typeof response.text !== "function") throw new Error("meta_provider_unavailable");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("meta_response_too_large");
  let data;
  try { data = JSON.parse(text); } catch (_) { throw new Error("meta_invalid_response"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("meta_invalid_response");
  if (data.error) {
    const error = new Error("meta_api_error");
    error.metaCode = Number(data.error.code) || 0;
    error.metaSubcode = Number(data.error.error_subcode) || 0;
    error.httpStatus = Number(response.status) || 400;
    throw error;
  }
  return data;
}

function cleanPage(page) {
  return {
    id: String(page.id || ""),
    name: String(page.name || "").slice(0, 120),
    accessToken: String(page.access_token || ""),
    tasks: Array.isArray(page.tasks) ? page.tasks.map((value) => String(value).toUpperCase()) : [],
    instagramAccountId: String(page.instagram_business_account && page.instagram_business_account.id || ""),
    instagramUsername: String(page.instagram_business_account && page.instagram_business_account.username || "")
  };
}

function publicConnection(record, status = "connected") {
  return {
    provider: "meta",
    status,
    pageCount: record.pages.length,
    pages: record.pages.map((page) => ({
      id: page.id,
      name: page.name,
      canPublishFacebook: page.tasks.includes("CREATE_CONTENT"),
      instagramAccountId: page.instagramAccountId || "",
      instagramUsername: page.instagramUsername || "",
      canPublishInstagram: Boolean(page.instagramAccountId && page.tasks.includes("CREATE_CONTENT"))
    })),
    tokenExpiresAt: record.expiresAt ? new Date(record.expiresAt).toISOString() : "",
    graphVersion: record.graphVersion
  };
}

function safePermalink(value, hostnames) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && hostnames.includes(url.hostname) &&
      !url.username && !url.password ? url.href : "";
  } catch (_) {
    return "";
  }
}

function createMetaSocialService(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || (() => Date.now());
  const sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const pollAttempts = Number.isSafeInteger(options.pollAttempts) ? Math.max(1, Math.min(60, options.pollAttempts)) : 35;
  const pollIntervalMs = Number.isSafeInteger(options.pollIntervalMs) ? Math.max(0, Math.min(5000, options.pollIntervalMs)) : 2000;
  const apiVersion = graphVersion(env.META_GRAPH_API_VERSION);
  const redirectUri = parseRedirectUri(env.META_REDIRECT_URI);
  const mediaBase = parsePublicMediaBase(env.META_MEDIA_BASE_URL);
  const tokenVault = options.tokenVault || (env.SOCIAL_TOKEN_ENCRYPTION_KEY
    ? createEncryptedTokenVault({
      encryptionKey: env.SOCIAL_TOKEN_ENCRYPTION_KEY,
      filePath: env.SOCIAL_TOKEN_STORE_PATH
    }) : null);
  const pendingStates = new Map();
  const stateTtlMs = 10 * 60 * 1000;

  function getReadiness() {
    const missing = [];
    for (const name of ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI", "SOCIAL_TOKEN_ENCRYPTION_KEY"]) {
      if (typeof env[name] !== "string" || !env[name].trim()) missing.push(name);
    }
    if (env.META_REDIRECT_URI && !redirectUri) missing.push("META_REDIRECT_URI");
    if (!apiVersion) missing.push("META_GRAPH_API_VERSION");
    const mediaMissing = mediaBase ? [] : ["META_MEDIA_BASE_URL"];
    return {
      provider: "meta",
      configured: missing.length === 0 && Boolean(tokenVault),
      missing: missing.concat(!tokenVault && !missing.includes("SOCIAL_TOKEN_ENCRYPTION_KEY")
        ? ["SOCIAL_TOKEN_ENCRYPTION_KEY"] : []),
      facebookReady: missing.length === 0 && Boolean(tokenVault),
      instagramReady: missing.length === 0 && Boolean(tokenVault) && Boolean(mediaBase),
      instagramMissing: mediaMissing,
      graphVersion: apiVersion || ""
    };
  }

  function createSessionId() {
    return crypto.randomBytes(32).toString("base64url");
  }

  function createAuthorizationRequest(existingSessionId = "") {
    const readiness = getReadiness();
    if (!readiness.configured) return { ok: false, error: "meta_oauth_not_configured", missing: readiness.missing };
    const sessionId = SESSION_PATTERN.test(existingSessionId) ? existingSessionId : createSessionId();
    const state = crypto.randomBytes(32).toString("base64url");
    const current = now();
    for (const [key, item] of pendingStates) if (item.expiresAt <= current) pendingStates.delete(key);
    if (pendingStates.size >= 10000) return { ok: false, error: "too_many_pending_authorizations", missing: [] };
    pendingStates.set(state, { sessionHash: sha256(sessionId), expiresAt: current + stateTtlMs });
    const url = new URL("/" + apiVersion + "/dialog/oauth", META_AUTH_BASE);
    url.searchParams.set("client_id", String(env.META_APP_ID).trim());
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("scope", META_SCOPES.join(","));
    url.searchParams.set("auth_type", "rerequest");
    return { ok: true, url: url.href, sessionId, setCookie: sessionId !== existingSessionId };
  }

  function consumeState(state, sessionId) {
    if (typeof state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state) ||
        typeof sessionId !== "string" || !SESSION_PATTERN.test(sessionId)) return false;
    const pending = pendingStates.get(state);
    if (!pending) return false;
    pendingStates.delete(state);
    return pending.expiresAt > now() &&
      crypto.timingSafeEqual(Buffer.from(pending.sessionHash, "hex"), Buffer.from(sha256(sessionId), "hex"));
  }

  function graphUrl(pathname, params = {}, token = "") {
    const url = new URL("/" + apiVersion + "/" + String(pathname).replace(/^\/+/, ""), META_GRAPH_BASE);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    if (token) {
      url.searchParams.set("access_token", token);
      url.searchParams.set("appsecret_proof", hmacProof(token, String(env.META_APP_SECRET)));
    }
    return url;
  }

  async function graphRequest(pathname, input = {}) {
    if (typeof fetchImpl !== "function") throw new Error("meta_provider_unavailable");
    const url = graphUrl(pathname, input.params || {}, input.token || "");
    const response = await fetchImpl(url.href, {
      method: input.method || "GET",
      headers: input.headers || { Accept: "application/json" },
      body: input.body
    });
    const data = await readJson(response);
    if (!response.ok) {
      const error = new Error("meta_api_error");
      error.httpStatus = response.status;
      throw error;
    }
    return data;
  }

  async function exchangeAuthorizationCode(code) {
    const tokenUrl = graphUrl("oauth/access_token", {
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      redirect_uri: redirectUri,
      code
    });
    const shortResponse = await fetchImpl(tokenUrl.href, { headers: { Accept: "application/json" } });
    const shortToken = await readJson(shortResponse);
    if (!shortResponse.ok || typeof shortToken.access_token !== "string" || !shortToken.access_token) {
      throw new Error("meta_token_exchange_failed");
    }
    const longUrl = graphUrl("oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      fb_exchange_token: shortToken.access_token
    });
    const longResponse = await fetchImpl(longUrl.href, { headers: { Accept: "application/json" } });
    const longToken = await readJson(longResponse);
    if (!longResponse.ok || typeof longToken.access_token !== "string" || !longToken.access_token) {
      throw new Error("meta_long_lived_token_exchange_failed");
    }
    return {
      accessToken: longToken.access_token,
      expiresIn: Number(longToken.expires_in) || 0
    };
  }

  async function fetchManagedPages(userToken) {
    const data = await graphRequest("me/accounts", {
      params: { fields: "id,name,access_token,tasks,instagram_business_account{id,username}", limit: 100 },
      token: userToken
    });
    if (!Array.isArray(data.data)) throw new Error("meta_pages_response_invalid");
    const pages = data.data.map(cleanPage).filter((page) => page.id && page.accessToken);
    return pages.slice(0, 100);
  }

  async function completeAuthorization(input = {}) {
    if (!consumeState(input.state, input.sessionId)) return { ok: false, error: "invalid_or_expired_state" };
    if (input.providerError) return {
      ok: false,
      error: input.providerError === "access_denied" ? "access_denied" : "authorization_failed"
    };
    const code = String(input.code || "");
    if (!/^[A-Za-z0-9._-]{8,2048}$/.test(code)) return { ok: false, error: "invalid_authorization_code" };
    const readiness = getReadiness();
    if (!readiness.configured) return { ok: false, error: "meta_oauth_not_configured", missing: readiness.missing };
    try {
      const token = await exchangeAuthorizationCode(code);
      const pages = await fetchManagedPages(token.accessToken);
      if (!pages.length) return { ok: false, error: "no_managed_pages_with_access" };
      const record = {
        userAccessToken: token.accessToken,
        expiresAt: token.expiresIn > 0 ? now() + token.expiresIn * 1000 : 0,
        pages,
        graphVersion: apiVersion,
        connectedAt: now()
      };
      tokenVault.set(sha256(input.sessionId), "meta", record);
      return { ok: true, connection: publicConnection(record) };
    } catch (error) {
      if (error && error.metaCode === 190) return { ok: false, error: "authorization_expired" };
      const message = String(error && error.message || "");
      const allowed = new Set([
        "meta_provider_unavailable", "meta_response_too_large", "meta_invalid_response",
        "meta_token_exchange_failed", "meta_long_lived_token_exchange_failed",
        "meta_pages_response_invalid", "meta_api_error"
      ]);
      return { ok: false, error: allowed.has(message) ? message : "meta_authorization_failed" };
    }
  }

  function getStoredRecord(sessionId) {
    if (typeof sessionId !== "string" || !SESSION_PATTERN.test(sessionId) || !tokenVault) return null;
    return tokenVault.get(sha256(sessionId), "meta");
  }

  function getConnection(sessionId) {
    const record = getStoredRecord(sessionId);
    if (!record) return { provider: "meta", status: "not_connected", pages: [], pageCount: 0 };
    if (record.expiresAt && record.expiresAt <= now()) return publicConnection(record, "reconnect_required");
    return publicConnection(record);
  }

  function getPageRecord(sessionId, pageId, capability) {
    const record = getStoredRecord(sessionId);
    if (!record || (record.expiresAt && record.expiresAt <= now())) return { ok: false, error: "reconnect_required" };
    const id = String(pageId || "");
    if (!/^\d{3,40}$/.test(id)) return { ok: false, error: "invalid_page_id" };
    const page = record.pages.find((item) => item.id === id);
    if (!page) return { ok: false, error: "page_not_connected" };
    if (capability === "facebook" && !page.tasks.includes("CREATE_CONTENT")) {
      return { ok: false, error: "facebook_page_create_content_permission_required" };
    }
    if (capability === "instagram" &&
        (!page.instagramAccountId || !page.tasks.includes("CREATE_CONTENT"))) {
      return { ok: false, error: "instagram_professional_account_not_linked_to_page" };
    }
    return { ok: true, record, page };
  }

  async function uploadFacebookReel(sessionId, input = {}) {
    const video = Buffer.isBuffer(input.video) ? input.video : Buffer.from(input.video || []);
    const mimeType = String(input.mimeType || "").toLowerCase().split(";")[0].trim();
    const duration = Number(input.durationSeconds);
    if (!["video/mp4", "video/quicktime"].includes(mimeType)) return { ok: false, error: "facebook_reel_requires_mp4_or_mov" };
    if (!video.length || video.length > MAX_VIDEO_BYTES) return { ok: false, error: "facebook_reel_video_size_invalid" };
    if (!Number.isFinite(duration) || duration < 4 || duration > 60) return { ok: false, error: "facebook_reel_duration_must_be_4_to_60_seconds" };
    const found = getPageRecord(sessionId, input.pageId, "facebook");
    if (!found.ok) return found;
    const { page } = found;
    try {
      const started = await graphRequest("me/video_reels", {
        method: "POST",
        params: { upload_phase: "start" },
        token: page.accessToken
      });
      const videoId = String(started.video_id || "");
      let uploadUrl;
      try { uploadUrl = new URL(String(started.upload_url || "")); } catch (_) { uploadUrl = null; }
      if (!/^\d{3,60}$/.test(videoId) || !uploadUrl || uploadUrl.protocol !== "https:" ||
          uploadUrl.hostname !== META_RUPLOAD_HOST || uploadUrl.username || uploadUrl.password) {
        return { ok: false, error: "facebook_reel_upload_session_invalid" };
      }
      const uploaded = await fetchImpl(uploadUrl.href, {
        method: "POST",
        headers: {
          Authorization: "OAuth " + page.accessToken,
          offset: "0",
          file_size: String(video.length),
          "Content-Type": "application/octet-stream"
        },
        body: video
      });
      const uploadedData = await readJson(uploaded);
      if (!uploaded.ok || uploadedData.success !== true) return { ok: false, error: "facebook_reel_upload_failed" };
      const title = String(input.title || "").trim().slice(0, 100);
      const description = String(input.caption || "").trim().slice(0, 5000);
      const finished = await graphRequest("me/video_reels", {
        method: "POST",
        params: {
          video_id: videoId,
          upload_phase: "finish",
          video_state: "PUBLISHED",
          title,
          description
        },
        token: page.accessToken
      });
      if (finished.success !== true) return { ok: false, error: "facebook_reel_publish_not_confirmed" };
      return { ok: true, provider: "facebook", pageId: page.id, videoId, status: "processing", published: false };
    } catch (error) {
      if (error && error.metaCode === 190) return { ok: false, error: "reconnect_required" };
      return { ok: false, error: "facebook_reel_publish_failed" };
    }
  }

  async function getFacebookReelStatus(sessionId, input = {}) {
    const found = getPageRecord(sessionId, input.pageId, "facebook");
    if (!found.ok) return found;
    const videoId = String(input.videoId || "");
    if (!/^\d{3,60}$/.test(videoId)) return { ok: false, error: "invalid_facebook_video_id" };
    try {
      const data = await graphRequest(videoId, {
        params: { fields: "id,status,permalink_url,created_time" },
        token: found.page.accessToken
      });
      const status = data.status && typeof data.status === "object" ? data.status : {};
      const videoStatus = String(status.video_status || "");
      const processingStatus = String(status.processing_phase && status.processing_phase.status || "");
      const publishingStatus = String(status.publishing_phase && status.publishing_phase.status || "");
      const url = safePermalink(data.permalink_url, ["www.facebook.com", "facebook.com", "fb.watch"]);
      const publishedAt = new Date(data.created_time || "");
      const published = Boolean(url && !Number.isNaN(publishedAt.getTime()) &&
        (videoStatus === "ready" || videoStatus === "published") &&
        (!publishingStatus || ["complete", "published", "complete_publish"].includes(publishingStatus.toLowerCase())));
      return {
        ok: true,
        provider: "facebook",
        pageId: found.page.id,
        videoId,
        videoStatus: videoStatus || "unknown",
        processingStatus: processingStatus || "unknown",
        publishingStatus: publishingStatus || "unknown",
        published,
        privacyStatus: published ? "public" : "unknown",
        uploadStatus: published ? "processed" : "uploaded",
        permalink: published ? url : "",
        publishedAt: published ? publishedAt.toISOString() : ""
      };
    } catch (error) {
      if (error && error.metaCode === 190) return { ok: false, error: "reconnect_required" };
      return { ok: false, error: "facebook_video_status_unavailable" };
    }
  }

  async function uploadInstagramReel(sessionId, input = {}) {
    const video = Buffer.isBuffer(input.video) ? input.video : Buffer.from(input.video || []);
    const mimeType = String(input.mimeType || "").toLowerCase().split(";")[0].trim();
    const duration = Number(input.durationSeconds);
    if (!getReadiness().instagramReady) return { ok: false, error: "instagram_media_host_not_configured" };
    if (!["video/mp4", "video/quicktime"].includes(mimeType)) return { ok: false, error: "instagram_reel_requires_mp4_or_mov" };
    if (!video.length || video.length > MAX_VIDEO_BYTES) return { ok: false, error: "instagram_reel_video_size_invalid" };
    if (!Number.isFinite(duration) || duration < 3 || duration > 900) return { ok: false, error: "instagram_reel_duration_invalid" };
    const found = getPageRecord(sessionId, input.pageId, "instagram");
    if (!found.ok) return found;
    const mediaStore = options.mediaStore;
    if (!mediaStore || typeof mediaStore.create !== "function") return { ok: false, error: "instagram_media_store_unavailable" };
    let media = null;
    try {
      media = mediaStore.create(video, mimeType);
      if (!media || typeof media.url !== "string" || !/^https:\/\//.test(media.url)) {
        return { ok: false, error: "instagram_media_host_unavailable" };
      }
      const created = await graphRequest(found.page.instagramAccountId + "/media", {
        method: "POST",
        params: {
          media_type: "REELS",
          video_url: media.url,
          caption: String(input.caption || "").trim().slice(0, 2200),
          share_to_feed: "true"
        },
        token: found.page.accessToken
      });
      const containerId = String(created.id || "");
      if (!/^\d{3,80}$/.test(containerId)) return { ok: false, error: "instagram_container_create_failed" };

      let ready = false;
      let lastStatus = "IN_PROGRESS";
      for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
        const state = await graphRequest(containerId, {
          params: { fields: "status_code,status" },
          token: found.page.accessToken
        });
        lastStatus = String(state.status_code || "UNKNOWN").toUpperCase();
        if (lastStatus === "FINISHED") { ready = true; break; }
        if (lastStatus === "ERROR" || lastStatus === "EXPIRED") {
          return { ok: false, error: "instagram_container_" + lastStatus.toLowerCase() };
        }
        if (attempt + 1 < pollAttempts && pollIntervalMs) await sleep(pollIntervalMs);
      }
      if (!ready) return { ok: false, error: "instagram_container_processing_timeout", containerStatus: lastStatus };
      const published = await graphRequest(found.page.instagramAccountId + "/media_publish", {
        method: "POST",
        params: { creation_id: containerId },
        token: found.page.accessToken
      });
      const mediaId = String(published.id || "");
      if (!/^\d{3,80}$/.test(mediaId)) return { ok: false, error: "instagram_publish_not_confirmed" };
      const details = await graphRequest(mediaId, {
        params: { fields: "id,permalink,timestamp" },
        token: found.page.accessToken
      });
      const permalink = safePermalink(details.permalink, ["www.instagram.com", "instagram.com"]);
      const publishedAt = new Date(details.timestamp || "");
      if (!permalink || Number.isNaN(publishedAt.getTime())) {
        return { ok: false, error: "instagram_public_permalink_unavailable" };
      }
      return {
        ok: true,
        provider: "instagram",
        pageId: found.page.id,
        instagramAccountId: found.page.instagramAccountId,
        mediaId,
        videoId: mediaId,
        permalink,
        publishedAt: publishedAt.toISOString(),
        privacyStatus: "public",
        uploadStatus: "processed",
        processingStatus: "succeeded",
        published: true
      };
    } catch (error) {
      if (error && error.metaCode === 190) return { ok: false, error: "reconnect_required" };
      return { ok: false, error: "instagram_reel_publish_failed" };
    } finally {
      if (media && typeof media.dispose === "function") {
        try { media.dispose(); } catch (_) {}
      }
    }
  }

  function disconnect(sessionId) {
    if (typeof sessionId !== "string" || !SESSION_PATTERN.test(sessionId) || !tokenVault) return false;
    return tokenVault.deleteProvider(sha256(sessionId), "meta");
  }

  function buildReturnUrl(outcome, reason = "") {
    const origins = allowedOrigins(env);
    if (!origins.length) return "";
    const url = new URL("/", origins[0]);
    url.searchParams.set("social_connect", outcome);
    url.searchParams.set("social_provider", "meta");
    if (reason) url.searchParams.set("social_reason", String(reason).slice(0, 80));
    return url.href;
  }

  return Object.freeze({
    getReadiness,
    createAuthorizationRequest,
    completeAuthorization,
    getConnection,
    uploadFacebookReel,
    getFacebookReelStatus,
    uploadInstagramReel,
    disconnect,
    buildReturnUrl
  });
}

module.exports = {
  SESSION_PATTERN,
  META_SCOPES,
  MAX_VIDEO_BYTES,
  parseRedirectUri,
  parsePublicMediaBase,
  graphVersion,
  readJson,
  safePermalink,
  createMetaSocialService
};
