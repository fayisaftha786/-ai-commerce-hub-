"use strict";

const crypto = require("node:crypto");
const { createEncryptedTokenVault } = require("./social-token-vault.js");

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const STATE_TTL_MS = 10 * 60 * 1000;
// Request read access to confirm processing/public visibility, plus upload
// access only for the explicitly confirmed YouTube publishing feature.
const REQUIRED_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.upload"
]);
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHANNELS_URL = "https://youtube.googleapis.com/youtube/v3/channels";
const VIDEOS_URL = "https://youtube.googleapis.com/youtube/v3/videos";
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,32}$/;

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function isHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch (_) {
    return false;
  }
}

function allowedOrigins(env) {
  return String(env.SOCIAL_CORS_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
}

function parseRedirectUri(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
        (url.port && url.port !== "443") || url.pathname !== "/api/social/youtube/callback" ||
        url.search || url.hash) return null;
    return url;
  } catch (_) {
    return null;
  }
}

function parseReturnUrl(value, origins) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
        (url.port && url.port !== "443") || !origins.includes(url.origin)) return null;
    return url;
  } catch (_) {
    return null;
  }
}

async function readJson(response, maxBytes = 64 * 1024) {
  if (!response || typeof response.text !== "function") throw new Error("provider_unavailable");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("provider_response_too_large");
  let data;
  try { data = JSON.parse(text); } catch (_) { throw new Error("provider_invalid_response"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("provider_invalid_response");
  return data;
}

function publicConnection(record, status = "connected") {
  return {
    provider: "youtube",
    status,
    channelId: String(record.channelId || ""),
    channelTitle: String(record.channelTitle || "").slice(0, 120),
    connectedAt: String(record.connectedAt || ""),
    tokenExpiresAt: Number.isFinite(record.expiresAt) ? new Date(record.expiresAt).toISOString() : "",
    refreshAvailable: Boolean(record.refreshToken),
    grantedScopes: Array.isArray(record.scopes) ? record.scopes.filter((scope) => REQUIRED_SCOPES.includes(scope)) : []
  };
}

function createYouTubeOAuthService(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const tokenVault = options.tokenVault || (env.SOCIAL_TOKEN_ENCRYPTION_KEY
    ? createEncryptedTokenVault({
      filePath: env.SOCIAL_TOKEN_STORE_PATH,
      encryptionKey: env.SOCIAL_TOKEN_ENCRYPTION_KEY
    })
    : null);
  const pendingStates = new Map();

  function getReadiness() {
    const missing = [];
    if (!String(env.GOOGLE_CLIENT_ID || "").trim()) missing.push("GOOGLE_CLIENT_ID");
    if (!String(env.GOOGLE_CLIENT_SECRET || "").trim()) missing.push("GOOGLE_CLIENT_SECRET");
    if (!parseRedirectUri(env.GOOGLE_REDIRECT_URI)) missing.push("GOOGLE_REDIRECT_URI");
    if (!String(env.SOCIAL_TOKEN_ENCRYPTION_KEY || "").trim()) missing.push("SOCIAL_TOKEN_ENCRYPTION_KEY");
    const origins = allowedOrigins(env);
    if (!origins.length) missing.push("SOCIAL_CORS_ORIGINS");
    if (!parseReturnUrl(env.SOCIAL_RETURN_URL, origins)) missing.push("SOCIAL_RETURN_URL");
    return {
      provider: "youtube",
      configured: missing.length === 0,
      missing,
      status: missing.length === 0 ? "oauth_ready_not_connected" : "configuration_incomplete",
      requestedScopes: [...REQUIRED_SCOPES]
    };
  }

  function createSessionId() {
    return base64url(randomBytes(32));
  }

  function createAuthorizationRequest(existingSessionId = "") {
    const readiness = getReadiness();
    if (!readiness.configured) {
      return { ok: false, error: "oauth_not_configured", missing: readiness.missing };
    }
    const sessionId = SESSION_ID_PATTERN.test(existingSessionId) ? existingSessionId : createSessionId();
    const sessionHash = sha256(sessionId);
    const state = base64url(randomBytes(32));
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
    const currentTime = now();
    for (const [key, pending] of pendingStates) {
      if (pending.expiresAt <= currentTime) pendingStates.delete(key);
    }
    if (pendingStates.size >= 10000) return { ok: false, error: "too_many_pending_authorizations" };
    pendingStates.set(state, { sessionHash, verifier, expiresAt: currentTime + STATE_TTL_MS });

    const auth = new URL(AUTHORIZE_URL);
    auth.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
    auth.searchParams.set("redirect_uri", env.GOOGLE_REDIRECT_URI);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", REQUIRED_SCOPES.join(" "));
    auth.searchParams.set("access_type", "offline");
    auth.searchParams.set("include_granted_scopes", "true");
    auth.searchParams.set("prompt", "consent");
    auth.searchParams.set("state", state);
    auth.searchParams.set("code_challenge", challenge);
    auth.searchParams.set("code_challenge_method", "S256");

    return { ok: true, url: auth.href, sessionId, setCookie: sessionId !== existingSessionId };
  }

  function consumeState(state, sessionId) {
    if (typeof state !== "string" || !STATE_PATTERN.test(state) ||
        typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) return null;
    const pending = pendingStates.get(state);
    pendingStates.delete(state);
    if (!pending || pending.expiresAt <= now()) return null;
    const suppliedHash = Buffer.from(sha256(sessionId), "hex");
    const expectedHash = Buffer.from(pending.sessionHash, "hex");
    if (suppliedHash.length !== expectedHash.length || !crypto.timingSafeEqual(suppliedHash, expectedHash)) return null;
    return pending;
  }

  async function postToken(fields) {
    if (typeof fetchImpl !== "function") throw new Error("provider_unavailable");
    const body = new URLSearchParams(fields);
    const response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body
    });
    const data = await readJson(response);
    if (!response.ok) throw new Error(data.error === "invalid_grant" ? "authorization_expired" : "token_exchange_failed");
    return data;
  }

  async function completeAuthorization(input = {}) {
    const pending = consumeState(input.state, input.sessionId);
    if (!pending) return { ok: false, error: "invalid_or_expired_state" };
    if (input.providerError) return { ok: false, error: input.providerError === "access_denied" ? "access_denied" : "authorization_failed" };
    if (typeof input.code !== "string" || input.code.length < 8 || input.code.length > 4096) {
      return { ok: false, error: "invalid_authorization_code" };
    }

    try {
      const tokens = await postToken({
        code: input.code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: env.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
        code_verifier: pending.verifier
      });
      if (typeof tokens.access_token !== "string" || !tokens.access_token ||
          String(tokens.token_type || "").toLowerCase() !== "bearer" ||
          !Number.isFinite(Number(tokens.expires_in)) || Number(tokens.expires_in) <= 0) {
        return { ok: false, error: "invalid_token_response" };
      }
      const grantedScopes = String(tokens.scope || "").split(/\s+/).filter(Boolean);
      if (!REQUIRED_SCOPES.every((scope) => grantedScopes.includes(scope))) {
        return { ok: false, error: "required_permissions_not_granted" };
      }

      const channelUrl = new URL(CHANNELS_URL);
      channelUrl.searchParams.set("part", "id,snippet");
      channelUrl.searchParams.set("mine", "true");
      const response = await fetchImpl(channelUrl.href, {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        headers: { authorization: "Bearer " + tokens.access_token, accept: "application/json" }
      });
      const channelData = await readJson(response);
      if (!response.ok) return { ok: false, error: "channel_lookup_failed" };
      const channel = Array.isArray(channelData.items) ? channelData.items.find((item) =>
        item && typeof item.id === "string" && item.id && item.snippet && typeof item.snippet.title === "string"
      ) : null;
      if (!channel) return { ok: false, error: "no_authorized_channel_found" };

      const connectedAt = new Date(now()).toISOString();
      const record = {
        accessToken: tokens.access_token,
        refreshToken: typeof tokens.refresh_token === "string" ? tokens.refresh_token : "",
        expiresAt: now() + Number(tokens.expires_in) * 1000,
        scopes: grantedScopes,
        channelId: channel.id,
        channelTitle: channel.snippet.title.slice(0, 120),
        connectedAt,
        updatedAt: connectedAt
      };
      tokenVault.set(sha256(input.sessionId), "youtube", record);
      return { ok: true, connection: publicConnection(record) };
    } catch (error) {
      const code = String(error && error.message || "");
      return { ok: false, error: [
        "provider_unavailable", "provider_response_too_large", "provider_invalid_response",
        "authorization_expired", "token_exchange_failed"
      ].includes(code) ? code : "authorization_failed" };
    }
  }

  async function refreshRecord(record, sessionId) {
    if (!record.refreshToken) return { ok: false, error: "reconnect_required" };
    try {
      const tokens = await postToken({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: record.refreshToken,
        grant_type: "refresh_token"
      });
      if (typeof tokens.access_token !== "string" || !tokens.access_token ||
          !Number.isFinite(Number(tokens.expires_in)) || Number(tokens.expires_in) <= 0) {
        return { ok: false, error: "invalid_refresh_response" };
      }
      const updated = {
        ...record,
        accessToken: tokens.access_token,
        refreshToken: typeof tokens.refresh_token === "string" && tokens.refresh_token ? tokens.refresh_token : record.refreshToken,
        expiresAt: now() + Number(tokens.expires_in) * 1000,
        scopes: typeof tokens.scope === "string" ? tokens.scope.split(/\s+/).filter(Boolean) : record.scopes,
        updatedAt: new Date(now()).toISOString()
      };
      tokenVault.set(sha256(sessionId), "youtube", updated);
      return { ok: true, record: updated };
    } catch (error) {
      return { ok: false, error: String(error && error.message || "") === "authorization_expired" ? "reconnect_required" : "refresh_failed" };
    }
  }

  async function getConnection(sessionId) {
    if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId) || !tokenVault) {
      return { provider: "youtube", status: "not_connected" };
    }
    const sessionHash = sha256(sessionId);
    const record = tokenVault.get(sessionHash, "youtube");
    if (!record) return { provider: "youtube", status: "not_connected" };
    let active = record;
    if (Number(record.expiresAt) <= now() + 60000) {
      if (!record.refreshToken) return publicConnection(record, "reconnect_required");
      const refreshed = await refreshRecord(record, sessionId);
      if (!refreshed.ok) return publicConnection(record, "reconnect_required");
      active = refreshed.record;
    }
    return publicConnection(active);
  }

  async function uploadVideo(sessionId, input = {}) {
    if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId) || !tokenVault) {
      return { ok: false, error: "not_connected" };
    }
    const video = input.video;
    if (!Buffer.isBuffer(video) || video.length < 1024 || video.length > 64 * 1024 * 1024) {
      return { ok: false, error: "invalid_video_size" };
    }
    const mimeType = String(input.mimeType || "");
    if (!/^video\/(mp4|quicktime|webm)$/.test(mimeType)) return { ok: false, error: "unsupported_video_type" };
    const title = String(input.title || "").trim().slice(0, 100);
    const description = String(input.description || "").trim().slice(0, 5000);
    const privacyStatus = ["private", "unlisted", "public"].includes(input.privacyStatus) ? input.privacyStatus : "private";
    if (!title) return { ok: false, error: "title_required" };

    const connection = await getConnection(sessionId);
    if (connection.status !== "connected") return { ok: false, error: "reconnect_required" };
    const record = tokenVault.get(sha256(sessionId), "youtube");
    if (!record || !record.scopes.includes("https://www.googleapis.com/auth/youtube.upload")) {
      return { ok: false, error: "upload_permission_required" };
    }
    const metadata = {
      snippet: { title, description },
      status: { privacyStatus, selfDeclaredMadeForKids: false }
    };
    try {
      const start = await fetchImpl("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
        method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
        headers: {
          authorization: "Bearer " + record.accessToken,
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-length": String(video.length),
          "x-upload-content-type": mimeType
        },
        body: JSON.stringify(metadata)
      });
      if (!start.ok) return { ok: false, error: start.status === 401 ? "reconnect_required" : "youtube_upload_session_failed" };
      const uploadUrl = start.headers && typeof start.headers.get === "function" ? start.headers.get("location") : "";
      let parsed;
      try { parsed = new URL(uploadUrl); } catch (_) { return { ok: false, error: "youtube_upload_session_invalid" }; }
      if (parsed.protocol !== "https:" || parsed.hostname !== "www.googleapis.com") {
        return { ok: false, error: "youtube_upload_session_invalid" };
      }
      const uploaded = await fetchImpl(parsed.href, {
        method: "PUT", redirect: "error", credentials: "omit", cache: "no-store",
        headers: { authorization: "Bearer " + record.accessToken, "content-type": mimeType },
        body: video
      });
      const data = await readJson(uploaded);
      if (!uploaded.ok || typeof data.id !== "string" || !data.id) {
        return { ok: false, error: uploaded.status === 401 ? "reconnect_required" : "youtube_video_upload_failed" };
      }
      return {
        ok: true,
        provider: "youtube",
        videoId: data.id,
        url: "https://www.youtube.com/watch?v=" + encodeURIComponent(data.id),
        privacyStatus,
        uploadedAt: new Date(now()).toISOString(),
        channelId: connection.channelId
      };
    } catch (_) {
      return { ok: false, error: "youtube_upload_unavailable" };
    }
  }

  async function getVideoStatus(sessionId, videoId) {
    if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId) || !tokenVault) {
      return { ok: false, error: "not_connected" };
    }
    const id = String(videoId || "").trim();
    if (!VIDEO_ID_PATTERN.test(id)) return { ok: false, error: "invalid_video_id" };

    const connection = await getConnection(sessionId);
    if (connection.status !== "connected") return { ok: false, error: "reconnect_required" };
    const record = tokenVault.get(sha256(sessionId), "youtube");
    if (!record || !record.scopes.includes("https://www.googleapis.com/auth/youtube.readonly")) {
      return { ok: false, error: "video_status_permission_required" };
    }

    try {
      const query = new URLSearchParams({ part: "processingDetails,status,snippet", id });
      const response = await fetchImpl(VIDEOS_URL + "?" + query.toString(), {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        headers: { authorization: "Bearer " + record.accessToken, accept: "application/json" }
      });
      if (!response.ok) {
        return { ok: false, error: response.status === 401 ? "reconnect_required" : "youtube_video_status_unavailable" };
      }
      const data = await readJson(response);
      const item = Array.isArray(data.items) ? data.items.find((entry) => entry && entry.id === id) : null;
      if (!item) return { ok: false, error: "youtube_video_not_found" };
      const status = item.status && typeof item.status === "object" ? item.status : {};
      const processing = item.processingDetails && typeof item.processingDetails === "object" ? item.processingDetails : {};
      const uploadStatus = String(status.uploadStatus || "unknown");
      const processingStatus = String(processing.processingStatus ||
        (uploadStatus === "processed" ? "succeeded" : uploadStatus));
      const privacyStatus = ["private", "unlisted", "public"].includes(status.privacyStatus)
        ? status.privacyStatus : "unknown";
      const rawPublishedAt = item.snippet && item.snippet.publishedAt;
      const parsedPublishedAt = rawPublishedAt ? new Date(rawPublishedAt) : null;
      const isProcessed = uploadStatus === "processed" && processingStatus === "succeeded";
      const publishedAt = isProcessed && privacyStatus === "public" &&
        parsedPublishedAt && !Number.isNaN(parsedPublishedAt.getTime())
        ? parsedPublishedAt.toISOString() : "";
      return {
        ok: true,
        provider: "youtube",
        videoId: id,
        url: "https://www.youtube.com/watch?v=" + encodeURIComponent(id),
        uploadStatus,
        processingStatus,
        privacyStatus,
        publishedAt
      };
    } catch (_) {
      return { ok: false, error: "youtube_video_status_unavailable" };
    }
  }

  function disconnect(sessionId) {
    if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId) || !tokenVault) return false;
    return tokenVault.deleteProvider(sha256(sessionId), "youtube");
  }

  function buildReturnUrl(outcome, reason = "") {
    const origins = allowedOrigins(env);
    const url = parseReturnUrl(env.SOCIAL_RETURN_URL, origins);
    if (!url) return null;
    url.searchParams.set("social_connect", outcome);
    url.searchParams.set("social_provider", "youtube");
    if (reason) url.searchParams.set("social_reason", reason);
    return url.href;
  }

  return Object.freeze({
    getReadiness,
    createAuthorizationRequest,
    completeAuthorization,
    getConnection,
    uploadVideo,
    getVideoStatus,
    disconnect,
    buildReturnUrl
  });
}

module.exports = {
  SESSION_ID_PATTERN,
  REQUIRED_SCOPES,
  AUTHORIZE_URL,
  TOKEN_URL,
  CHANNELS_URL,
  VIDEOS_URL,
  VIDEO_ID_PATTERN,
  sha256,
  parseRedirectUri,
  parseReturnUrl,
  createYouTubeOAuthService
};
