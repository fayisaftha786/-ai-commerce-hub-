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

  function normalizeTargetPlatform(value) {
    const raw = String(value || "").toLowerCase();
    if (/instagram|^ig\b/.test(raw)) return "Instagram";
    if (/facebook|^fb\b/.test(raw)) return "Facebook";
    if (/youtube|^yt\b/.test(raw)) return "YouTube";
    if (/\bx\b|twitter/.test(raw)) return "X";
    return "";
  }

  function lineValue(source, label) {
    const match = new RegExp("^\\s*" + label + "\\s*:\\s*(.*)$", "im").exec(source);
    return match ? match[1].trim() : "";
  }

  function listFromLine(value, pattern) {
    const matches = String(value || "").match(pattern) || [];
    return [...new Set(matches.map((item) => item.trim()))];
  }

  function extractDurationBounds(rules) {
    const jsonLine = lineValue(rules, "Video duration");
    if (jsonLine.startsWith("{")) {
      try {
        const parsed = JSON.parse(jsonLine);
        const minSeconds = parsed.minSeconds == null ? null : Number(parsed.minSeconds);
        const maxSeconds = parsed.maxSeconds == null ? null : Number(parsed.maxSeconds);
        if ((minSeconds === null || Number.isFinite(minSeconds)) &&
            (maxSeconds === null || Number.isFinite(maxSeconds)) &&
            (minSeconds !== null || maxSeconds !== null)) return { minSeconds, maxSeconds };
      } catch (_) {}
    }
    let minSeconds = null;
    let maxSeconds = null;
    const lines = String(rules || "").split(/\r?\n/).filter((line) => /duration|clip length|video length/i.test(line));
    for (const line of lines) {
      const min = /(?:minimum|min\.?|at least)\s*(\d{1,3})\s*(?:seconds?|secs?|s)\b/i.exec(line);
      const max = /(?:maximum|max\.?|up to|no more than)\s*(\d{1,3})\s*(?:seconds?|secs?|s)\b/i.exec(line);
      if (min) minSeconds = Number(min[1]);
      if (max) maxSeconds = Number(max[1]);
    }
    return minSeconds === null && maxSeconds === null ? null : { minSeconds, maxSeconds };
  }

  function inspectCampaignRules(options) {
    const source = options && typeof options === "object" ? options : {};
    const selected = !!source.selectedCampaign;
    const rules = String(source.rules || "").slice(0, 12000);
    const durationSeconds = Number(source.durationSeconds);
    const platform = normalizeTargetPlatform(source.platform);
    const acceptedLine = lineValue(rules, "Accepted platforms");
    const acceptedPlatforms = acceptedLine
      ? acceptedLine.split(/[,;|]/).map(normalizeTargetPlatform).filter(Boolean)
      : [];
    const bounds = extractDurationBounds(rules);
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(source.deadline || "")) ? String(source.deadline) : "";
    const today = /^\d{4}-\d{2}-\d{2}$/.test(String(source.today || "")) ? String(source.today) : "";
    const hashtags = listFromLine(lineValue(rules, "Hashtags"), /#[\p{L}\p{N}_]+/gu);
    const mentions = listFromLine(lineValue(rules, "Mentions"), /@[a-z0-9._]{2,}/gi);
    const postCaption = String(source.postCaption || "").toLowerCase();
    const missingHashtags = hashtags.filter((tag) => !postCaption.includes(tag.toLowerCase()));
    const missingMentions = mentions.filter((tag) => !postCaption.includes(tag.toLowerCase()));
    const blockingReasons = [];
    const reviewReasons = [];
    const checks = [];

    if (!selected) {
      return {
        status: "no-campaign", label: "No campaign selected",
        checks: [{ key: "campaign", status: "unknown", detail: "Select a saved campaign to compare its stored rules with this video." }],
        blockingReasons: [], reviewReasons: ["Campaign-specific rules have not been checked."],
        acceptedPlatforms, bounds, hashtags, mentions, missingHashtags, missingMentions
      };
    }

    if (!platform) {
      reviewReasons.push("Choose the actual publishing platform.");
      checks.push({ key: "platform", status: "unknown", detail: "Target platform is not recognised." });
    } else if (acceptedPlatforms.length) {
      if (!acceptedPlatforms.includes(platform)) {
        blockingReasons.push(platform + " is not in the campaign's accepted-platform list (" + acceptedPlatforms.join(", ") + ").");
        checks.push({ key: "platform", status: "blocked", detail: blockingReasons[blockingReasons.length - 1] });
      } else checks.push({ key: "platform", status: "matched", detail: platform + " is included in the accepted-platform list copied into the tracker." });
    } else {
      reviewReasons.push("Accepted platforms were not recognised in the saved campaign rules.");
      checks.push({ key: "platform", status: "unknown", detail: "No explicit accepted-platform list was found. Check the official campaign page." });
    }

    if (bounds && Number.isFinite(durationSeconds)) {
      let durationBlocked = false;
      if (bounds.minSeconds !== null && durationSeconds < bounds.minSeconds) {
        blockingReasons.push("Video is shorter than the campaign minimum of " + bounds.minSeconds + " seconds.");
        durationBlocked = true;
      }
      if (bounds.maxSeconds !== null && durationSeconds > bounds.maxSeconds) {
        blockingReasons.push("Video is longer than the campaign maximum of " + bounds.maxSeconds + " seconds.");
        durationBlocked = true;
      }
      checks.push({
        key: "duration", status: durationBlocked ? "blocked" : "matched",
        detail: "Selected duration: " + durationSeconds + " sec" +
          (bounds.minSeconds !== null ? " · minimum " + bounds.minSeconds + " sec" : "") +
          (bounds.maxSeconds !== null ? " · maximum " + bounds.maxSeconds + " sec" : "")
      });
    } else {
      reviewReasons.push("Campaign duration limits were not recognised in the saved rules.");
      checks.push({ key: "duration", status: "unknown", detail: "No duration limit was recognised. Check the official brief." });
    }

    if (deadline && today) {
      if (deadline < today) {
        blockingReasons.push("Saved campaign deadline (" + deadline + ") has passed.");
        checks.push({ key: "deadline", status: "blocked", detail: "Saved deadline has passed. Recheck the live campaign before doing any work." });
      } else checks.push({ key: "deadline", status: "matched", detail: "Saved deadline is " + deadline + "; verify that the campaign is still open." });
    } else {
      reviewReasons.push("Campaign deadline is missing or unknown.");
      checks.push({ key: "deadline", status: "unknown", detail: "No saved deadline was available." });
    }

    if (missingHashtags.length || missingMentions.length) {
      reviewReasons.push("The post caption is missing hashtags or partner mentions detected in the brief.");
      checks.push({
        key: "post-tags", status: "review",
        detail: "Add missing tags to the social post caption: " + missingHashtags.concat(missingMentions).join(" ")
      });
    } else if (hashtags.length || mentions.length) {
      checks.push({ key: "post-tags", status: "matched", detail: "All detected hashtags and mentions appear in the post caption." });
    } else {
      checks.push({ key: "post-tags", status: "unknown", detail: "No hashtags or mentions were extracted. Check the official brief." });
      reviewReasons.push("No campaign hashtags or mentions were recognised.");
    }

    if (/disclos|paid partnership|sponsored|#ad\b|affiliate/i.test(rules)) {
      reviewReasons.push("A disclosure rule appears in the saved campaign notes. Confirm exact disclosure wording and placement in the video/post.");
      checks.push({ key: "disclosure", status: "review", detail: "Disclosure detected; manual review of wording, placement and platform label is required." });
    }
    if (/requirements? locked|locked until join|reference files?[^.\n]*locked/i.test(rules)) {
      reviewReasons.push("Some creator requirements or reference files may still be locked. Review the complete brief after joining.");
      checks.push({ key: "hidden-requirements", status: "review", detail: "Stored notes indicate campaign requirements/reference files may be hidden." });
    }
    reviewReasons.push("Confirm current campaign status and all rules on the official campaign page; this local check cannot verify live eligibility or approval.");

    const status = blockingReasons.length ? "blocked" : reviewReasons.length ? "needs-review" : "matched";
    return {
      status,
      label: status === "blocked" ? "Export blocked by detected campaign rule" :
        status === "needs-review" ? "Manual campaign checks required" : "Detected fields matched",
      checks, blockingReasons, reviewReasons, acceptedPlatforms, bounds, hashtags, mentions,
      missingHashtags, missingMentions
    };
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

  async function assertVideoPlayback(scenes) {
    for (const scene of scenes) {
      if (scene.kind !== "video") continue;
      try {
        await scene.element.play();
        scene.element.pause();
        scene.element.currentTime = 0;
      } catch (_) {
        throw new Error("The browser could not play " + scene.name + ". Try converting it to MP4 or WebM before editing.");
      }
    }
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
      await assertVideoPlayback(scenes);
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

      let playbackError = null;
      function paint(elapsed) {
        const sceneIndex = Math.min(scenes.length - 1, Math.floor(elapsed / sceneDuration));
        const scene = scenes[sceneIndex];
        scenes.forEach((item, index) => {
          if (item.kind !== "video") return;
          if (index === sceneIndex) {
            if (item.element.paused) item.element.play().catch(() => { playbackError = new Error("A source video stopped playing during export."); });
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
          if (playbackError) {
            reject(playbackError);
            return;
          }
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

  async function renderDeviceTest(options) {
    const opts = options || {};
    const duration = 4;
    const capabilities = getCapabilities(root);
    if (!capabilities.supported) throw new Error("This browser cannot export video. Missing: " + capabilities.missing.join(", ") + ".");
    const canvas = root.document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Could not create the device-test drawing surface.");
    const stream = canvas.captureStream(FPS);
    const tracks = stream.getTracks();
    let recorder = null;
    let animationId = null;
    let cancelled = false;
    const signal = opts.signal;
    const onAbort = () => { cancelled = true; };
    const abortError = () => {
      const error = new Error("Device export test was cancelled.");
      error.name = "AbortError";
      return error;
    };
    if (signal) {
      if (signal.aborted) throw abortError();
      signal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      if (!tracks.some((track) => track.kind === "video")) throw new Error("The browser did not create a test video track.");
      const chunks = [];
      recorder = createMediaRecorder(stream, 1200000);
      const stopped = new Promise((resolve, reject) => {
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data && event.data.size) chunks.push(event.data);
        });
        recorder.addEventListener("error", () => reject(new Error("The device test recorder stopped unexpectedly.")), { once: true });
        recorder.addEventListener("stop", resolve, { once: true });
      });
      recorder.start(300);
      const startedAt = root.performance.now();
      await new Promise((resolve, reject) => {
        const tick = () => {
          if (cancelled || (signal && signal.aborted)) {
            reject(abortError());
            return;
          }
          const elapsed = Math.min(duration, (root.performance.now() - startedAt) / 1000);
          context.fillStyle = "#080d1a";
          context.fillRect(0, 0, WIDTH, HEIGHT);
          context.fillStyle = "#8b7cff";
          context.fillRect(48, 48, WIDTH - 96, 14);
          context.fillStyle = "#ffffff";
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.font = "bold 48px Arial, sans-serif";
          context.fillText("VIDEO EXPORT TEST", WIDTH / 2, HEIGHT / 2 - 80);
          context.font = "32px Arial, sans-serif";
          context.fillText("ClipReward Studio", WIDTH / 2, HEIGHT / 2 - 12);
          context.fillText(elapsed.toFixed(1) + " / " + duration + " sec", WIDTH / 2, HEIGHT / 2 + 60);
          context.fillStyle = "#8b7cff";
          context.fillRect(48, HEIGHT - 72, (WIDTH - 96) * Math.min(1, elapsed / duration), 12);
          if (typeof opts.onProgress === "function") opts.onProgress(Math.min(100, Math.round(elapsed / duration * 100)));
          if (elapsed >= duration) resolve();
          else animationId = root.requestAnimationFrame(tick);
        };
        animationId = root.requestAnimationFrame(tick);
      });
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
      if (cancelled || (signal && signal.aborted)) throw abortError();
      const blob = new root.Blob(chunks, { type: recorder.mimeType || capabilities.mimeType });
      const metadata = await verifyBlob(blob, duration);
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
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  return Object.freeze({
    MAX_MEDIA_FILES, MAX_MEDIA_BYTES, MAX_AUDIO_BYTES, WIDTH, HEIGHT, FPS, MIME_CANDIDATES,
    chooseMimeType, createMediaRecorder, getCapabilities, fileKind, validateFiles, splitCaptions, validateRenderedMetadata, verifyBlob, inspectCampaignRules, render, renderDeviceTest
  });
});
