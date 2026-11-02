"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) api.init(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PLATFORM_URLS = Object.freeze({
    instagram: "https://www.instagram.com/",
    facebook: "https://www.facebook.com/",
    youtube: "https://studio.youtube.com/",
    whatsapp: "https://web.whatsapp.com/",
    x: "https://x.com/"
  });
  const MAX_FILES = 5;
  const MAX_FILE_BYTES = 50 * 1024 * 1024;

  function validatePostHandoff(payload) {
    const source = payload && typeof payload === "object" ? payload : {};
    const platform = String(source.platform || "").toLowerCase();
    if (!["instagram", "facebook", "youtube", "x", "whatsapp"].includes(platform)) {
      return { valid: false, error: "The Clip Studio handoff has an unsupported platform." };
    }
    const file = source.file;
    if (!file || typeof file.size !== "number" || file.size <= 0 ||
        !String(file.type || "").toLowerCase().startsWith("video/")) {
      return { valid: false, error: "The handoff must include one readable video file." };
    }
    if (file.size > MAX_FILE_BYTES) {
      return { valid: false, error: "The Social Media Desk accepts videos up to 50 MB." };
    }
    const caption = String(source.caption || "").trim();
    if (!caption || caption.length > 5000) {
      return { valid: false, error: "The handoff caption is empty or exceeds 5,000 characters." };
    }
    const campaignId = String(source.campaignId || "").trim();
    if (campaignId && !/^[A-Za-z0-9_-]{1,80}$/.test(campaignId)) {
      return { valid: false, error: "The campaign handoff reference is invalid." };
    }
    const requiresPreApproval = source.requiresPreApproval === true;
    const preApprovalConfirmed = source.preApprovalConfirmed === true;
    const campaignPlatform = String(source.campaignPlatform || "").trim().slice(0, 80);
    const campaignStatus = String(source.campaignStatus || "").trim().toLowerCase().slice(0, 40);
    const rules = String(source.rules || "").slice(0, 12000);
    const durationSeconds = Number(source.durationSeconds);
    if (requiresPreApproval && !preApprovalConfirmed) {
      return { valid: false, error: "This campaign requires draft pre-approval. Do not publish until the campaign team has approved it." };
    }
    return {
      valid: true,
      platform,
      caption,
      title: String(source.title || "").trim().slice(0, 100),
      campaignId,
      campaignName: String(source.campaignName || "").trim().slice(0, 120),
      campaignPlatform,
      campaignStatus,
      rules,
      durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0,
      requiresPreApproval,
      preApprovalConfirmed,
      mediaFingerprint: {
        name: String(file.name || "").slice(0, 255),
        size: file.size,
        type: String(file.type || "").toLowerCase(),
        lastModified: Number(file.lastModified) || 0
      },
      file
    };
  }

  function analyzeSocialMetrics(values) {
    const reach = Number(values.reach);
    const likes = Number(values.likes);
    const comments = Number(values.comments);
    const shares = Number(values.shares);
    const clicks = Number(values.clicks);
    const orders = Number(values.orders);
    const all = [reach, likes, comments, shares, clicks, orders];
    if (all.some((n) => !Number.isFinite(n) || n < 0 || !Number.isSafeInteger(n))) {
      return { valid: false, error: "Enter whole numbers of zero or more for every metric." };
    }
    const interactions = likes + comments + shares;
    if (!Number.isSafeInteger(interactions)) {
      return { valid: false, error: "The combined likes, comments and shares exceed the safe numeric range." };
    }
    const rate = (numerator, denominator) => denominator > 0 ? numerator / denominator * 100 : null;
    const warnings = [];
    if (orders > clicks) {
      warnings.push("Orders exceed clicks; order rate is withheld. Check attribution IDs, metric definitions and matching reporting periods.");
    }
    return {
      valid: true,
      reach,
      interactions,
      engagementRate: rate(interactions, reach),
      clickThroughRate: rate(clicks, reach),
      orderRate: orders <= clicks ? rate(orders, clicks) : null,
      warnings,
      note: "Calculated from manually entered platform insights; not independently verified."
    };
  }

  function init(root) {
    const $ = (id) => root.document.getElementById(id);
    const fileInput = $("socialMediaFiles");
    const preview = $("socialMediaPreview");
    const uploadStatus = $("socialUploadStatus");
    const postStatus = $("socialPostStatus");
    let objectUrls = [];

    function clearPreview() {
      for (const url of objectUrls) root.URL.revokeObjectURL(url);
      objectUrls = [];
      preview.replaceChildren();
    }

    fileInput.addEventListener("change", () => {
      clearPreview();
      const files = Array.from(fileInput.files || []);
      if (files.length > MAX_FILES) {
        fileInput.value = "";
        uploadStatus.textContent = "Choose no more than 5 files.";
        return;
      }
      const invalid = files.find((file) => !(file.type.startsWith("image/") || file.type.startsWith("video/")) || file.size > MAX_FILE_BYTES);
      if (invalid) {
        fileInput.value = "";
        uploadStatus.textContent = "Only image/video files up to 50 MB each are supported.";
        return;
      }
      for (const file of files) {
        const url = root.URL.createObjectURL(file);
        objectUrls.push(url);
        const figure = root.document.createElement("figure");
        const media = root.document.createElement(file.type.startsWith("video/") ? "video" : "img");
        media.src = url;
        if (media.tagName.toLowerCase() === "video") {
          media.controls = true;
          media.playsInline = true;
        } else {
          media.alt = file.name;
        }
        const caption = root.document.createElement("figcaption");
        caption.textContent = file.name + " · " + (file.size / (1024 * 1024)).toFixed(2) + " MB";
        figure.append(media, caption);
        preview.append(figure);
      }
      uploadStatus.textContent = files.length
        ? files.length + " file(s) ready for local preview. Nothing has been uploaded or published."
        : "Choose media to preview it on this device. Files are not uploaded to this app.";
    });

    $("copySocialCaption").addEventListener("click", async () => {
      const caption = $("socialCaption").value.trim();
      if (!caption) {
        postStatus.textContent = "Write a caption before copying.";
        return;
      }
      try {
        await root.navigator.clipboard.writeText(caption);
        postStatus.textContent = "Caption copied. Open the platform and publish manually.";
      } catch {
        $("socialCaption").focus();
        $("socialCaption").select();
        postStatus.textContent = "Clipboard unavailable. Caption selected; copy it manually.";
      }
    });

    $("openSocialPlatform").addEventListener("click", () => {
      const platform = $("socialPlatform").value;
      const url = PLATFORM_URLS[platform];
      if (!url) {
        postStatus.textContent = "Choose a supported platform.";
        return;
      }
      root.open(url, "_blank", "noopener,noreferrer");
      postStatus.textContent = "Opened the official platform. Sign in there and upload/publish manually; this app did not post anything.";
    });

    function receiveClipHandoff(event) {
      if (!root.opener || event.source !== root.opener ||
          event.origin !== root.location.origin || !event.data ||
          event.data.type !== "AI_COMMERCE_CLIP_HANDOFF") return;
      const checked = validatePostHandoff(event.data.payload);
      if (!checked.valid) {
        root.opener.postMessage({
          type: "AI_COMMERCE_CLIP_HANDOFF_ACK",
          ok: false,
          error: checked.error
        }, event.origin);
        return;
      }
      $("socialPlatform").value = checked.platform;
      $("socialCaption").value = checked.caption;
      root.AICommerceSocialHandoff = {
        campaignId: checked.campaignId,
        campaignName: checked.campaignName,
        platform: checked.platform,
        requiresPreApproval: checked.requiresPreApproval,
        preApprovalConfirmed: checked.preApprovalConfirmed,
        campaignPlatform: checked.campaignPlatform,
        campaignStatus: checked.campaignStatus,
        rules: checked.rules,
        durationSeconds: checked.durationSeconds,
        mediaFingerprint: checked.mediaFingerprint
      };
      if (typeof root.CustomEvent === "function") {
        root.dispatchEvent(new root.CustomEvent("ai-commerce:social-handoff", {
          detail: root.AICommerceSocialHandoff
        }));
      }
      let mediaImported = false;
      try {
        if (!root.DataTransfer) throw new Error("DataTransfer is unavailable.");
        const transfer = new root.DataTransfer();
        transfer.items.add(checked.file);
        fileInput.files = transfer.files;
        fileInput.dispatchEvent(new root.Event("change", { bubbles: true }));
        mediaImported = true;
      } catch (_) {
        uploadStatus.textContent = "Caption imported. Select the source video manually; this browser does not support file handoff.";
      }
      postStatus.textContent = mediaImported
        ? "Video and caption imported from Clip Studio" + (checked.campaignName ? " for " + checked.campaignName : "") + ". Choose visibility, review the target channel and confirm any upload yourself."
        : "Caption imported from Clip Studio. The video still needs to be selected manually.";
      root.opener.postMessage({
        type: "AI_COMMERCE_CLIP_HANDOFF_ACK",
        ok: true,
        mediaImported
      }, event.origin);
    }
    root.addEventListener("message", receiveClipHandoff);
    if (root.opener && root.opener !== root && root.location.origin) {
      root.opener.postMessage({ type: "AI_COMMERCE_SOCIAL_DESK_READY" }, root.location.origin);
    }

    $("socialAnalyticsForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const result = analyzeSocialMetrics({
        reach: $("socialReach").value,
        likes: $("socialLikes").value,
        comments: $("socialComments").value,
        shares: $("socialShares").value,
        clicks: $("socialClicks").value,
        orders: $("socialOrders").value
      });
      const output = $("socialAnalyticsResults");
      output.replaceChildren();
      const card = root.document.createElement("article");
      card.className = "candidate-card";
      if (!result.valid) {
        card.textContent = result.error;
        output.append(card);
        return;
      }
      const heading = root.document.createElement("h3");
      heading.textContent = "Performance summary";
      const list = root.document.createElement("ul");
      const percent = (value) => value === null ? "Unavailable (denominator is zero)" : value.toFixed(2) + "%";
      for (const line of [
        "Reach / viewers: " + result.reach,
        "Interactions: " + result.interactions,
        "Engagement rate: " + percent(result.engagementRate),
        "Click-through rate: " + percent(result.clickThroughRate),
        "Attributed orders / clicks: " + percent(result.orderRate)
      ]) {
        const item = root.document.createElement("li");
        item.textContent = line;
        list.append(item);
      }
      const note = root.document.createElement("p");
      note.textContent = result.note;
      card.append(heading, list, note);
      if (result.warnings.length) {
        const warningList = root.document.createElement("ul");
        warningList.setAttribute("aria-label", "Data quality warnings");
        for (const warningText of result.warnings) {
          const warning = root.document.createElement("li");
          warning.textContent = warningText;
          warningList.append(warning);
        }
        card.append(warningList);
      }
      output.append(card);
    });
  }

  return { analyzeSocialMetrics, validatePostHandoff, init, PLATFORM_URLS, MAX_FILES, MAX_FILE_BYTES };
});
