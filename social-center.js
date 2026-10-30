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
    whatsapp: "https://web.whatsapp.com/"
  });
  const MAX_FILES = 5;
  const MAX_FILE_BYTES = 50 * 1024 * 1024;

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

  return { analyzeSocialMetrics, init, PLATFORM_URLS, MAX_FILES, MAX_FILE_BYTES };
});
