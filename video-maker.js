"use strict";

(() => {
  const MAX_FILES = 8;
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const WIDTH = 720;
  const HEIGHT = 1280;
  const SLIDE_MS = 2600;

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
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("One image could not be opened. Try a different image file.")); };
      image.src = url;
    });
  }

  function drawSlide(ctx, image, title, benefit, price, cta, language, index, total) {
    ctx.fillStyle = "#101522";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const maxW = WIDTH - 64;
    const maxH = 760;
    const scale = Math.min(maxW / image.width, maxH / image.height);
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
    ctx.fillText("PRODUCT SPOTLIGHT", 36, 930);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 42px system-ui, sans-serif";
    const lines = wrapText(ctx, title, WIDTH - 72, 2);
    lines.forEach((line, i) => ctx.fillText(line, 36, 988 + i * 48));
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "26px system-ui, sans-serif";
    wrapText(ctx, benefit, WIDTH - 72, 2).forEach((line, i) => ctx.fillText(line, 36, 1095 + i * 34));
    if (price) {
      ctx.fillStyle = "#f4d35e";
      ctx.font = "bold 32px system-ui, sans-serif";
      ctx.fillText(price, 36, 1180);
    }
    ctx.fillStyle = "#101522";
    ctx.fillRect(24, 1210, WIDTH - 48, 54);
    ctx.fillStyle = "#85d8bd";
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.fillText(cta, 36, 1245, WIDTH - 72);
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
    if (!files.length || files.length > MAX_FILES) {
      status.textContent = "Choose between 1 and 8 images.";
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
    try {
      const images = await Promise.all(files.map(loadImage));
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is unavailable in this browser.");

      const stream = canvas.captureStream(30);
      const chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      const finished = new Promise((resolve, reject) => {
        recorder.addEventListener("dataavailable", (e) => { if (e.data && e.data.size) chunks.push(e.data); });
        recorder.addEventListener("stop", resolve, { once: true });
        recorder.addEventListener("error", () => reject(new Error("The browser could not record the video.")), { once: true });
      });
      recorder.start();
      for (let i = 0; i < images.length; i++) {
        drawSlide(ctx, images[i], title, benefit, price, cta, language, i, images.length);
        status.textContent = "Creating video… slide " + (i + 1) + " of " + images.length;
        await new Promise((resolve) => setTimeout(resolve, SLIDE_MS));
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
      link.download = "ai-commerce-product-video.webm";
      link.textContent = "Download your video (WebM)";
      byId("videoMakerDownload").append(link);
      status.textContent = "Video ready. Watch it and verify every detail before publishing.";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Could not create the video.";
    } finally {
      submit.disabled = false;
    }
  });
})();
