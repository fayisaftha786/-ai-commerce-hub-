"use strict";

(() => {
  const MAX_FILES = 8;
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const WIDTH = 720;
  const HEIGHT = 1280;
  const TARGET_VIDEO_MS = 16000;
  const MIN_SCENE_MS = 2600;
  const MIN_SCENES = 4;

  const byId = (id) => document.getElementById(id);
  const form = byId("videoMakerForm");
  if (!form) return;

  let previousUrl = null;
  const status = byId("videoMakerStatus");
  const submit = byId("createVideo");

  function cleanText(value, maxLength) {
    return String(value || "").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, maxLength);
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("One uploaded image could not be opened. Try a different image file.")); };
      image.src = objectUrl;
    });
  }

  function loadRemoteImage(value) {
    return new Promise((resolve, reject) => {
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        reject(new Error("Enter a valid HTTPS product image URL."));
        return;
      }
      if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
        reject(new Error("Product image URLs must use HTTPS and must not contain embedded credentials."));
        return;
      }
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.referrerPolicy = "no-referrer";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The image host blocked canvas access or the URL is not a direct image. Upload an authorised image file instead."));
      image.src = parsed.href;
    });
  }

  window.addEventListener("commerce:prepare-video", (event) => {
    const product = event.detail || {};
    byId("videoMakerName").value = cleanText(product.name, 100);
    byId("videoMakerImageUrl").value = cleanText(product.imageUrl, 2048);
    byId("videoMakerBenefit").value = "";
    byId("videoMakerPrice").value = "";
    byId("videoMakerImages").value = "";
    status.textContent = product.imageUrl
      ? "Product details loaded. Add a verified benefit; if the remote image is blocked, upload the image file."
      : "Product name loaded. Add a verified benefit and upload an authorised product image.";
    byId("videoMakerBenefit").focus({ preventScroll: true });
  });

  function drawSlide(ctx, image, title, benefit, price, cta, language, index, total, progress = 0) {
    ctx.fillStyle = "#101522";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const maxW = WIDTH - 64;
    const maxH = 760;
    const baseScale = Math.min(maxW / image.width, maxH / image.height);
    // A restrained Ken Burns-style push-in keeps still product photos from feeling static.
    const scale = baseScale * (1 + Math.max(0, Math.min(1, progress)) * 0.045);
    const w = image.width * scale;
    const h = image.height * scale;
    const x = (WIDTH - w) / 2;
    const y = 80 + (maxH - h) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(24, 48, WIDTH - 48, 824, 24);
    ctx.clip();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(24, 48, WIDTH - 48, 824);
    ctx.drawImage(image, x, y, w, h);
    ctx.restore();

    ctx.fillStyle = "#85d8bd";
    ctx.font = "bold 24px system-ui, sans-serif";
    const sceneLabel = total === 1
      ? (language === "Malayalam" ? "ഉൽപ്പന്നം പരിചയപ്പെടാം" : "PRODUCT SPOTLIGHT")
      : index === 0
        ? (language === "Malayalam" ? "ശ്രദ്ധിക്കൂ!" : "STOP THE SCROLL")
        : index === total - 1
          ? (language === "Malayalam" ? "വിശദാംശങ്ങൾ പരിശോധിക്കൂ" : "TAKE A CLOSER LOOK")
          : (language === "Malayalam" ? "പ്രധാന ഗുണം" : "WHY IT MAY HELP");
    ctx.fillText(sceneLabel, 36, 930);
    const isHook = index === 0 && total > 1;
    const isClosing = index === total - 1 && total > 1;
    const isBenefit = !isHook && !isClosing;
    // Give each scene a different purpose instead of repeating identical copy across
    // every frame. Keep the hook generic and only use the user-supplied benefit as a claim.
    const sceneTitle = isHook
      ? (language === "Malayalam" ? "വാങ്ങുന്നതിന് മുമ്പ് ഒന്ന് നോക്കൂ" : "Before you decide, take a look")
      : isClosing
        ? (language === "Malayalam" ? "വിശദാംശങ്ങൾ പരിശോധിക്കൂ" : "Check the details first")
        : title;
    const sceneBenefit = isHook
      ? (language === "Malayalam" ? title + " നിങ്ങളുടെ ആവശ്യത്തിന് യോജിക്കുമോ?" : "Could " + title + " fit your needs?")
      : isClosing
        ? cta
        : benefit;
    ctx.fillStyle = "#ffffff";
    ctx.font = isHook ? "bold 42px system-ui, sans-serif" : "bold 34px system-ui, sans-serif";
    const lines = wrapText(ctx, sceneTitle, WIDTH - 72, 2);
    lines.forEach((line, i) => ctx.fillText(line, 36, 988 + i * (isHook ? 46 : 40)));
    ctx.fillStyle = isBenefit ? "#85d8bd" : "#cbd5e1";
    ctx.font = isBenefit ? "bold 30px system-ui, sans-serif" : "26px system-ui, sans-serif";
    wrapText(ctx, sceneBenefit, WIDTH - 72, 2).forEach((line, i) => ctx.fillText(line, 36, 1095 + i * 34));
    if (price && !isClosing) {
      ctx.fillStyle = "#f4d35e";
      ctx.font = "bold 32px system-ui, sans-serif";
      ctx.fillText(price, 36, 1180);
    }
    ctx.fillStyle = "#101522";
    ctx.fillRect(24, 1210, WIDTH - 48, 54);
    ctx.fillStyle = "#85d8bd";
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.fillText(isClosing ? (language === "Malayalam" ? "വിലയും ലഭ്യതയും പരിശോധിക്കൂ" : "Verify price and availability") : cta, 36, 1245, WIDTH - 72);
    ctx.fillStyle = "#101522";
    ctx.fillRect(24, 8, WIDTH - 48, 34);
    ctx.fillStyle = "#f4d35e";
    ctx.font = "bold 17px system-ui, sans-serif";
    const disclosure = language === "Malayalam"
      ? "അഫിലിയേറ്റ് ലിങ്ക് • വാങ്ങിയാൽ കമ്മീഷൻ ലഭിക്കാം"
      : "Affiliate link • I may earn a commission";
    ctx.fillText(disclosure, 36, 30, WIDTH - 140);
    ctx.fillStyle = "#aab4c7";
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillText((index + 1) + " / " + total, WIDTH - 90, 30);
  }

  function wrapText(ctx, text, maxWidth, maxLines) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? line + " " + word : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      lines.length = maxLines;
      const last = lines[maxLines - 1];
      lines[maxLines - 1] = last.length > 3 ? last.slice(0, -3) + "…" : last;
    }
    return lines;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const files = Array.from(byId("videoMakerImages").files || []);
    const imageUrl = byId("videoMakerImageUrl").value.trim();
    if (!files.length && !imageUrl) {
      status.textContent = "Choose at least one authorised image file or enter a direct HTTPS image URL.";
      return;
    }
    if (files.length + (imageUrl ? 1 : 0) > MAX_FILES) {
      status.textContent = "Use no more than 8 images in total.";
      return;
    }
    if (files.some((file) => !file.type.startsWith("image/") || file.size > MAX_FILE_BYTES)) {
      status.textContent = "Choose image files only; each file must be 10 MB or smaller.";
      return;
    }
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      status.textContent = "Video export is not supported by this browser. Try a recent version of Chrome.";
      return;
    }
    if (typeof MediaRecorder.isTypeSupported === "function" && !MediaRecorder.isTypeSupported("video/webm")) {
      status.textContent = "This browser does not support WebM video export.";
      return;
    }

    const title = cleanText(byId("videoMakerName").value, 100);
    const benefit = cleanText(byId("videoMakerBenefit").value, 140);
    const price = cleanText(byId("videoMakerPrice").value, 30);
    const cta = cleanText(byId("videoMakerCta").value || "Check details and current price", 100);
    const language = byId("videoMakerLanguage").value === "Malayalam" ? "Malayalam" : "English";
    if (!title || !benefit || !cta) {
      status.textContent = "Enter a product name, benefit and call to action.";
      return;
    }

    submit.disabled = true;
    byId("videoMakerDownload").replaceChildren();
    status.textContent = "Preparing images…";
    let activeStream = null;
    let activeRecorder = null;
    try {
      const images = [];
      const uploadedImages = await Promise.all(files.map(loadImage));
      let remoteImageWarning = "";
      if (imageUrl) {
        try {
          images.push(await loadRemoteImage(imageUrl));
        } catch (error) {
          // A cross-origin host can block canvas export. Do not discard valid uploaded
          // images just because the optional remote image cannot be used.
          if (!uploadedImages.length) throw error;
          remoteImageWarning = " Remote image unavailable; using the uploaded image files instead.";
        }
      }
      images.push(...uploadedImages);
      if (!images.length) throw new Error("No usable product images were loaded. Upload an authorised image file.");
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is unavailable in this browser.");

      const stream = canvas.captureStream(30);
      activeStream = stream;
      const chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      activeRecorder = recorder;
      const finished = new Promise((resolve, reject) => {
        recorder.addEventListener("dataavailable", (e) => { if (e.data && e.data.size) chunks.push(e.data); });
        recorder.addEventListener("stop", resolve, { once: true });
        recorder.addEventListener("error", () => reject(new Error("The browser could not record the video.")), { once: true });
      });
      recorder.start();
      // Build a complete short-form storyboard even when the user has only one product photo.
      // Reuse authorised images across hook, benefit and closing scenes rather than inventing footage.
      const sceneCount = Math.max(MIN_SCENES, images.length);
      const sceneDuration = Math.max(MIN_SCENE_MS, Math.round(TARGET_VIDEO_MS / sceneCount));
      for (let i = 0; i < sceneCount; i++) {
        status.textContent = "Creating animated scene " + (i + 1) + " of " + sceneCount;
        const sceneStart = performance.now();
        await new Promise((resolve) => {
          const paintFrame = (now) => {
            const progress = Math.min(1, (now - sceneStart) / sceneDuration);
            drawSlide(ctx, images[i % images.length], title, benefit, price, cta, language, i, sceneCount, progress);
            if (progress < 1) requestAnimationFrame(paintFrame);
            else resolve();
          };
          requestAnimationFrame(paintFrame);
        });
      }
      recorder.stop();
      await finished;
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: "video/webm" });
      if (!blob.size) throw new Error("The exported video was empty. Try fewer or smaller images.");
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      previousUrl = URL.createObjectURL(blob);
      const preview = byId("videoMakerPreview");
      preview.src = previousUrl;
      preview.hidden = false;
      const link = document.createElement("a");
      link.href = previousUrl;
      const filename = title
        .normalize("NFKD")
        .replace(/[\\u0300-\\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60)
        .toLowerCase() || "product";
      link.download = filename + "-video.webm";
      link.textContent = "Download your video (WebM)";
      byId("videoMakerDownload").append(link);
      status.textContent = "Video ready. Watch it and verify every detail before publishing." + remoteImageWarning;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Could not create the video.";
    } finally {
      // Always release camera-free canvas capture tracks, including error paths.
      if (activeRecorder && activeRecorder.state !== "inactive") {
        try { activeRecorder.stop(); } catch { /* already stopped by the browser */ }
      }
      if (activeStream) activeStream.getTracks().forEach((track) => track.stop());
      submit.disabled = false;
    }
  });
})();
