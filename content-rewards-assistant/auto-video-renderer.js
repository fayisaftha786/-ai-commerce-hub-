(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClipRewardAutoVideoRenderer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const WIDTH = 720;
  const HEIGHT = 1280;
  const FPS = 24;
  const MIN_SECONDS = 15;
  const MAX_SECONDS = 90;
  const MIME_CANDIDATES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

  function clean(value, limit) {
    return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, limit || 180);
  }

  function resolveDuration(label) {
    const value = clean(label, 120);
    if (!value || /not stated/i.test(value)) return 15;
    let match = value.match(/(\d+)\s*[–-]\s*(\d+)\s*seconds?/i);
    let min = null;
    let max = null;
    if (match) {
      min = Number(match[1]);
      max = Number(match[2]);
    } else {
      match = value.match(/at least\s+(\d+)\s*seconds?/i);
      if (match) min = Number(match[1]);
      else {
        match = value.match(/up to\s+(\d+)\s*seconds?/i);
        if (match) max = Number(match[1]);
      }
    }
    if (min == null && max == null) return 15;
    if (min != null && (!Number.isFinite(min) || min < MIN_SECONDS || min > MAX_SECONDS)) {
      throw new Error("The campaign minimum duration is outside the automatic 15–90 second renderer limit.");
    }
    if (max != null && (!Number.isFinite(max) || max < MIN_SECONDS)) {
      throw new Error("The campaign maximum duration is shorter than the renderer's 15 second minimum.");
    }
    if (max != null && max > MAX_SECONDS && min == null) max = MAX_SECONDS;
    if (min != null && max != null && min > max) throw new Error("The campaign duration range is inconsistent.");
    const preferred = 30;
    const duration = min != null && max != null
      ? Math.min(max, Math.max(min, preferred))
      : min != null ? Math.max(min, preferred)
        : Math.min(max, preferred);
    if (duration > MAX_SECONDS) throw new Error("The campaign duration is longer than the automatic renderer supports.");
    return duration;
  }

  function prepare(pack) {
    if (!pack || pack.ok !== true || !pack.campaign || !pack.production ||
        !Array.isArray(pack.production.scenes) || pack.production.scenes.length !== 5 ||
        !Array.isArray(pack.campaign.acceptedPlatforms) || !pack.campaign.acceptedPlatforms.length) {
      throw new Error("A complete fresh campaign content pack is required before video creation.");
    }
    const title = clean(pack.campaign.title, 100);
    if (title.length < 3) throw new Error("The campaign title is missing.");
    const scenes = pack.production.scenes.map((scene, index) => {
      const rawMl = clean(scene && scene.voiceoverMl, 220);
      const rawEn = clean(scene && scene.voiceoverEn, 220);
      const needsEvidence = /\[insert|\[സ്ഥിരീകരിച്ച/i.test(rawMl + " " + rawEn);
      return {
        index: index + 1,
        label: ["HOOK", "CONTEXT", "VERIFIED POINT", "TAKEAWAY", "NEXT STEP"][index],
        title: index === 0 ? title : ["A quick introduction", "What this is about", "Your verified observation", "What can be confirmed", "Check the official details"][index],
        ml: needsEvidence ? "പ്രസിദ്ധീകരിക്കുന്നതിന് മുമ്പ് നിങ്ങളുടെ സ്ഥിരീകരിച്ച വിവരം ചേർക്കുക." : rawMl,
        en: needsEvidence ? "Add your own verified observation before publishing." : rawEn,
        needsEvidence
      };
    });
    const tags = Array.isArray(pack.hashtagsFound) ? pack.hashtagsFound.map((v) => clean(v, 60)).filter((v) => /^#[a-z0-9_]+$/i.test(v)).slice(0, 8) : [];
    const mentions = Array.isArray(pack.mentionsFound) ? pack.mentionsFound.map((v) => clean(v, 80)).filter((v) => /^@[a-z0-9._]{2,}$/i.test(v)).slice(0, 5) : [];
    const disclosure = Array.isArray(pack.disclosureRules) ? pack.disclosureRules.map((v) => clean(v, 160)).filter(Boolean).slice(0, 3) : [];
    return {
      title,
      platform: clean(pack.campaign.acceptedPlatforms[0], 30),
      platforms: pack.campaign.acceptedPlatforms.map((v) => clean(v, 30)).filter(Boolean),
      durationSeconds: resolveDuration(pack.production.duration),
      durationSource: /not stated/i.test(clean(pack.production.duration, 120)) ? "defaulted because the public brief did not state a duration" : "campaign brief",
      scenes,
      tags,
      mentions,
      disclosure
    };
  }

  function wrapText(context, text, x, y, maxWidth, lineHeight, maxLines) {
    const words = String(text || "").split(/\s+/);
    let line = "";
    let lines = 0;
    for (const word of words) {
      const next = line ? line + " " + word : word;
      if (line && context.measureText(next).width > maxWidth) {
        context.fillText(line, x, y + lines * lineHeight);
        lines += 1;
        line = word;
        if (lines >= maxLines) break;
      } else line = next;
    }
    if (line && lines < maxLines) context.fillText(line, x, y + lines * lineHeight);
    return Math.min(lines + (line ? 1 : 0), maxLines);
  }

  function drawFrame(context, prepared, elapsed, durationSeconds) {
    const progress = Math.max(0, Math.min(0.9999, elapsed / (durationSeconds * 1000)));
    const sceneIndex = Math.min(4, Math.floor(progress * 5));
    const scene = prepared.scenes[sceneIndex];
    const sceneProgress = (progress * 5) - sceneIndex;
    const alpha = Math.min(1, sceneProgress * 5 + 0.15);
    context.save();
    context.globalAlpha = 1;
    const gradient = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
    gradient.addColorStop(0, "#111a31");
    gradient.addColorStop(0.55, "#20224a");
    gradient.addColorStop(1, "#101827");
    context.fillStyle = gradient;
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.globalAlpha = 0.14;
    context.fillStyle = "#8b7cff";
    context.beginPath(); context.arc(590, 240, 210, 0, Math.PI * 2); context.fill();
    context.fillStyle = "#36b8c8";
    context.beginPath(); context.arc(90, 1080, 190, 0, Math.PI * 2); context.fill();
    context.globalAlpha = alpha;
    context.fillStyle = "#b8b0ff";
    context.font = "700 20px system-ui, sans-serif";
    context.fillText("CLIPREWARD STUDIO", 54, 82);
    context.fillStyle = "#91a2c3";
    context.font = "600 16px system-ui, sans-serif";
    context.fillText(scene.label + "  ·  0" + (sceneIndex + 1) + "/05", 54, 142);
    context.fillStyle = "#ffffff";
    context.font = "800 43px system-ui, sans-serif";
    const titleLines = wrapText(context, scene.title, 54, 280, 612, 54, 3);
    const bodyY = 390 + (titleLines - 1) * 54;
    context.fillStyle = "#e9eafa";
    context.font = "600 31px system-ui, sans-serif";
    const mlLines = wrapText(context, scene.ml, 54, bodyY, 612, 47, 5);
    context.fillStyle = "#aebbd5";
    context.font = "500 23px system-ui, sans-serif";
    wrapText(context, scene.en, 54, bodyY + mlLines * 47 + 42, 612, 36, 4);
    if (scene.needsEvidence) {
      context.fillStyle = "#ffd48a";
      context.font = "700 18px system-ui, sans-serif";
      context.fillText("ADD VERIFIED DETAIL BEFORE POSTING", 54, 1000);
    }
    if (sceneIndex === 4) {
      const extras = [...prepared.tags, ...prepared.mentions].join(" ");
      if (extras) {
        context.fillStyle = "#c8c5ff";
        context.font = "600 17px system-ui, sans-serif";
        wrapText(context, extras, 54, 1035, 612, 26, 2);
      }
      if (prepared.disclosure.length) {
        context.fillStyle = "#ffd48a";
        context.font = "500 15px system-ui, sans-serif";
        wrapText(context, "Disclosure: " + prepared.disclosure[0], 54, 1110, 612, 22, 2);
      }
    }
    context.globalAlpha = 1;
    context.fillStyle = "rgba(255,255,255,.16)";
    context.fillRect(54, 1190, 612, 5);
    context.fillStyle = "#a99fff";
    context.fillRect(54, 1190, 612 * progress, 5);
    context.fillStyle = "#9aa9c3";
    context.font = "500 15px system-ui, sans-serif";
    context.fillText(prepared.platforms.join(" · "), 54, 1235);
    context.restore();
  }

  function chooseWebm(Recorder) {
    if (!Recorder || typeof Recorder.isTypeSupported !== "function") return "";
    for (const type of MIME_CANDIDATES) {
      try { if (Recorder.isTypeSupported(type)) return type; } catch (_) {}
    }
    return "";
  }

  function getCapabilities(environment) {
    const env = environment || root;
    let canvasCapture = false;
    try { canvasCapture = !!(env && env.document && env.document.createElement("canvas").captureStream); } catch (_) {}
    const mimeType = chooseWebm(env && env.MediaRecorder);
    const missing = [];
    if (!env || !env.MediaRecorder) missing.push("MediaRecorder");
    if (!canvasCapture) missing.push("Canvas captureStream");
    if (!mimeType) missing.push("WebM codec");
    if (!env || typeof env.requestAnimationFrame !== "function") missing.push("requestAnimationFrame");
    return { supported: missing.length === 0, mimeType, extension: "webm", width: WIDTH, height: HEIGHT, fps: FPS, missing };
  }

  async function render(pack, environment) {
    const env = environment || root;
    const prepared = prepare(pack);
    const capabilities = getCapabilities(env);
    if (!capabilities.supported) throw new Error("Automatic video export is unavailable in this browser. Missing: " + capabilities.missing.join(", ") + ".");
    const canvas = env.document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Could not create the video drawing surface.");
    const stream = canvas.captureStream(FPS);
    let recorder;
    try {
      recorder = new env.MediaRecorder(stream, { mimeType: capabilities.mimeType, videoBitsPerSecond: 2200000 });
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("The browser could not start WebM recording: " + (error && error.message || "unsupported codec"));
    }
    const chunks = [];
    const durationMs = prepared.durationSeconds * 1000;
    return new Promise((resolve, reject) => {
      let startedAt = null;
      let finished = false;
      const cleanup = () => stream.getTracks().forEach((track) => track.stop());
      const fail = (error) => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(error instanceof Error ? error : new Error("Video export failed."));
      };
      recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
      recorder.onerror = (event) => fail(event && event.error || new Error("WebM recording failed."));
      recorder.onstop = () => {
        if (finished) return;
        finished = true;
        cleanup();
        const blob = new env.Blob(chunks, { type: recorder.mimeType || capabilities.mimeType });
        if (!blob.size) return reject(new Error("The browser returned an empty video file. Try Chrome and export again."));
        resolve({
          blob,
          mimeType: recorder.mimeType || capabilities.mimeType,
          extension: "webm",
          durationSeconds: prepared.durationSeconds,
          width: WIDTH,
          height: HEIGHT,
          fps: FPS,
          silent: true,
          textOnly: true,
          durationSource: prepared.durationSource
        });
      };
      try {
        recorder.start(250);
        const frame = (timestamp) => {
          if (finished) return;
          if (startedAt == null) startedAt = timestamp;
          const elapsed = Math.max(0, timestamp - startedAt);
          drawFrame(context, prepared, elapsed, prepared.durationSeconds);
          if (elapsed >= durationMs) {
            try { recorder.stop(); } catch (error) { fail(error); }
            return;
          }
          env.requestAnimationFrame(frame);
        };
        env.requestAnimationFrame(frame);
      } catch (error) { fail(error); }
    });
  }

  return { WIDTH, HEIGHT, FPS, prepare, resolveDuration, getCapabilities, render };
});
