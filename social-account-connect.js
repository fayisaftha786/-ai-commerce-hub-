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
    const publishButton = $("publishYouTubeVideo");
    const privacySelect = $("youtube-video-privacy");
    const publicConfirmLabel = $("youtube-public-confirm-label");
    const publicConfirm = $("youtube-public-confirm");
    const videoIdInput = $("youtube-video-id");
    const checkStatusButton = $("checkYouTubeVideoStatus");
    if (!originInput || !saveButton || !connectButton || !disconnectButton || !statusNode) return;

    let backendOrigin = "";
    let youtubeConfigured = false;
    let lastUploadedVideoId = "";
    let lastPublishContext = null;
    let statusCheckInFlight = false;

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

    async function detectSameOriginBackend() {
      const candidate = normalizeBackendOrigin(windowObject.location.origin || "");
      if (!candidate) return false;
      try {
        const response = await windowObject.fetch(candidate + "/api/social/providers", {
          method: "GET",
          credentials: "omit",
          cache: "no-store",
          headers: { Accept: "application/json" }
        });
        if (!response.ok) return false;
        const data = await response.json();
        if (!data || !data.youtubeOAuth || data.youtubeOAuth.provider !== "youtube") return false;
        backendOrigin = candidate;
        originInput.value = candidate;
        return true;
      } catch (_) {
        return false;
      }
    }

    function updatePublishControls() {
      const privacy = privacySelect && ["private", "unlisted", "public"].includes(privacySelect.value)
        ? privacySelect.value : "private";
      if (publicConfirmLabel) publicConfirmLabel.hidden = privacy !== "public";
      if (checkStatusButton) checkStatusButton.disabled = !String((videoIdInput && videoIdInput.value) || lastUploadedVideoId).trim() || statusCheckInFlight;
    }

    async function refresh() {
      connectButton.disabled = true;
      disconnectButton.disabled = true;
      if (publishButton) publishButton.disabled = true;
      youtubeConfigured = false;
      if (!backendOrigin && !(await detectSameOriginBackend())) {
        status("No same-origin private backend was detected. GitHub Pages is static; enter the HTTPS backend origin or deploy the app and API together.");
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
            ". The server has a connection; upload permission is checked again by the publishing API.");
          disconnectButton.disabled = false;
          if (publishButton) publishButton.disabled = false;
          updatePublishControls();
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


    async function checkUploadedVideoStatus() {
      const videoId = String((videoIdInput && videoIdInput.value) || lastUploadedVideoId).trim();
      if (!backendOrigin || !videoId || statusCheckInFlight) {
        status("Connect YouTube and enter the video ID returned after upload.");
        return;
      }
      statusCheckInFlight = true;
      updatePublishControls();
      status("Checking YouTube processing and visibility…");
      try {
        const response = await windowObject.fetch(
          backendOrigin + "/api/social/youtube/status?videoId=" + encodeURIComponent(videoId),
          { method: "GET", credentials: "include", cache: "no-store", headers: { Accept: "application/json" } }
        );
        const result = await response.json();
        if (!response.ok || !result.ok || result.videoId !== videoId) {
          throw new Error(result.error || "YouTube status check failed.");
        }
        if (result.uploadStatus !== "processed" || result.processingStatus !== "succeeded") {
          status("YouTube is still processing this video (" + (result.processingStatus || result.uploadStatus || "status unknown") + "). Keep this page open and check again later. The Content Rewards timer has not started.");
          return;
        }
        if (result.privacyStatus !== "public") {
          status("YouTube processing is complete, but visibility is " + result.privacyStatus + ". Content Rewards requires a public post; no timer has started. Change visibility in YouTube Studio and check again.");
          return;
        }
        let parsed;
        const publishedAt = new Date(result.publishedAt || "");
        try { parsed = new URL(String(result.url || "")); } catch (_) { parsed = null; }
        const validUrl = parsed && parsed.protocol === "https:" &&
          parsed.hostname === "www.youtube.com" &&
          parsed.pathname === "/watch" &&
          parsed.searchParams.get("v") === videoId;
        if (!validUrl || Number.isNaN(publishedAt.getTime())) {
          throw new Error("YouTube did not return a valid public link and publication timestamp. No campaign timer has started.");
        }

        if (windowObject.opener && typeof windowObject.opener.postMessage === "function" &&
            windowObject.location && windowObject.location.origin) {
          windowObject.opener.postMessage({
            type: "AI_COMMERCE_YOUTUBE_PUBLISH_RESULT",
            payload: {
              provider: "youtube",
              videoId,
              url: parsed.href,
              privacyStatus: "public",
              uploadStatus: result.uploadStatus,
              processingStatus: result.processingStatus,
              publishedAt: publishedAt.toISOString(),
              ...(lastPublishContext || windowObject.AICommerceSocialHandoff || {})
            }
          }, windowObject.location.origin);
          status("YouTube confirms the video is processed and public. Its actual public link/time was sent to Clip Studio. Open Content Rewards and press Submit clip within 30 minutes; this app has not submitted it.");
        } else {
          status("YouTube confirms a processed public video: " + parsed.href + ". No Clip Studio window is connected; copy the public link and exact published time into the correct Content Rewards tracker entry, then submit manually.");
        }
      } catch (error) {
        status((error && error.message) || "Could not verify this YouTube video yet. Check YouTube Studio and retry.");
      } finally {
        statusCheckInFlight = false;
        updatePublishControls();
      }
    }

    if (privacySelect) {
      privacySelect.value = ["private", "unlisted", "public"].includes(privacySelect.value) ? privacySelect.value : "private";
      privacySelect.addEventListener("change", updatePublishControls);
      updatePublishControls();
    }
    if (publicConfirm) publicConfirm.addEventListener("change", updatePublishControls);
    if (videoIdInput) {
      videoIdInput.addEventListener("input", updatePublishControls);
      videoIdInput.addEventListener("change", updatePublishControls);
    }
    if (checkStatusButton) checkStatusButton.addEventListener("click", checkUploadedVideoStatus);

    if (publishButton) {
      publishButton.addEventListener("click", async () => {
        const fileInput = $("socialMediaFiles");
        const captionInput = $("socialCaption");
        const file = fileInput && fileInput.files && fileInput.files[0];
        const caption = captionInput ? captionInput.value.trim() : "";
        const handoff = windowObject.AICommerceSocialHandoff && typeof windowObject.AICommerceSocialHandoff === "object"
          ? windowObject.AICommerceSocialHandoff : null;
        const privacy = privacySelect && ["private", "unlisted", "public"].includes(privacySelect.value)
          ? privacySelect.value : "private";
        if (!backendOrigin || !file || !file.type.match(/^video\/(mp4|quicktime|webm)$/) || file.size > 64 * 1024 * 1024) {
          status("Choose one MP4, MOV or WebM video no larger than 64 MB and connect YouTube first.");
          return;
        }
        if (handoff && handoff.requiresPreApproval === true && handoff.preApprovalConfirmed !== true) {
          status("This Content Rewards campaign requires draft pre-approval. Do not publish until the campaign team has approved the draft.");
          return;
        }
        if (privacy === "public" && !(publicConfirm && publicConfirm.checked)) {
          status("Public visibility requires the separate confirmation checkbox. Content Rewards needs a public post; private remains the default.");
          return;
        }
        const title = (caption.split(/\r?\n/)[0] || file.name.replace(/\.[^.]+$/, "")).slice(0, 100);
        const visibilityLabel = privacy.toUpperCase();
        if (!windowObject.confirm("Upload this video to the connected YouTube channel as " + visibilityLabel + " visibility?\n\n" + title +
            (handoff && handoff.campaignName ? "\n\nCampaign: " + handoff.campaignName : "") +
            (privacy === "public" ? "\n\nPublic videos can be viewed by anyone. Continue only after checking campaign rules and media rights." : ""))) return;
        publishButton.disabled = true;
        lastPublishContext = handoff ? {
          campaignId: String(handoff.campaignId || ""),
          campaignName: String(handoff.campaignName || ""),
          requiresPreApproval: handoff.requiresPreApproval === true,
          preApprovalConfirmed: handoff.preApprovalConfirmed === true
        } : null;
        status("Uploading video to YouTube as " + visibilityLabel + "… Keep this page open until the upload finishes.");
        try {
          const query = new URLSearchParams({ title, description: caption, privacy });
          const response = await windowObject.fetch(backendOrigin + "/api/social/youtube/publish?" + query.toString(), {
            method: "POST",
            credentials: "include",
            cache: "no-store",
            headers: {
              "X-AI-Commerce-Action": "youtube-publish",
              "Content-Type": file.type
            },
            body: file
          });
          const result = await response.json();
          if (!response.ok || !result.ok || !result.url || !result.videoId) {
            throw new Error(result.error || "YouTube upload failed.");
          }
          lastUploadedVideoId = String(result.videoId);
          if (videoIdInput) videoIdInput.value = lastUploadedVideoId;
          status("YouTube accepted the upload (not yet confirmed public). Check processing & public status before starting any Content Rewards timer.");
          updatePublishControls();
        } catch (error) {
          status((error && error.message ? error.message : "YouTube upload failed.") + " Check YouTube Studio before retrying so you do not create a duplicate upload.");
          publishButton.disabled = false;
        }
      });
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
