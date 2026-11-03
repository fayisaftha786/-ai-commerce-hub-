(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClipRewardVideoAnalysis = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_SOURCE_BYTES = 150 * 1024 * 1024;
  const MAX_NOTES_CHARS = 2500;
  const MAX_TRANSCRIPT_CHARS = 12000;
  const MAX_SCENE_SAMPLES = 60;

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
  function colorHistogram(imageData) {
    const pixels = imageData && imageData.data;
    if (!pixels || pixels.length < 4 || pixels.length % 4 !== 0) {
      throw new Error("Could not read the sampled video frame pixels.");
    }
    const histogram = new Array(64).fill(0);
    const pixelCount = pixels.length / 4;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index] >> 6;
      const green = pixels[index + 1] >> 6;
      const blue = pixels[index + 2] >> 6;
      histogram[red * 16 + green * 4 + blue] += 1 / pixelCount;
    }
    return histogram;
  }

  function histogramDistance(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== 64 || right.length !== 64) {
      throw new Error("Scene comparison requires two 64-bin colour histograms.");
    }
    let distance = 0;
    for (let index = 0; index < 64; index += 1) {
      distance += Math.abs(Number(left[index]) - Number(right[index]));
    }
    return Math.min(1, distance / 2);
  }

  function buildSceneMap(samples, durationSeconds, options) {
    const duration = Number(durationSeconds);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("A valid video duration is required for scene mapping.");
    const settings = options && typeof options === "object" ? options : {};
    const threshold = Number.isFinite(settings.threshold) ? Math.max(0.1, Math.min(0.9, settings.threshold)) : 0.42;
    const minSceneSeconds = Number.isFinite(settings.minSceneSeconds) ? Math.max(0.5, settings.minSceneSeconds) : 1.25;
    const maxScenes = Number.isFinite(settings.maxScenes) ? Math.max(2, Math.min(30, Math.floor(settings.maxScenes))) : 20;
    const ordered = Array.from(samples || []).filter((sample) =>
      sample && Number.isFinite(sample.timeSeconds) && Array.isArray(sample.histogram)
    ).sort((a, b) => a.timeSeconds - b.timeSeconds);
    if (ordered.length < 2) throw new Error("Not enough video frames were sampled to detect scene changes.");

    const cuts = [];
    let lastCut = 0;
    for (let index = 1; index < ordered.length; index += 1) {
      const time = ordered[index].timeSeconds;
      const score = histogramDistance(ordered[index - 1].histogram, ordered[index].histogram);
      if (score >= threshold && time - lastCut >= minSceneSeconds && cuts.length < maxScenes - 1) {
        cuts.push({ timeSeconds: Number(time.toFixed(2)), score: Number(score.toFixed(3)) });
        lastCut = time;
      }
    }
    const boundaries = [0].concat(cuts.map((cut) => cut.timeSeconds), duration);
    const scenes = [];
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const startSeconds = boundaries[index];
      const endSeconds = boundaries[index + 1];
      if (endSeconds - startSeconds < 0.15) continue;
      scenes.push({
        number: scenes.length + 1,
        startSeconds: Number(startSeconds.toFixed(2)),
        endSeconds: Number(endSeconds.toFixed(2)),
        durationSeconds: Number((endSeconds - startSeconds).toFixed(2)),
        cutScore: index > 0 ? cuts[index - 1].score : null
      });
    }
    return {
      sampleCount: ordered.length,
      sampleIntervalSeconds: Number((duration / Math.max(1, ordered.length - 1)).toFixed(2)),
      threshold,
      cuts,
      scenes
    };
  }

  async function seekVideo(video, timeSeconds, environment) {
    const maximum = Math.max(0, video.duration - 0.08);
    const target = Math.min(maximum, Math.max(0, timeSeconds));
    if (video.readyState >= 2 && Math.abs(video.currentTime - target) < 0.04) return;
    const seeked = waitFor(video, "seeked", environment, "a scene-analysis frame");
    video.currentTime = target;
    await seeked;
  }

  async function sampleSceneChanges(video, duration, environment, onProgress) {
    const documentRef = environment.document;
    const canvas = documentRef.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Scene detection is not supported by this browser's canvas.");
    if (video.readyState < 2) await waitFor(video, "loadeddata", environment, "the first video frame");

    const sampleCount = Math.min(MAX_SCENE_SAMPLES, Math.max(2, Math.ceil(duration / 1.5) + 1));
    const end = Math.max(0, duration - 0.08);
    const samples = [];
    for (let index = 0; index < sampleCount; index += 1) {
      const timeSeconds = sampleCount === 1 ? 0 : end * index / (sampleCount - 1);
      await seekVideo(video, timeSeconds, environment);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      samples.push({ timeSeconds, histogram: colorHistogram(pixels) });
      if (typeof onProgress === "function") onProgress(Math.round((index + 1) / sampleCount * 100));
    }
    return buildSceneMap(samples, duration);
  }

  function srtTimestamp(seconds) {
    const milliseconds = Math.max(0, Math.round(Number(seconds) * 1000));
    const hours = Math.floor(milliseconds / 3600000);
    const minutes = Math.floor((milliseconds % 3600000) / 60000);
    const wholeSeconds = Math.floor((milliseconds % 60000) / 1000);
    const remainder = milliseconds % 1000;
    return [String(hours).padStart(2, "0"), String(minutes).padStart(2, "0"), String(wholeSeconds).padStart(2, "0")].join(":") +
      "," + String(remainder).padStart(3, "0");
  }

  function buildSrt(sceneMap, captions) {
    const scenes = sceneMap && Array.isArray(sceneMap.scenes) ? sceneMap.scenes : [];
    const lines = String(captions || "").replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
    if (!scenes.length) throw new Error("Analyse the video and detect its scene map before creating subtitles.");
    if (lines.length !== scenes.length) {
      throw new Error("Enter exactly " + scenes.length + " non-empty subtitle lines, one for each detected scene.");
    }
    return scenes.map((scene, index) => {
      if (!(Number.isFinite(scene.startSeconds) && Number.isFinite(scene.endSeconds) && scene.endSeconds > scene.startSeconds)) {
        throw new Error("The detected scene map contains an invalid subtitle time range.");
      }
      return [
        String(index + 1),
        srtTimestamp(scene.startSeconds) + " --> " + srtTimestamp(scene.endSeconds),
        lines[index]
      ].join("\n");
    }).join("\n\n") + "\n";
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
  async function analyzeVideoFile(file, environment, options) {
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
      let sceneMap = null;
      try {
        sceneMap = await sampleSceneChanges(video, duration, env, options && options.onSceneProgress);
      } catch (_) {
        frameWarnings.push("Automatic scene-change sampling was unavailable. The metadata and frame previews are still valid.");
      }
      return {
        file: fileInfo, durationSeconds: duration, durationLabel: formatDuration(duration),
        width, height, aspectRatio: Number((width / height).toFixed(3)), aspect,
        sizeBytes: fileInfo.size, sizeMb: Number((fileInfo.size / (1024 * 1024)).toFixed(2)),
        averageBitrateKbps: Number((fileInfo.size * 8 / duration / 1000).toFixed(0)),
        frames, sceneMap, warnings: frameWarnings
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
    const match = new RegExp("^\s*" + label + "\s*:\s*(.*)$", "im").exec(String(rules || ""));
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
  function buildVideoScript(options) {
    const source = options && typeof options === "object" ? options : {};
    const language = ["ml", "both"].includes(source.language) ? source.language : "en";
    const topic = clean(source.topic, 180);
    const notes = clean(source.notes || source.transcript, MAX_NOTES_CHARS);
    const campaignName = clean(source.campaignName, 180);
    const disclosure = clean(source.disclosure, 500);
    const duration = Number(source.durationSeconds) || 30;
    if (topic.length < 3) throw new Error("Add the real video topic before generating a script.");
    if (notes.length < 5) throw new Error("Add real video details or a transcript. The script will not invent product features or footage.");
    const chunks = notes.split(/(?<=[.!?。！？])\s+/).filter(Boolean);
    const detail = chunks.length > 1 ? chunks.slice(0, 3).join(" ") : notes;
    const ml = [
      "ആരംഭം: " + topic + " — ഈ വിഷയം ശ്രദ്ധിക്കൂ.",
      "സന്ദർഭം: " + (campaignName ? campaignName + " ക്യാമ്പെയ്‌നിനായി " : "") + "ഈ വീഡിയോയിൽ കാണിക്കുന്ന കാര്യം ചുരുക്കത്തിൽ പരിചയപ്പെടുത്താം.",
      "പ്രധാന ഭാഗം: " + detail,
      "അവസാനം: കൂടുതൽ വിവരങ്ങൾ അറിയാൻ ഔദ്യോഗിക വിവരങ്ങൾ പരിശോധിക്കുക; നിങ്ങളുടെ അഭിപ്രായം കമന്റിൽ പങ്കുവെക്കൂ."
    ];
    const en = [
      "HOOK: " + topic + " — here is what to know.",
      "CONTEXT: " + (campaignName ? "For the " + campaignName + " campaign, " : "") + "let’s look at what this video actually shows.",
      "KEY POINTS: " + detail,
      "CTA: Check the official details for more information and share your experience in the comments."
    ];
    const scenes = language === "ml" ? ml : language === "both"
      ? ml.map((line, index) => line + "\n" + en[index]) : en;
    const labels = language === "ml" ? ["ഹുക്ക്", "സന്ദർഭം", "പ്രധാന ഭാഗം", "അവസാനം"]
      : ["Hook", "Context", "Key points", "Call to action"];
    const disclosureCue = disclosure
      ? "DISCLOSURE — show and say this clearly at the beginning: " + disclosure
      : "";
    if (disclosureCue) scenes[0] = disclosureCue + "\n\n" + scenes[0];
    const sceneCaptions = scenes.map((line, index) => labels[index] + ": " + line.replace(/^(?:ആരംഭം|സന്ദർഭം|പ്രധാന ഭാഗം|അവസാനം|HOOK|CONTEXT|KEY POINTS|CTA):?\s*/i, ""));
    return {
      language, durationSeconds: Math.max(15, Math.min(60, duration)),
      scenes: scenes.map((text, index) => ({ number: index + 1, label: labels[index], text })),
      sceneCaptions,
      script: scenes.join("\n\n"),
      disclosureCue: disclosure ? { text: disclosure, placement: "opening" } : null,
      note: "Template-generated from your supplied topic and notes; not AI footage understanding or a factual verification. The opening disclosure is a cue only: make it visibly readable or clearly spoken in the actual video. Edit every line and verify campaign rules before publishing."
    };
  }

  function validateContentRewardsDisclosure(campaign, postPackage) {
    const source = campaign && typeof campaign === "object" ? campaign : {};
    if (String(source.platform || "") !== "Content Rewards") return { ok: true };
    const post = postPackage && typeof postPackage === "object" ? postPackage : {};
    const disclosure = clean(post.disclosure, 500);
    if (!disclosure || post.disclosurePlacement !== "opening") {
      return {
        ok: false,
        error: "Content Rewards requires a clear disclosure at the beginning of the clip. Add the exact opening disclosure in Clip Studio and regenerate the post package before publishing."
      };
    }
    return { ok: true };
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
    const disclosureText = disclosure ? disclosure + "\n\n" : "";
    const mentions = tagsFromRules(campaignRules, "Mentions");
    const requiredHashtags = tagsFromRules(campaignRules, "Hashtags");
    const platformTags = platform === "YouTube" ? ["#Shorts"] :
      platform === "Instagram" || platform === "Facebook" ? ["#Reels"] : [];
    const hashtags = unique(requiredHashtags.concat(topicHashtags(topic), platformTags)).slice(0, 12);
    const captionBody = disclosureText + topic + "\n\n" + detail + "\n\n" + cta;
    const caption = [captionBody, hashtags.join(" "), mentions.join(" ")].filter(Boolean).join("\n\n");
    const title = topic.length > 95 ? topic.slice(0, 92).trimEnd() + "..." : topic;
    const warnings = [];
    if (!campaignRules) warnings.push("No saved campaign rules were linked to this package. Check the live brief before posting.");
    warnings.push("Never buy views, use bots, join engagement exchanges or artificially generate engagement. Content Rewards warns that artificial engagement can lead to a permanent ban.");
    if (!disclosure) {
      warnings.push("Add a clear sponsorship / paid-promotion / affiliate disclosure at the very beginning of the clip and at the start of its caption, following the live brief.");
    } else {
      warnings.push("The supplied disclosure is placed first in the caption and added as an opening script cue. Make it visibly readable or clearly spoken in the actual video's opening; this tool does not burn text into the footage.");
    }
    const collabExplicitlyForbidden = /(?:\b(?:do not|don't|must not|not allowed|prohibited|forbidden|avoid)\b[^.\n]{0,80}\b(?:collab|co-post(?:ing)?|coauthor|co-author)\b|\b(?:collab|co-post(?:ing)?|coauthor|co-author)\b[^.\n]{0,80}\b(?:not allowed|prohibited|forbidden)\b)/i.test(campaignRules);
    const collabExplicitlyAllowed = /(?:\b(?:collab|co-post(?:ing)?|coauthor|co-author)\b[^.\n]{0,80}\b(?:allowed|permitted|approved)\b|\b(?:allowed|permitted|approved)\b[^.\n]{0,80}\b(?:collab|co-post(?:ing)?|coauthor|co-author)\b)/i.test(campaignRules);
    if (!collabExplicitlyAllowed || collabExplicitlyForbidden) {
      warnings.push("Do not use Instagram Collab or another co-posting feature unless the live campaign brief explicitly allows it; co-posted views may not track correctly.");
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
    const videoScript = buildVideoScript({
      language, topic, notes, transcript, campaignName, disclosure,
      durationSeconds: video && video.durationSeconds
    });
    const videoInfo = video ? {
      durationSeconds: video.durationSeconds, width: video.width, height: video.height,
      aspectRatio: video.aspectRatio, aspect: video.aspect, sizeBytes: video.sizeBytes
    } : null;
    if (video && video.aspect !== "vertical") warnings.push("The source video is " + video.aspect + ". Preview the crop carefully before publishing a vertical Reel or Short.");
    return {
      version: 1, createdAt: new Date().toISOString(), platform, campaignName,
      sourceFile: video && video.file ? video.file.name : "",
      video: videoInfo, title, caption, hashtags, mentions, disclosure,
      disclosurePlacement: disclosure ? "opening" : "missing",
      notes, transcriptProvided: Boolean(transcript), videoScript, sceneCaptions: videoScript.sceneCaptions, warnings
    };
  }

  return Object.freeze({
    MAX_SOURCE_BYTES, MAX_NOTES_CHARS, MAX_TRANSCRIPT_CHARS, MAX_SCENE_SAMPLES,
    validateSourceVideo, formatDuration, classifyAspect, colorHistogram, histogramDistance,
    buildSceneMap, sampleSceneChanges, srtTimestamp, buildSrt, analyzeVideoFile,
    normalizePlatform, buildVideoScript, validateContentRewardsDisclosure, buildPostPackage
  });
});
