(function (root) {
  "use strict";

  const STORAGE_KEY = "ai-commerce-hub.social-backend-origin.v1";
  const ACTION_HEADER = "social-disconnect";

  function normalizeBackendOrigin(value) {
    try {
      const url = new URL(String(value || "").trim());
      const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (!(url.protocol === "https:" || (local && url.protocol === "http:")) ||
          !url.hostname || url.username || url.password || url.search || url.hash ||
          (url.pathname !== "/" && url.pathname !== "")) return "";
      return url.origin;
    } catch (_) {
      return "";
    }
  }

  function init(windowObject) {
    const document = windowObject.document;
    const $ = (id) => document.getElementById(id);
    const originInput = $("socialBackendOrigin");
    const saveButton = $("saveSocialBackend");
    const connectButton = $("connectYouTubeAccount");
    const disconnectButton = $("disconnectYouTubeAccount");
    const statusNode = $("socialAccountConnectionStatus");
    if (!originInput || !saveButton || !connectButton || !disconnectButton || !statusNode) return;

    let backendOrigin = "";
    let youtubeConfigured = false;

    function status(message) {
      statusNode.textContent = message;
    }

    function loadSavedOrigin() {
      try {
        const saved = windowObject.localStorage.getItem(STORAGE_KEY) || "";
        backendOrigin = normalizeBackendOrigin(saved);
        originInput.value = backendOrigin;
      } catch (_) {
        backendOrigin = "";
        status("Browser storage is unavailable. Enter the private backend origin again when needed.");
      }
    }

    async function refresh() {
      connectButton.disabled = true;
      disconnectButton.disabled = true;
      youtubeConfigured = false;
      if (!backendOrigin) {
        status("No private backend configured. GitHub Pages alone cannot run OAuth or store social tokens.");
        return;
      }

      try {
        const providerResponse = await windowObject.fetch(backendOrigin + "/api/social/providers", {
          method: "GET",
          credentials: "omit",
          cache: "no-store",
          headers: { Accept: "application/json" }
        });
        if (!providerResponse.ok) throw new Error("Backend provider check failed (HTTP " + providerResponse.status + ").");
        const providerData = await providerResponse.json();
        const youtube = providerData.youtubeOAuth || {};
        youtubeConfigured = youtube.configured === true;
        const missing = Array.isArray(youtube.missing) ? youtube.missing : [];
        const connectionResponse = await windowObject.fetch(backendOrigin + "/api/social/connections", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json" }
        });
        if (!connectionResponse.ok) {
          throw new Error("Backend connection check failed (HTTP " + connectionResponse.status + "). Check its exact CORS origin and HTTPS settings.");
        }
        const connectionData = await connectionResponse.json();
        const connection = Array.isArray(connectionData.connections)
          ? connectionData.connections.find((item) => item && item.provider === "youtube")
          : null;
        const state = connection && connection.status ? connection.status : "not_connected";

        if (state === "connected") {
          status("YouTube connected: " + (connection.channelTitle || "Channel") +
            ". This browser session is linked; publishing has not been enabled by this connection.");
          disconnectButton.disabled = false;
        } else if (state === "reconnect_required") {
          status("YouTube token needs reconnection. Start the official Google consent flow again.");
          connectButton.disabled = !youtubeConfigured;
        } else {
          status(youtubeConfigured
            ? "YouTube OAuth backend is configured. Connect with Google's official consent screen."
            : "YouTube is not connected. Missing backend configuration: " + (missing.join(", ") || "OAuth setup incomplete") + ".");
          connectButton.disabled = !youtubeConfigured;
        }
      } catch (error) {
        status((error && error.message ? error.message : "Backend status could not be loaded.") +
          " Cross-site cookie blocking can also prevent a session from being recognised; same-site app/API hosting is recommended.");
        connectButton.disabled = true;
      }
    }

    saveButton.addEventListener("click", async () => {
      const value = normalizeBackendOrigin(originInput.value);
      if (!value) {
        status("Enter a backend origin using HTTPS. HTTP is permitted only for localhost development.");
        return;
      }
      try {
        windowObject.localStorage.setItem(STORAGE_KEY, value);
        backendOrigin = value;
        originInput.value = value;
        status("Private backend origin saved on this device. Checking OAuth readiness…");
        await refresh();
      } catch (_) {
        status("Could not save the backend origin in this browser.");
      }
    });

    connectButton.addEventListener("click", () => {
      if (!backendOrigin || !youtubeConfigured) {
        status("Configure the private backend before starting Google OAuth.");
        return;
      }
      windowObject.location.assign(backendOrigin + "/api/social/youtube/connect");
    });

    disconnectButton.addEventListener("click", async () => {
      if (!backendOrigin) return;
      disconnectButton.disabled = true;
      try {
        const response = await windowObject.fetch(backendOrigin + "/api/social/youtube/disconnect", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "X-AI-Commerce-Action": ACTION_HEADER }
        });
        if (!response.ok) throw new Error("Disconnect failed (HTTP " + response.status + ").");
        status("YouTube connection removed from the server-side token vault.");
        await refresh();
      } catch (error) {
        status((error && error.message ? error.message : "Could not disconnect YouTube.") +
          " Check the configured backend and CORS permissions.");
        disconnectButton.disabled = false;
      }
    });

    loadSavedOrigin();
    const callback = new URL(windowObject.location.href);
    const result = callback.searchParams.get("social_connect");
    const provider = callback.searchParams.get("social_provider");
    if (result && provider === "youtube") {
      status(result === "success"
        ? "Google consent flow completed. Checking the connected YouTube channel…"
        : "Google connection was not completed (" + (callback.searchParams.get("social_reason") || "unknown reason") + ").");
      callback.searchParams.delete("social_connect");
      callback.searchParams.delete("social_provider");
      callback.searchParams.delete("social_reason");
      windowObject.history.replaceState({}, "", callback.pathname + callback.search + callback.hash);
    }
    refresh();
  }

  const api = { normalizeBackendOrigin, init };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) init(root);
})(typeof globalThis !== "undefined" ? globalThis : this);
