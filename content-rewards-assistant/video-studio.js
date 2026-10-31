(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClipRewardVideoStudio = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const MAX_MEDIA_FILES = 8;
  const MAX_MEDIA_BYTES = 150 * 1024 * 1024;
  const MAX_AUDIO_BYTES = 40 * 1024 * 1024;
  const WIDTH = 720;
  const HEIGHT = 1280;
  const FPS = 24;
  const MIME_CANDIDATES = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1.4D401F",
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];

  function chooseMimeType(mediaRecorder) {
    if (!mediaRecorder || typeof mediaRecorder.isTypeSupported !== "function") return "";
    for (const candidate of MIME_CANDIDATES) {
      try {
        if (mediaRecorder.isTypeSupported(candidate)) return candidate;
      } catch (_) {}
    }
    return "";
  }

  function getCapabilities(environment) {
    const env = environment || root;
    const Recorder = env && env.MediaRecorder;
    let canvasCapture = false;
    try {
      const canvas = env && env.document && env.document.createElement("canvas");
      canvasCapture = !!(canvas && typeof canvas.captureStream === "function");
    } catch (_) {}
    const mimeType = chooseMimeType(Recorder);
    const missing = [];
    if (!Recorder) missing.push("MediaRecorder API");
    if (!canvasCapture) missing.push("Canvas captureStream");
    if (!mimeType) missing.push("MP4/WebM recording codec");
    if (!env || typeof env.requestAnimationFrame !== "function") missing.push("requestAnimationFrame");
    return {
      supported: missing.length === 0,
      mimeType,
      extension: mimeType.indexOf("mp4") >= 0 ? "mp4" : mimeType ? "webm" : "",
      formatLabel: mimeType.indexOf("mp4") >= 0 ? "MP4" : mimeType ? "WebM" : "Not supported",
      width: WIDTH,
      height: HEIGHT,
      fps: FPS,
      missing
    };
  }

  function fileKind(file) {
    const type = String(file && file.type || "").toLowerCase();
    if (type.startsWith("image/")) return "image";
    if (type.startsWith("video/")) return "video";
    const name = String(file && file.name || "").toLowerCase();
    if (/\.(jpe?g|png|webp|gif)$/i.test(name)) return "image";
    if (/\.(mp4|m4v|webm|mov|3gp)$/i.test(name)) return "video";
    return "";
  }

  function validateFiles(files, audioFile) {
    const list = Array.from(files || []);
    if (list.length === 0) throw new Error("Upload at least one photo or video clip.");
    if (list.length > MAX_MEDIA_FILES) throw new Error("Use no more than " + MAX_MEDIA_FILES + " media files in one export.");
    let total = 0;
    for (const file of list) {
      if (!file || !fileKind(file)) throw new Error("Unsupported media file. Choose JPG, PNG, WebP, MP4, WebM or MOV.");
      if (!Number.isFinite(file.size) || file.size <= 0) throw new Error("One of the selected media files is empty or unreadable.");
      total += file.size;
    }
    if (total > MAX_MEDIA_BYTES) throw new Error("Selected media is larger than 150 MB. Use shorter or smaller source files.");
    if (audioFile) {
      const type = String(audioFile.type || "").toLowerCase();
      const name = String(audioFile.name || "").toLowerCase();
      if (!(type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|ogg|opus)$/i.test(name))) {
        throw new Error("Audio must be MP3, M4A, AAC, WAV or OGG.");
      }
      if (!Number.isFinite(audioFile.size) || audioFile.size <= 0 || audioFile.size > MAX_AUDIO_BYTES) {
        throw new Error("Audio file must be between 1 byte and 40 MB.");
      }
    }
    return { count: list.length, mediaBytes: total, audioBytes: audioFile ? audioFile.size : 0 };
  }

  function splitCaptions(value) {
    return String(value || "").replace(/\r/g, "").split("\n")
      .map((line) => line.trim()).filter(Boolean).slice(0, MAX_MEDIA_FILES);
  }

  function validateRenderedMetadata(metadata, expectedDuration, width, height) {
    const data = metadata || {};
    if (!Number.isFinite(data.duration) || data.duration <= 0) throw new Error("The exported video has no readable duration.");
    if (data.duration < expectedDuration - 1.5 || data.duration > expectedDuration + 2) {
      throw new Error("Export duration check failed. Expected about " + expectedDuration + " seconds; received " + data.duration.toFixed(2) + " seconds.");
    }
    if (data.width !== width || data.height !== height) {
      throw new Error("Export size check failed. Expected " + width + " × " + height + "; received " + data.width + " × " + data.height + ".");
    }
    return true;
  }

  function wrapText(context, text, maxWidth) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
      const next = line ? line + " " + word : word;
      if (line && context.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines.slice(0, 4);
  }

  function waitForMedia(element, eventName, timeoutMs, label) {
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        element.removeEventListener("load", loaded);
        element.removeEventListener("loadedmetadata", loaded);
        element.removeEventListener("error", failed);
      };
      const loaded = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error("Could not decode " + label + ". Try another source file.")); };
      element.addEventListener(eventName, loaded, { once: true });
      if (eventName !== "load") element.addEventListener("loadedmetadata", loaded, { once: true });
      element.addEventListener("error", failed, { once: true });
      timer = setTimeout(() => { cleanup(); reject(new Error("Timed out loading " + label + ".")); }, timeoutMs || 15000);
    });
  }

  async function loadMedia(files, urls) {
    const documentRef = root.document;
    const scenes = [];
    for (const file of files) {
      const url = root.URL.createObjectURL(file);
      urls.push(url);
      if (fileKind(file) === "image") {
        const image = documentRef.createElement("img");
        image.decoding = "async";
        const loaded = waitForMedia(image, "load", 20000, file.name || "image");
        image.src = url;
        await loaded;
        if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) throw new Error("Image dimensions could not be read.");
        scenes.push({ kind: "image", element: image, name: file.name || "image" });
      } else {
        const video = documentRef.createElement("video");
        video.muted = true;
        video.defaultMuted = true;
        video.playsInline = true;
        video.loop = true;
        video.preload = "auto";
        video.crossOrigin = "anonymous";
        const loaded = waitForMedia(video, "loadedmetadata", 20000, file.name || "video");
        video.src = url;
        if (typeof video.load === "function") video.load();
        await loaded;
        if (!(video.videoWidth > 0 && video.videoHeight > 0)) throw new Error("Video dimensions could not be read.");
        scenes.push({ kind: "video", element: video, name: file.name || "video" });
      }
    }
    return scenes;
  }

  function drawCover(context, source, width, height) {
    const sourceWidth = source.videoWidth || source.naturalWidth || source.width;
    const sourceHeight = source.videoHeight || source.naturalHeight || source.height;
    if (!(sourceWidth > 0 && sourceHeight > 0)) return false;
    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    const x = (width - drawWidth) / 2;
    const y = (height - drawHeight) / 2;
    context.drawImage(source, x, y, drawWidth, drawHeight);
    return true;
  }

  async function verifyBlob(blob, expectedDuration) {
    if (!blob || blob.size < 1024) throw new Error("The renderer produced an empty or incomplete video file.");
    if (!/^video\/(mp4|webm)/i.test(blob.type)) throw new Error("The browser returned an unsupported video file type: " + (blob.type || "unknown"));
    const url = root.URL.createObjectURL(blob);
    try {
      const video = root.document.createElement("video");
      video.preload = "metadata";
      const loaded = waitForMedia(video, "loadedmetadata", 20000, "rendered video");
      video.src = url;
      if (typeof video.load === "function") video.load();
      await loaded;
      validateRenderedMetadata({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight
      }, expectedDuration, WIDTH, HEIGHT);
      return { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
    } finally {
      root.URL.revokeObjectURL(url);
    }
  }

  function createMediaRecorder(stream, videoBitsPerSecond) {
    const Recorder = root.MediaRecorder;
    let lastError = null;
    for (const candidate of MIME_CANDIDATES) {
      let supported = false;
      try { supported = Recorder.isTypeSupported(candidate); } catch (_) {}
      if (!supported) continue;
      try {
        return new Recorder(stream, { mimeType: candidate, videoBitsPerSecond });
      } catch (error) { lastError = error; }
    }
    try { return new Recorder(stream, { videoBitsPerSecond }); }
    catch (error) {
      throw new Error("The browser reported a recording codec but could not start MediaRecorder. " +
        ((error && error.message) || (lastError && lastError.message) || "Try Chrome or another supported browser."));
    }
  }

  async function render(options) {
    const opts = options || {};
    const files = Array.from(opts.files || []);
    const duration = Number(opts.durationSeconds || 30);
    if (![15, 30, 60].includes(duration)) throw new Error("Choose a 15, 30 or 60 second export.");
    validateFiles(files, opts.audioFile);
    const capabilities = getCapabilities(root);
    if (!capabilities.supported) throw new Error("Video export is not supported in this browser. Missing: " + capabilities.missing.join(", ") + ".");
    const documentRef = root.document;
    const canvas = documentRef.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Could not create the video drawing surface.");
    const urls = [];
    const tracks = [];
    let audioContext = null;
    let recorder = null;
    let animationId = null;
    let cancelled = false;
    const signal = opts.signal;
    const abortError = () => {
      const error = new Error("Video export was cancelled.");
      error.name = "AbortError";
      return error;
    };
    const onAbort = () => { cancelled = true; };
    if (signal) {
      if (signal.aborted) throw abortError();
      signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      let audioResume = null;
      if (opts.audioFile) {
        const AudioContextClass = root.AudioContext || root.webkitAudioContext;
        if (!AudioContextClass) throw new Error("This browser cannot mix an uploaded voice-over or music track.");
        audioContext = new AudioContextClass();
        // Create and resume the audio context during the user's button gesture.
        audioResume = audioContext.resume();
      }
      const scenes = await loadMedia(files, urls);
      const captions = splitCaptions(opts.captions);
      const sceneDuration = duration / scenes.length;
      const stream = canvas.captureStream(FPS);
      tracks.push(...stream.getTracks());
      if (!tracks.some((track) => track.kind === "video")) throw new Error("The browser did not create a video capture track.");

      if (opts.audioFile) {
        await audioResume;
        const decoded = await audioContext.decodeAudioData(await opts.audioFile.arrayBuffer());
        const destination = audioContext.createMediaStreamDestination();
        const source = audioContext.createBufferSource();
        const gain = audioContext.createGain();
        source.buffer = decoded;
        source.loop = decoded.duration < duration;
        gain.gain.value = 0.9;
        source.connect(gain);
        gain.connect(destination);
        destination.stream.getAudioTracks().forEach((track) => {
          stream.addTrack(track);
          tracks.push(track);
        });
        source.start(0);
      }

      const chunks = [];
      recorder = createMediaRecorder(stream, 2500000);
      const stopped = new Promise((resolve, reject) => {
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data && event.data.size) chunks.push(event.data);
        });
        recorder.addEventListener("error", () => reject(new Error("The browser's media recorder stopped unexpectedly.")), { once: true });
        recorder.addEventListener("stop", resolve, { once: true });
      });

      function paint(elapsed) {
        const sceneIndex = Math.min(scenes.length - 1, Math.floor(elapsed / sceneDuration));
        const scene = scenes[sceneIndex];
        scenes.forEach((item, index) => {
          if (item.kind !== "video") return;
          if (index === sceneIndex) {
            if (item.element.paused) item.element.play().catch(() => {});
          } else if (!item.element.paused) item.element.pause();
        });
        context.fillStyle = "#080d1a";
        context.fillRect(0, 0, WIDTH, HEIGHT);
        try { drawCover(context, scene.element, WIDTH, HEIGHT); } catch (_) {}
        const caption = captions[sceneIndex] || "";
        if (caption) {
          const lines = wrapText(context, caption, WIDTH - 104);
          const lineHeight = 48;
          const boxHeight = lines.length * lineHeight + 54;
          const top = HEIGHT - boxHeight - 96;
          context.fillStyle = "rgba(4, 8, 18, 0.78)";
          context.fillRect(34, top, WIDTH - 68, boxHeight);
          context.fillStyle = "#ffffff";
          context.font = "bold 38px Arial, sans-serif";
          context.textAlign = "center";
          context.textBaseline = "middle";
          lines.forEach((line, index) => context.fillText(line, WIDTH / 2, top + 27 + lineHeight * (index + 0.5), WIDTH - 104));
        }
        context.fillStyle = "rgba(255,255,255,0.86)";
        context.fillRect(34, HEIGHT - 36, WIDTH - 68, 6);
        context.fillStyle = "#8b7cff";
        context.fillRect(34, HEIGHT - 36, (WIDTH - 68) * Math.min(1, elapsed / duration), 6);
      }

      recorder.start(500);
      const startedAt = root.performance && root.performance.now ? root.performance.now() : Date.now();
      await new Promise((resolve, reject) => {
        const tick = () => {
          if (cancelled || (signal && signal.aborted)) {
            reject(abortError());
            return;
          }
          const now = root.performance && root.performance.now ? root.performance.now() : Date.now();
          const elapsed = Math.min(duration, (now - startedAt) / 1000);
          paint(elapsed);
          if (typeof opts.onProgress === "function") opts.onProgress(Math.min(100, Math.round(elapsed / duration * 100)));
          if (elapsed >= duration) {
            resolve();
            return;
          }
          animationId = root.requestAnimationFrame(tick);
        };
        animationId = root.requestAnimationFrame(tick);
      });
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
      if (cancelled || (signal && signal.aborted)) throw abortError();
      const blob = new root.Blob(chunks, { type: recorder.mimeType || capabilities.mimeType });
      const metadata = await verifyBlob(blob, duration);
      if (typeof opts.onProgress === "function") opts.onProgress(100);
      return {
        blob,
        mimeType: blob.type,
        extension: blob.type.indexOf("mp4") >= 0 ? "mp4" : "webm",
        formatLabel: blob.type.indexOf("mp4") >= 0 ? "MP4" : "WebM",
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        size: blob.size
      };
    } catch (error) {
      if (recorder && recorder.state !== "inactive") {
        try { recorder.stop(); } catch (_) {}
      }
      throw error;
    } finally {
      if (animationId != null && typeof root.cancelAnimationFrame === "function") root.cancelAnimationFrame(animationId);
      tracks.forEach((track) => { try { track.stop(); } catch (_) {} });
      urls.forEach((url) => root.URL.revokeObjectURL(url));
      if (audioContext) {
        try { await audioContext.close(); } catch (_) {}
      }
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  return Object.freeze({
    MAX_MEDIA_FILES, MAX_MEDIA_BYTES, MAX_AUDIO_BYTES, WIDTH, HEIGHT, FPS, MIME_CANDIDATES,
    chooseMimeType, createMediaRecorder, getCapabilities, fileKind, validateFiles, splitCaptions, validateRenderedMetadata, verifyBlob, render
  });
});
