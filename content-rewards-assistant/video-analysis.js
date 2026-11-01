(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClipRewardVideoAnalysis = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_SOURCE_BYTES = 150 * 1024 * 1024;
  const MAX_NOTES_CHARS = 2500;
  const MAX_TRANSCRIPT_CHARS = 12000;

  function clean(value, max) {
    return String(value == null ? "" : value).replace(/\r/g, "").trim().slice(0, max || 2000);
  }
  function unique(values) { return [...new Set(values.filter(Boolean))]; }
  function fileExtension(name) {
    const match = /\.([a-z0-9]+)$/i.exec(String(name || ""));
    return match ? match[1].toLowerCase() : "";
  }
  function validateSourceVideo(file) {
    if (!file || typeof file !== "object") throw new Error("Choose your own video file first.");
    const type = String(file.type || "").toLowerCase();
    const extension = fileExtension(file.name);
    const supported = type.startsWith("video/") || ["mp4", "m4v", "webm", "mov", "3gp"].includes(extension);
    if (!supported) throw new Error("Use an MP4, WebM, MOV, M4V or 3GP video.");
    if (!Number.isFinite(file.size) || file.size <= 0) throw new Error("The selected video is empty or unreadable.");
    if (file.size > MAX_SOURCE_BYTES) throw new Error("This video is larger than 150 MB. Use a smaller export or trim a copy.");
    return { name: clean(file.name, 180), type: type || "video/" + extension, size: file.size };
  }
  function formatDuration(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const remainder = value % 60;
    return hours
      ? [hours, String(minutes).padStart(2, "0"), String(remainder).padStart(2, "0")].join(":")
      : [minutes, String(remainder).padStart(2, "0")].join(":");
  }
  function classifyAspect(width, height) {
    if (!(width > 0 && height > 0)) return "unknown";
    const ratio = width / height;
    if (ratio < 0.9) return "vertical";
    if (ratio > 1.1) return "horizontal";
    return "square";
  }
  function waitFor(element, successEvent, environment, label) {
    return new Promise((resolve, reject) => {
      const setTimer = environment.setTimeout || setTimeout;
      const clearTimer = environment.clearTimeout || clearTimeout;
      const timer = setTimer(() => finish(new Error("Timed out while reading " + label + ".")), 20000);
      function cleanup() {
        element.removeEventListener(successEvent, onSuccess);
        element.removeEventListener("error", onError);
        clearTimer(timer);
      }
      function finish(error) {
        cleanup();
        if (error) reject(error);
        else resolve();
      }
      function onSuccess() { finish(); }
      function onError() { finish(new Error("The browser could not read " + label + ".")); }
      element.addEventListener(successEvent, onSuccess, { once: true });
      element.addEventListener("error", onError, { once: true });
    });
  }
  function captureFrame(video, seconds, environment, label) {
    const canvas = environment.document.createElement("canvas");
    canvas.width = 180;
    canvas.height = 320;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Frame previews are not supported by this browser.");
    const width = video.videoWidth;
    const height = video.videoHeight;
    const scale = Math.max(canvas.width / width, canvas.height / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    context.fillStyle = "#080d1a";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(video, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight);
    return { label, timeSeconds: seconds, dataUrl: canvas.toDataURL("image/jpeg", 0.72) };
  }
  async function analyzeVideoFile(file, environment) {
    const env = environment || (typeof globalThis !== "undefined" ? globalThis : this);
    const fileInfo = validateSourceVideo(file);
    if (!env.document || !env.URL || typeof env.URL.createObjectURL !== "function") {
      throw new Error("This browser cannot inspect local video files.");
    }
    const video = env.document.createElement("video");
    const objectUrl = env.URL.createObjectURL(file);
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    try {
      const loaded = waitFor(video, "loadedmetadata", env, "video metadata");
      video.src = objectUrl;
      if (typeof video.load === "function") video.load();
      if (!(video.readyState >= 1 && Number.isFinite(video.duration))) await loaded;
      const width = Number(video.videoWidth);
      const height = Number(video.videoHeight);
      const duration = Number(video.duration);
      if (!(width > 0 && height > 0 && Number.isFinite(duration) && duration > 0)) {
        throw new Error("The video did not provide valid duration and dimensions.");
      }
      const aspect = classifyAspect(width, height);
      const frameTimes = unique([0.05, duration * 0.25, duration * 0.5, duration * 0.75]
        .filter((time) => time < Math.max(0.05, duration - 0.08))
        .map((time) => Math.round(time * 10) / 10));
      const frames = [];
      const frameWarnings = [];
      for (let index = 0; index < frameTimes.length; index += 1) {
        const time = frameTimes[index];
        try {
          if (Math.abs(video.currentTime - time) >= 0.04 || video.readyState < 2) {
            const seeked = waitFor(video, "seeked", env, "a video frame");
            video.currentTime = time;
            await seeked;
          }
          frames.push(captureFrame(video, time, env, "Frame " + (index + 1)));
        } catch (_) {
          frameWarnings.push("One or more frame previews could not be generated on this browser.");
          break;
        }
      }
      return {
        file: fileInfo, durationSeconds: duration, durationLabel: formatDuration(duration),
        width, height, aspectRatio: Number((width / height).toFixed(3)), aspect,
        sizeBytes: fileInfo.size, sizeMb: Number((fileInfo.size / (1024 * 1024)).toFixed(2)),
        averageBitrateKbps: Number((fileInfo.size * 8 / duration / 1000).toFixed(0)),
        frames, warnings: frameWarnings
      };
    } finally {
      try { video.pause(); } catch (_) {}
      video.removeAttribute("src");
      if (typeof video.load === "function") { try { video.load(); } catch (_) {} }
      env.URL.revokeObjectURL(objectUrl);
    }
  }
  function normalizePlatform(value) {
    const raw = String(value || "").toLowerCase();
    if (raw.includes("instagram") || raw === "ig") return "Instagram";
    if (raw.includes("facebook") || raw === "fb") return "Facebook";
    if (raw.includes("youtube") || raw === "yt") return "YouTube";
    if (raw === "x" || raw.includes("twitter")) return "X";
    throw new Error("Choose Instagram, Facebook, YouTube or X as the target platform.");
  }
  function tagsFromRules(rules, label) {
    const match = new RegExp("^\\s*" + label + "\\s*:\\s*(.*)$", "im").exec(String(rules || ""));
    if (!match) return [];
    const pattern = label.toLowerCase() === "mentions" ? /@[a-z0-9._]{2,}/gi : /#[\p{L}\p{N}_]+/gu;
    return unique((match[1].match(pattern) || []).map((item) => item.trim()));
  }
  function topicHashtags(topic) {
    const stopWords = new Set(["the", "and", "for", "with", "from", "this", "that", "your", "you", "how", "why", "എങ്ങനെ", "ഒരു", "ഇത്", "എന്ത്"]);
    return unique((String(topic || "").match(/[\p{L}\p{N}_]{3,}/gu) || [])
      .filter((word) => !stopWords.has(word.toLowerCase()))
      .slice(0, 3).map((word) => "#" + word.replace(/[^\p{L}\p{N}_]/gu, "")));
  }
  function buildPostPackage(options) {
    const source = options && typeof options === "object" ? options : {};
    const platform = normalizePlatform(source.platform);
    const language = ["ml", "both"].includes(source.language) ? source.language : "en";
    const topic = clean(source.topic, 180);
    const notes = clean(source.notes, MAX_NOTES_CHARS);
    const transcript = clean(source.transcript, MAX_TRANSCRIPT_CHARS);
    const disclosure = clean(source.disclosure, 500);
    const campaignName = clean(source.campaignName, 180);
    const campaignRules = clean(source.campaignRules, 12000);
    const detail = notes || transcript;
    if (topic.length < 3) throw new Error("Write what the video is about in at least 3 characters.");
    if (detail.length < 5) throw new Error("Add the video's key points or a transcript. The app will not guess what the footage shows.");
    const cta = language === "ml"
      ? "കൂടുതൽ വിവരങ്ങൾക്ക് കമന്റ് ചെയ്യൂ; ഉപകാരപ്പെട്ടാൽ സേവ് ചെയ്യൂ."
      : language === "both"
        ? "Save this for later and share your experience. · ഉപകാരപ്പെട്ടാൽ സേവ് ചെയ്യൂ; അഭിപ്രായം പങ്കുവെക്കൂ."
        : "Save this for later and share your question or experience in the comments.";
    const disclosureText = disclosure ? "\n\n" + disclosure : "";
    const mentions = tagsFromRules(campaignRules, "Mentions");
    const requiredHashtags = tagsFromRules(campaignRules, "Hashtags");
    const platformTags = platform === "YouTube" ? ["#Shorts"] :
      platform === "Instagram" || platform === "Facebook" ? ["#Reels"] : [];
    const hashtags = unique(requiredHashtags.concat(topicHashtags(topic), platformTags)).slice(0, 12);
    const captionBody = topic + "\n\n" + detail + "\n\n" + cta + disclosureText;
    const caption = [captionBody, hashtags.join(" "), mentions.join(" ")].filter(Boolean).join("\n\n");
    const title = topic.length > 95 ? topic.slice(0, 92).trimEnd() + "..." : topic;
    const warnings = [];
    if (!campaignRules) warnings.push("No saved campaign rules were linked to this package. Check the live brief before posting.");
    if (!disclosure && /(disclos|sponsor|affiliate|paid partnership|#ad\b)/i.test(campaignRules)) {
      warnings.push("The saved brief mentions a disclosure. Add the exact required disclosure before posting.");
    }
    if (/(pre.?approval|approve.*draft|draft.*approval)/i.test(campaignRules)) {
      warnings.push("The brief may require draft pre-approval. Do not publish until the campaign team approves the draft.");
    }
    if (mentions.some((mention) => !caption.includes(mention))) {
      warnings.push("A required campaign mention was not included in the final caption. Add it and recheck the brief.");
    }
    if (!transcript) warnings.push("No spoken-word transcript was supplied. Captions and copy are based only on your written notes.");
    warnings.push("Frame previews show selected moments only. This tool does not identify objects/scenes or transcribe audio automatically.");
    const video = source.video || null;
    const videoInfo = video ? {
      durationSeconds: video.durationSeconds, width: video.width, height: video.height,
      aspectRatio: video.aspectRatio, aspect: video.aspect, sizeBytes: video.sizeBytes
    } : null;
    if (video && video.aspect !== "vertical") warnings.push("The source video is " + video.aspect + ". Preview the crop carefully before publishing a vertical Reel or Short.");
    return {
      version: 1, createdAt: new Date().toISOString(), platform, campaignName,
      sourceFile: video && video.file ? video.file.name : "",
      video: videoInfo, title, caption, hashtags, mentions, disclosure,
      notes, transcriptProvided: Boolean(transcript), warnings
    };
  }

  return Object.freeze({
    MAX_SOURCE_BYTES, MAX_NOTES_CHARS, MAX_TRANSCRIPT_CHARS,
    validateSourceVideo, formatDuration, classifyAspect, analyzeVideoFile,
    normalizePlatform, buildPostPackage
  });
});
