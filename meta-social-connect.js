(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) api.init(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "ai-commerce-hub.social-backend-origin.v1";
  const ACTION_HEADER = "meta-publish";
  const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

  function validateMetaPublishContext(input) {
    const source = input && typeof input === "object" ? input : {};
    const provider = String(source.provider || "").toLowerCase();
    if (provider !== "facebook" && provider !== "instagram") return { valid: false, error: "Choose Facebook or Instagram." };
    const platform = String(source.platform || "").toLowerCase();
    if (platform !== provider) return { valid: false, error: "The selected Social Desk platform does not match the publishing action." };
    const campaignId = String(source.campaignId || "").trim();
    const campaignPlatform = String(source.campaignPlatform || "").trim().toLowerCase();
    const campaignStatus = String(source.campaignStatus || "").trim().toLowerCase();
    if (campaignId && campaignPlatform === "content rewards" &&
        !["joined", "editing", "ready"].includes(campaignStatus)) {
      return { valid: false, error: "Complete Join / Apply in Content Rewards first, then update this local tracker to Joined, Editing or Ready." };
    }
    if (campaignId && campaignPlatform === "content rewards" && source.contentRewardsAccountVerified !== true) {
      return { valid: false, error: "Connect and verify this exact posting account in Content Rewards → Settings → Connected accounts before publishing." };
    }
    const rules = String(source.rules || "");
    const acceptedLine = /^\s*Accepted platforms\s*:\s*(.+)$/im.exec(rules);
    if (campaignId && campaignPlatform === "content rewards" && acceptedLine &&
        !/^(?:not recognised|not stated|none detected|unknown|n\/a)$/i.test(acceptedLine[1].trim())) {
      const accepted = acceptedLine[1].split(/[,;|]/).map((value) => value.trim().toLowerCase());
      const aliases = provider === "instagram"
        ? ["instagram", "instagram reels", "reels"]
        : ["facebook", "facebook reels", "reels"];
      if (!accepted.some((value) => aliases.includes(value) || value === "all")) {
        return { valid: false, error: "This platform is not listed in the saved Content Rewards campaign requirements. Recheck the official brief before publishing." };
      }
    }
    if (source.requiresPreApproval === true && source.preApprovalConfirmed !== true) {
      return { valid: false, error: "This campaign requires the team's draft approval. Do not publish until the exact draft and posting account are approved." };
    }
    return { valid: true, provider, campaignId };
  }

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
    const $ = (id) => windowObject.document.getElementById(id);
    const originInput = $("socialBackendOrigin");
    const connectButton = $("connectMetaAccount");
    const disconnectButton = $("disconnectMetaAccount");
    const pageSelect = $("metaPageSelect");
    const statusNode = $("metaAccountConnectionStatus");
    const publishStatus = $("metaPublishStatus");
    const publicConfirm = $("meta-public-confirm");
    const contentRewardsAccountVerified = $("content-rewards-account-verified");
    const contentRewardsAccountVerifiedLabel = $("content-rewards-account-verified-label");
    const facebookPublishButton = $("publishFacebookReel");
    const instagramPublishButton = $("publishInstagramReel");
    const facebookCheckButton = $("checkFacebookReelStatus");
    const facebookVideoIdInput = $("facebook-reel-id");
    const fileInput = $("socialMediaFiles");
    if (!originInput || !connectButton || !disconnectButton || !pageSelect ||
        !statusNode || !publishStatus || !facebookPublishButton ||
        !instagramPublishButton || !facebookCheckButton || !fileInput) return;

    let backendOrigin = "";
    let metaConfigured = false;
    let instagramConfigured = false;
    let pages = [];
    let lastFacebookVideoId = "";
    let publishInFlight = false;
    const PublishMonitor = windowObject.ClipRewardPublishMonitor;

    function setStatus(message, error) {
      statusNode.textContent = message;
      statusNode.classList.toggle("video-status-error", !!error);
    }

    function setPublishStatus(message, error) {
      publishStatus.textContent = message;
      publishStatus.classList.toggle("video-status-error", !!error);
    }

    function selectedPage() {
      return pages.find((page) => page.id === pageSelect.value) || null;
    }

    function getHandoff() {
      return windowObject.AICommerceSocialHandoff &&
        typeof windowObject.AICommerceSocialHandoff === "object"
        ? windowObject.AICommerceSocialHandoff : null;
    }

    function updateControls() {
      const page = selectedPage();
      const handoff = getHandoff();
      const metaHandoff = Boolean(handoff &&
        ["facebook", "instagram"].includes(String(handoff.platform || "").toLowerCase()));
      const requiresContentRewardsAccount = Boolean(metaHandoff && handoff.campaignId &&
        String(handoff.campaignPlatform || "").toLowerCase() === "content rewards");
      if (contentRewardsAccountVerifiedLabel && (!handoff || metaHandoff)) {
        contentRewardsAccountVerifiedLabel.hidden = !requiresContentRewardsAccount;
      }
      const accountVerified = !requiresContentRewardsAccount ||
        Boolean(contentRewardsAccountVerified && contentRewardsAccountVerified.checked);
      const publicApproved = !!(publicConfirm && publicConfirm.checked);
      const selectedPlatform = String(($("socialPlatform") && $("socialPlatform").value) || "").toLowerCase();
      const handoffPlatform = handoff && String(handoff.platform || "").toLowerCase();
      const hasVideo = Boolean(fileInput.files && fileInput.files.length === 1);
      const enabled = Boolean(backendOrigin && metaConfigured && page && !publishInFlight &&
        publicApproved && accountVerified && hasVideo);
      facebookPublishButton.disabled = !enabled || !page.canPublishFacebook ||
        selectedPlatform !== "facebook" || (handoffPlatform && handoffPlatform !== "facebook");
      instagramPublishButton.disabled = !enabled || !instagramConfigured || !page.canPublishInstagram ||
        selectedPlatform !== "instagram" || (handoffPlatform && handoffPlatform !== "instagram");
      facebookCheckButton.disabled = !backendOrigin || !page || !facebookVideoIdInput.value.trim() || publishInFlight;
      disconnectButton.disabled = !backendOrigin || !pages.length || publishInFlight;
    }

    async function detectBackend() {
      const candidate = normalizeBackendOrigin(windowObject.location.origin || "");
      if (!candidate) return false;
      try {
        const response = await windowObject.fetch(candidate + "/api/social/providers", {
          method: "GET", credentials: "omit", cache: "no-store", headers: { Accept: "application/json" }
        });
        if (!response.ok) return false;
        const data = await response.json();
        if (!data || !data.metaOAuth) return false;
        backendOrigin = candidate;
        originInput.value = candidate;
        return true;
      } catch (_) {
        return false;
      }
    }

    function renderPages(connection) {
      pages = Array.isArray(connection && connection.pages) ? connection.pages : [];
      pageSelect.replaceChildren();
      const placeholder = windowObject.document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = pages.length ? "Choose a Page / linked Instagram account" : "No publishing Pages found";
      pageSelect.appendChild(placeholder);
      pages.forEach((page) => {
        const option = windowObject.document.createElement("option");
        option.value = page.id;
        const capabilities = [];
        if (page.canPublishFacebook) capabilities.push("Facebook");
        if (page.canPublishInstagram) capabilities.push("Instagram @" + (page.instagramUsername || "linked"));
        option.textContent = page.name + (capabilities.length ? " · " + capabilities.join(" + ") : " · no publish permission");
        pageSelect.appendChild(option);
      });
      pageSelect.disabled = pages.length === 0;
      updateControls();
    }

    async function refresh() {
      connectButton.disabled = true;
      disconnectButton.disabled = true;
      facebookPublishButton.disabled = true;
      instagramPublishButton.disabled = true;
      metaConfigured = false;
      instagramConfigured = false;
      if (!backendOrigin && !(await detectBackend())) {
        renderPages(null);
        setStatus("No private HTTPS backend was detected. GitHub Pages is static; enter the deployed backend origin in the field above.", true);
        return;
      }
      try {
        const [providerResponse, connectionResponse] = await Promise.all([
          windowObject.fetch(backendOrigin + "/api/social/providers", {
            method: "GET", credentials: "omit", cache: "no-store", headers: { Accept: "application/json" }
          }),
          windowObject.fetch(backendOrigin + "/api/social/connections", {
            method: "GET", credentials: "include", cache: "no-store", headers: { Accept: "application/json" }
          })
        ]);
        if (!providerResponse.ok || !connectionResponse.ok) throw new Error("Meta backend readiness or session check failed.");
        const providerData = await providerResponse.json();
        const connectionData = await connectionResponse.json();
        const readiness = providerData.metaOAuth || {};
        metaConfigured = readiness.facebookReady === true || readiness.configured === true;
        instagramConfigured = readiness.instagramReady === true;
        const connection = Array.isArray(connectionData.connections)
          ? connectionData.connections.find((item) => item && item.provider === "meta") : null;
        renderPages(connection);
        connectButton.disabled = !metaConfigured;
        const missing = Array.isArray(readiness.missing) ? readiness.missing : [];
        if (connection && connection.status === "connected") {
          const instagramPages = pages.filter((page) => page.canPublishInstagram).length;
          const facebookPages = pages.filter((page) => page.canPublishFacebook).length;
          setStatus(
            "Meta connected · " + facebookPages + " Facebook Page(s) with publish permission · " +
            instagramPages + " linked Instagram Professional account(s)." +
            (instagramConfigured ? "" : " Instagram publishing also needs META_MEDIA_BASE_URL on the backend.") +
            " This does not verify the account in Content Rewards; connect the same posting account there separately.",
            false
          );
        } else if (connection && connection.status === "reconnect_required") {
          setStatus("Meta authorization expired. Reconnect through Facebook's official consent screen.", true);
          connectButton.disabled = !metaConfigured;
        } else {
          setStatus(metaConfigured
            ? "Meta backend is configured. Connect the Facebook login that manages your Page."
            : "Meta setup is incomplete: " + (missing.join(", ") || "configure the Meta app and token encryption key") + ".", true);
        }
        updateControls();
      } catch (error) {
        setStatus((error && error.message) || "Meta connection status could not be loaded.", true);
        connectButton.disabled = true;
        renderPages(null);
      }
    }

    function validateBeforePublish(provider) {
      const page = selectedPage();
      const file = fileInput.files && fileInput.files.length === 1 ? fileInput.files[0] : null;
      const caption = $("socialCaption") ? $("socialCaption").value.trim() : "";
      const platform = String(($("socialPlatform") && $("socialPlatform").value) || "").toLowerCase();
      const handoff = getHandoff();
      if (!backendOrigin || !page || !file) return { valid: false, error: "Choose one video and a connected Meta Page first." };
      const context = validateMetaPublishContext({
        provider,
        platform,
        campaignId: handoff && handoff.campaignId,
        campaignPlatform: handoff && handoff.campaignPlatform,
        campaignStatus: handoff && handoff.campaignStatus,
        contentRewardsAccountVerified: Boolean(contentRewardsAccountVerified && contentRewardsAccountVerified.checked),
        rules: handoff && handoff.rules,
        requiresPreApproval: handoff && handoff.requiresPreApproval,
        preApprovalConfirmed: handoff && handoff.preApprovalConfirmed
      });
      if (!context.valid) return context;
      if (handoff && handoff.mediaFingerprint) {
        const fingerprint = handoff.mediaFingerprint;
        if (String(file.name || "").slice(0, 255) !== fingerprint.name ||
            file.size !== fingerprint.size ||
            String(file.type || "").toLowerCase() !== fingerprint.type ||
            (Number(file.lastModified) || 0) !== fingerprint.lastModified) {
          return { valid: false, error: "The selected media differs from the finished export sent from Clip Studio. Send that export again." };
        }
      }
      if (!["video/mp4", "video/quicktime"].includes(String(file.type || "").toLowerCase().split(";")[0]) ||
          !file.size || file.size > MAX_VIDEO_BYTES) {
        return { valid: false, error: "Meta Reels publishing requires one MP4 or MOV video no larger than 50 MB." };
      }
      if (!publicConfirm.checked) return { valid: false, error: "Confirm public publishing before uploading." };
      if (!caption) return { valid: false, error: "Add a caption before publishing." };
      if (provider === "facebook" && !page.canPublishFacebook) return { valid: false, error: "This Page has no CREATE_CONTENT publishing permission." };
      if (provider === "instagram" && (!instagramConfigured || !page.canPublishInstagram)) {
        return { valid: false, error: "Choose a Page linked to an Instagram Professional account and configure META_MEDIA_BASE_URL." };
      }
      return { valid: true, page, file, caption, handoff };
    }

    function readDuration(file) {
      const handoff = getHandoff();
      if (handoff && Number.isFinite(Number(handoff.durationSeconds)) && Number(handoff.durationSeconds) > 0) {
        return Promise.resolve(Number(handoff.durationSeconds));
      }
      return new Promise((resolve, reject) => {
        const url = windowObject.URL.createObjectURL(file);
        const video = windowObject.document.createElement("video");
        let finished = false;
        const finish = (error, duration) => {
          if (finished) return;
          finished = true;
          windowObject.URL.revokeObjectURL(url);
          video.removeAttribute("src");
          if (error) reject(error);
          else resolve(duration);
        };
        video.preload = "metadata";
        video.onloadedmetadata = () => {
          const duration = Number(video.duration);
          if (!Number.isFinite(duration) || duration <= 0) return finish(new Error("The video duration could not be read."));
          finish(null, duration);
        };
        video.onerror = () => finish(new Error("The browser could not inspect this video. Re-export it from Clip Studio."));
        video.src = url;
      });
    }

    function sendPublishedResult(provider, result, page, handoff) {
      const videoId = String(result.videoId || result.mediaId || "");
      const url = String(result.url || result.permalink || "");
      const publishedAt = new Date(result.publishedAt || "");
      const publish = {
        type: "AI_COMMERCE_META_PUBLISH_RESULT",
        payload: {
          provider,
          platform: provider,
          videoId,
          url,
          publishedAt: Number.isNaN(publishedAt.getTime()) ? "" : publishedAt.toISOString(),
          privacyStatus: "public",
          uploadStatus: "processed",
          processingStatus: "succeeded",
          published: true,
          contentRewardsAccountVerified: Boolean(contentRewardsAccountVerified && contentRewardsAccountVerified.checked),
          pageId: page.id,
          pageName: page.name,
          campaignId: handoff ? String(handoff.campaignId || "") : "",
          campaignName: handoff ? String(handoff.campaignName || "") : ""
        }
      };
      if (windowObject.opener && typeof windowObject.opener.postMessage === "function" &&
          windowObject.location && windowObject.location.origin) {
        windowObject.opener.postMessage(publish, windowObject.location.origin);
        setPublishStatus("Meta confirmed a public " + provider + " post. The real permalink/time was sent to Clip Studio. Open Content Rewards and press Submit clip within 30 minutes; this app did not submit it.", false);
      } else {
        setPublishStatus("Meta published: " + url + ". Copy this public link and submit it to the matching Content Rewards campaign within 30 minutes.", false);
      }
    }

    async function publish(provider) {
      if (publishInFlight) return;
      const checked = validateBeforePublish(provider);
      if (!checked.valid) {
        setPublishStatus(checked.error, true);
        return;
      }
      let duration;
      try {
        duration = await readDuration(checked.file);
      } catch (error) {
        setPublishStatus(error.message || "Could not read video duration.", true);
        return;
      }
      if (provider === "facebook" && (duration < 4 || duration > 60)) {
        setPublishStatus("Facebook Page Reels require a 4–60 second clip for this publishing flow.", true);
        return;
      }
      if (provider === "instagram" && (duration < 3 || duration > 900)) {
        setPublishStatus("Instagram Reels support 3–900 seconds; choose a supported video duration.", true);
        return;
      }
      const title = String((checked.caption.split(/\r?\n/)[0] || checked.file.name).slice(0, 100));
      const confirmMessage = "Publish this finished video publicly to " + checked.page.name + " as a " +
        (provider === "facebook" ? "Facebook Reel" : "Instagram Reel") + "?\n\n" +
        title + (checked.handoff && checked.handoff.campaignName ? "\n\nCampaign: " + checked.handoff.campaignName : "") +
        "\n\nThe post will be public. Continue only after confirming the campaign's rules and your Content Rewards account is verified.";
      if (!windowObject.confirm(confirmMessage)) return;
      publishInFlight = true;
      updateControls();
      let uploadedFacebookVideoId = "";
      setPublishStatus("Uploading and publishing the Reel through Meta's official API… Keep this tab open.", false);
      try {
        const query = new URLSearchParams({
          pageId: checked.page.id,
          title,
          caption: checked.caption,
          durationSeconds: String(duration)
        });
        const response = await windowObject.fetch(backendOrigin + "/api/social/meta/" + provider + "/publish?" + query.toString(), {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            "X-AI-Commerce-Action": ACTION_HEADER,
            "Content-Type": checked.file.type
          },
          body: checked.file
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Meta publishing failed.");
        if (provider === "facebook") {
          lastFacebookVideoId = String(result.videoId || "");
          uploadedFacebookVideoId = lastFacebookVideoId;
          if (facebookVideoIdInput && lastFacebookVideoId) facebookVideoIdInput.value = lastFacebookVideoId;
          facebookCheckButton.disabled = !lastFacebookVideoId;
          setPublishStatus("Meta accepted the Facebook Reel upload. The video is not yet confirmed published; press Check Facebook publish status before starting any Content Rewards timer.", false);
        } else {
          if (result.published !== true || !result.permalink || !result.publishedAt) {
            throw new Error("Instagram did not return a confirmed public permalink and publication timestamp.");
          }
          sendPublishedResult("instagram", result, checked.page, checked.handoff);
        }
      } catch (error) {
        setPublishStatus((error && error.message) || "Meta publishing failed. Check the Page/Instagram app permissions and retry only after checking the platform for a duplicate post.", true);
      } finally {
        publishInFlight = false;
        updateControls();
      }
      if (uploadedFacebookVideoId) {
        await autoPollFacebookPublication(checked.page, uploadedFacebookVideoId, checked.handoff);
      }
    }

    async function autoPollFacebookPublication(page, videoId, handoff) {
      if (!PublishMonitor || typeof PublishMonitor.pollUntilPublic !== "function") {
        setPublishStatus("Meta accepted the Facebook Reel. Automatic status monitoring is unavailable; use Check Facebook publish status.", false);
        return;
      }
      const outcome = await PublishMonitor.pollUntilPublic(async () => {
        const query = new URLSearchParams({ pageId: page.id, videoId });
        const response = await windowObject.fetch(backendOrigin + "/api/social/meta/facebook/status?" + query.toString(), {
          method: "GET", credentials: "include", cache: "no-store", headers: { Accept: "application/json" }
        });
        const result = await response.json();
        return response.ok ? result : { ok: false, error: result.error || "facebook_status_http_" + response.status };
      }, {
        provider: "facebook",
        maxAttempts: 24,
        intervalMs: 5000,
        onAttempt: (attempt, total) => setPublishStatus("Automatically checking Facebook upload/processing/publication · " + attempt + "/" + total + ". Keep this tab open.", false)
      });

      if (outcome.state === "published") {
        sendPublishedResult("facebook", {
          ...outcome.result,
          url: outcome.result.permalink,
          uploadStatus: "processed",
          processingStatus: "succeeded"
        }, page, handoff);
      } else if (outcome.state === "timed_out") {
        setPublishStatus("Meta accepted the Facebook Reel, but has not confirmed a public permalink yet. Use Check Facebook publish status later. No Content Rewards timer has started.", false);
      } else {
        setPublishStatus("Automatic Facebook verification stopped (" + (outcome.error || outcome.state) + "). Check the Page and use the manual status button; no timer has started.", true);
      }
    }

    async function checkFacebookStatus() {
      const page = selectedPage();
      const videoId = String((facebookVideoIdInput && facebookVideoIdInput.value) || lastFacebookVideoId).trim();
      if (!backendOrigin || !page || !videoId || publishInFlight) {
        setPublishStatus("Choose the connected Facebook Page and the video ID returned by the upload.", true);
        return;
      }
      publishInFlight = true;
      updateControls();
      setPublishStatus("Checking Meta processing and publication status…", false);
      try {
        const query = new URLSearchParams({ pageId: page.id, videoId });
        const response = await windowObject.fetch(backendOrigin + "/api/social/meta/facebook/status?" + query.toString(), {
          method: "GET", credentials: "include", cache: "no-store", headers: { Accept: "application/json" }
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Facebook Reel status check failed.");
        if (!result.published) {
          setPublishStatus("Facebook Reel status: " + result.videoStatus + " · processing " + result.processingStatus + " · publishing " + result.publishingStatus + ". Check again after Meta finishes.", false);
          return;
        }
        sendPublishedResult("facebook", {
          ...result,
          url: result.permalink,
          uploadStatus: "processed",
          processingStatus: "succeeded"
        }, page, getHandoff());
      } catch (error) {
        setPublishStatus((error && error.message) || "Facebook Reel status is not available yet.", true);
      } finally {
        publishInFlight = false;
        updateControls();
      }
    }

    connectButton.addEventListener("click", () => {
      if (!backendOrigin || !metaConfigured) {
        setStatus("Configure the private Meta backend before starting Facebook authorization.", true);
        return;
      }
      windowObject.location.assign(backendOrigin + "/api/social/meta/connect");
    });

    disconnectButton.addEventListener("click", async () => {
      if (!backendOrigin || !windowObject.confirm("Disconnect Meta Pages and linked Instagram accounts from this private backend?")) return;
      disconnectButton.disabled = true;
      try {
        const response = await windowObject.fetch(backendOrigin + "/api/social/meta/disconnect", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "X-AI-Commerce-Action": "meta-disconnect" }
        });
        if (!response.ok) throw new Error("Meta disconnect failed.");
        pages = [];
        renderPages(null);
        setStatus("Meta connection removed from the server-side encrypted token vault.", false);
        await refresh();
      } catch (error) {
        setStatus((error && error.message) || "Could not disconnect Meta.", true);
        disconnectButton.disabled = false;
      }
    });

    pageSelect.addEventListener("change", updateControls);
    windowObject.addEventListener("ai-commerce:social-handoff", updateControls);
    if (publicConfirm) publicConfirm.addEventListener("change", updateControls);
    if (contentRewardsAccountVerified) contentRewardsAccountVerified.addEventListener("change", updateControls);
    if (fileInput) fileInput.addEventListener("change", updateControls);
    if ($("socialPlatform")) $("socialPlatform").addEventListener("change", updateControls);
    if (facebookVideoIdInput) facebookVideoIdInput.addEventListener("input", updateControls);
    facebookPublishButton.addEventListener("click", () => publish("facebook"));
    instagramPublishButton.addEventListener("click", () => publish("instagram"));
    facebookCheckButton.addEventListener("click", checkFacebookStatus);

    try {
      backendOrigin = normalizeBackendOrigin(windowObject.localStorage.getItem(STORAGE_KEY) || "");
      if (originInput && backendOrigin) originInput.value = backendOrigin;
    } catch (_) {}
    const callback = new URL(windowObject.location.href);
    const callbackResult = callback.searchParams.get("social_connect");
    const callbackProvider = callback.searchParams.get("social_provider");
    if (callbackResult && callbackProvider === "meta") {
      setStatus(callbackResult === "success"
        ? "Meta consent flow completed. Loading your managed Pages and linked Instagram account…"
        : "Meta connection was not completed (" + (callback.searchParams.get("social_reason") || "unknown reason") + ").", callbackResult !== "success");
      callback.searchParams.delete("social_connect");
      callback.searchParams.delete("social_provider");
      callback.searchParams.delete("social_reason");
      windowObject.history.replaceState({}, "", callback.pathname + callback.search + callback.hash);
    }
    refresh();

    return {
      refresh,
      normalizeBackendOrigin,
      validateMetaPublishContext
    };
  }

  return {
    MAX_VIDEO_BYTES,
    normalizeBackendOrigin,
    validateMetaPublishContext,
    init
  };
});
