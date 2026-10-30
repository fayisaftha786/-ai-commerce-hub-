"use strict";

(() => {
  const MAX_FILES = 8;
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
  const WIDTH = 720;
  const HEIGHT = 1280;
  const MIN_SCENES = 4;
  const MAX_SCENES = 6;
  const byId = (id) => document.getElementById(id);
  const form = byId("videoMakerForm");
  if (!form) return;

  let previousUrl = null;
  let recordedVoiceBlob = null;
  let recordedVoiceUrl = null;
  let micRecorder = null;
  let micStream = null;
  let micChunks = [];

  const cleanText = (value, maxLength) => String(value || "").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, maxLength);
  const status = (message) => { byId("videoMakerStatus").textContent = message; };

  function makeScenes() {
    const title = cleanText(byId("videoMakerName").value, 100);
    const benefit = cleanText(byId("videoMakerBenefit").value, 140);
    const price = cleanText(byId("videoMakerPrice").value, 30);
    const cta = cleanText(byId("videoMakerCta").value, 100) || "Check details and current price";
    const language = byId("videoMakerLanguage").value;
    if (!title || !benefit) {
      status("Enter the product name and a verified benefit before generating the script.");
      return null;
    }
    const ml = language !== "English";
    const en = language !== "Malayalam";
    const lines = [
      ml && en ? "ഇത് ശ്രദ്ധിക്കൂ! | Take a look at this" : ml ? "ഇത് ശ്രദ്ധിക്കൂ!" : "Take a look at this",
      ml && en ? title + " നിങ്ങളുടെ ആവശ്യത്തിന് യോജിക്കുമോ? | Could " + title + " fit your needs?" : ml ? title + " നിങ്ങളുടെ ആവശ്യത്തിന് യോജിക്കുമോ?" : "Could " + title + " fit your needs?",
      ml && en ? "പ്രധാന ഗുണം: " + benefit + " | Key benefit: " + benefit : ml ? "പ്രധാന ഗുണം: " + benefit : "Key benefit: " + benefit,
      ml && en ? "വാങ്ങുന്നതിന് മുമ്പ് വിലയും വിശദാംശങ്ങളും താരതമ്യം ചെയ്യൂ | Compare price and details before buying" : ml ? "വാങ്ങുന്നതിന് മുമ്പ് വിലയും വിശദാംശങ്ങളും താരതമ്യം ചെയ്യൂ" : "Compare price and details before buying",
      ml && en ? "കൂടുതൽ അറിയാൻ പരിശോധിക്കൂ: " + cta + " | Find out more: " + cta : ml ? "കൂടുതൽ അറിയാൻ പരിശോധിക്കൂ: " + cta : "Find out more: " + cta
    ];
    if (price) lines.splice(3, 0, ml && en ? "വില: " + price + " (വാങ്ങുന്നതിന് മുമ്പ് വീണ്ടും പരിശോധിക്കുക) | Price: " + price + " (verify before purchase)" : ml ? "വില: " + price + " (വീണ്ടും പരിശോധിക്കുക)" : "Price: " + price + " (verify before purchase)");
    byId("videoMakerScenes").value = lines.join("\n");
    byId("videoMakerCaption").value = (ml ? title + " — " + benefit + "\n" : "") +
      (en ? title + " — " + benefit + "\n" : "") +
      (ml && en ? "വിലയും ലഭ്യതയും പരിശോധിക്കുക. | Check current price and availability.\\n" : "") +
      "#ProductReview #Shorts #Reels";
    status("Draft script created. Edit every scene and verify product claims before exporting.");
    return lines;
  }

  function wrapText(ctx, text, maxWidth, maxLines) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? line + " " + word : word;
      if (line && ctx.measureText(candidate).width > maxWidth) { lines.push(line); line = word; }
      else line = candidate;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      lines.length = maxLines;
      const last = lines[maxLines - 1];
      lines[maxLines - 1] = last.length > 3 ? last.slice(0, -3) + "…" : last;
    }
    return lines;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("An uploaded image could not be opened.")); };
      image.src = url;
    });
  }

  function loadRemoteImage(value) {
    return new Promise((resolve, reject) => {
      let parsed;
      try { parsed = new URL(value); } catch { reject(new Error("Enter a valid HTTPS image URL.")); return; }
      if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
        reject(new Error("Image URLs must use HTTPS and contain no embedded credentials.")); return;
      }
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.referrerPolicy = "no-referrer";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The image host blocked canvas access. Upload an authorised image file instead."));
      image.src = parsed.href;
    });
  }

  function drawScene(ctx, image, title, copy, cta, index, total, progress) {
    ctx.fillStyle = "#0c1422";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const maxW = WIDTH - 56, maxH = 770;
    const scale = Math.min(maxW / image.width, maxH / image.height) * (1 + Math.max(0, Math.min(1, progress)) * 0.04);
    const w = image.width * scale, h = image.height * scale;
    const x = (WIDTH - w) / 2, y = 64 + (maxH - h) / 2;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(24, 48, WIDTH - 48, 824, 24); ctx.clip();
    ctx.fillStyle = "#fff"; ctx.fillRect(24, 48, WIDTH - 48, 824);
    ctx.drawImage(image, x, y, w, h); ctx.restore();

    ctx.fillStyle = "#f4cb75"; ctx.font = "bold 22px system-ui, sans-serif";
    ctx.fillText("SCENE " + (index + 1) + " / " + total, 36, 920);
    ctx.fillStyle = "#fff"; ctx.font = "bold 38px system-ui, sans-serif";
    wrapText(ctx, title, WIDTH - 72, 2).forEach((line, i) => ctx.fillText(line, 36, 980 + i * 45));
    ctx.fillStyle = "#a9f1d5"; ctx.font = "bold 29px system-ui, sans-serif";
    wrapText(ctx, copy, WIDTH - 72, 3).forEach((line, i) => ctx.fillText(line, 36, 1080 + i * 36));
    ctx.fillStyle = "#101522"; ctx.fillRect(24, 1208, WIDTH - 48, 58);
    ctx.fillStyle = "#85d8bd"; ctx.font = "bold 21px system-ui, sans-serif";
    wrapText(ctx, cta, WIDTH - 84, 1).forEach(line => ctx.fillText(line, 38, 1245));
    ctx.fillStyle = "#f4cb75"; ctx.font = "bold 16px system-ui, sans-serif";
    const disclosure = byId("videoMakerLanguage").value === "Malayalam" ? "അഫിലിയേറ്റ് ലിങ്ക് • വാങ്ങിയാൽ കമ്മീഷൻ ലഭിക്കാം" : "Affiliate link • I may earn a commission";
    ctx.fillText(disclosure, 34, 30, WIDTH - 68);
  }

  async function decodeAudio(context, fileOrBlob) {
    const buffer = await fileOrBlob.arrayBuffer();
    return context.decodeAudioData(buffer.slice(0));
  }

  async function makeAudioTrack(voiceFile, musicFile, durationSeconds) {
    if (!voiceFile && !musicFile) return { stream: null, cleanup() {} };
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("This browser cannot mix audio tracks. Remove voice/music or use a recent Chrome browser.");
    const context = new AudioContextClass();
    await context.resume();
    const destination = context.createMediaStreamDestination();
    const sources = [];
    try {
      if (voiceFile) {
        const buffer = await decodeAudio(context, voiceFile);
        const source = context.createBufferSource();
        source.buffer = buffer;
        const gain = context.createGain(); gain.gain.value = 1;
        source.connect(gain).connect(destination); sources.push(source);
      }
      if (musicFile) {
        const buffer = await decodeAudio(context, musicFile);
        const source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
        const gain = context.createGain(); gain.gain.value = 0.12;
        source.connect(gain).connect(destination); sources.push(source);
      }
      return {
        stream: destination.stream,
        start() { sources.forEach(source => source.start(0)); },
        cleanup() { sources.forEach(source => { try { source.stop(); } catch {} }); context.close().catch(() => {}); }
      };
    } catch (error) {
      context.close().catch(() => {});
      throw error;
    }
  }

  window.AICommerceVideoStudio = Object.freeze({ generateScript: makeScenes, maxScenes: MAX_SCENES, outputMimeType: "video/webm" });

  byId("generateVideoScript").addEventListener("click", makeScenes);
  byId("copyVideoCaption").addEventListener("click", async () => {
    const caption = byId("videoMakerCaption").value.trim();
    if (!caption) { status("Generate a script and caption first."); return; }
    try { await navigator.clipboard.writeText(caption); status("Caption copied. Review hashtags and campaign rules before posting."); }
    catch { byId("videoMakerCaption").focus(); byId("videoMakerCaption").select(); status("Clipboard access is blocked. Caption selected; copy it manually."); }
  });

  byId("recordVoiceStart").addEventListener("click", async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      status("Microphone recording is unavailable. Use an uploaded voice-over audio file instead."); return;
    }
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micChunks = [];
      micRecorder = new MediaRecorder(micStream);
      micRecorder.addEventListener("dataavailable", event => { if (event.data?.size) micChunks.push(event.data); });
      micRecorder.addEventListener("stop", () => {
        recordedVoiceBlob = new Blob(micChunks, { type: micRecorder.mimeType || "audio/webm" });
        if (recordedVoiceUrl) URL.revokeObjectURL(recordedVoiceUrl);
        recordedVoiceUrl = URL.createObjectURL(recordedVoiceBlob);
        byId("voiceOverPreview").src = recordedVoiceUrl;
        byId("voiceOverPreview").hidden = false;
        byId("videoMakerVoiceFile").value = "";
        status("Voice recording saved locally for this video. It will be mixed into the export.");
      }, { once: true });
      micRecorder.start();
      byId("recordVoiceStart").disabled = true;
      byId("recordVoiceStop").disabled = false;
      status("Recording voice-over. Read your script clearly, then press Stop recording.");
    } catch {
      status("Microphone permission was denied or unavailable. You can upload an audio file instead.");
      micStream?.getTracks().forEach(track => track.stop()); micStream = null;
    }
  });

  byId("recordVoiceStop").addEventListener("click", () => {
    if (micRecorder && micRecorder.state !== "inactive") micRecorder.stop();
    micStream?.getTracks().forEach(track => track.stop()); micStream = null;
    byId("recordVoiceStart").disabled = false;
    byId("recordVoiceStop").disabled = true;
  });

  byId("videoMakerVoiceFile").addEventListener("change", () => {
    if (byId("videoMakerVoiceFile").files.length) {
      recordedVoiceBlob = null;
      if (recordedVoiceUrl) URL.revokeObjectURL(recordedVoiceUrl);
      recordedVoiceUrl = null;
      byId("voiceOverPreview").hidden = true;
    }
  });

  byId("videoMakerForm").addEventListener("submit", async event => {
    event.preventDefault();
    const files = Array.from(byId("videoMakerImages").files || []);
    const imageUrl = byId("videoMakerImageUrl").value.trim();
    const voiceFile = recordedVoiceBlob || byId("videoMakerVoiceFile").files[0] || null;
    const musicFile = byId("videoMakerMusicFile").files[0] || null;
    if (!files.length && !imageUrl) { status("Upload at least one authorised image or provide a direct HTTPS image URL."); return; }
    if (files.length + (imageUrl ? 1 : 0) > MAX_FILES) { status("Use no more than 8 images in total."); return; }
    if (files.some(file => !file.type.startsWith("image/") || file.size > MAX_FILE_BYTES)) { status("Images must be valid image files no larger than 10 MB each."); return; }
    if ([voiceFile, musicFile].some(file => file && (!file.type.startsWith("audio/") || file.size > MAX_AUDIO_BYTES))) {
      status("Voice-over and music must be audio files no larger than 25 MB each."); return;
    }
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) { status("Video export is not supported in this browser. Try current Chrome."); return; }
    if (typeof MediaRecorder.isTypeSupported === "function" && !MediaRecorder.isTypeSupported("video/webm")) { status("This browser does not support WebM video export."); return; }

    const title = cleanText(byId("videoMakerName").value, 100);
    const cta = cleanText(byId("videoMakerCta").value, 100) || "Check details and current price";
    const sceneLines = byId("videoMakerScenes").value.split("\n").map(line => cleanText(line, 180)).filter(Boolean);
    if (!title || sceneLines.length < MIN_SCENES || sceneLines.length > MAX_SCENES) {
      status("Generate or edit a script with 4 to 6 non-empty scenes before creating the video."); return;
    }

    const submit = byId("createVideo");
    submit.disabled = true;
    byId("videoMakerDownload").replaceChildren();
    let stream = null, recorder = null, audioTrack = null;
    status("Loading your authorised images…");
    try {
      const images = await Promise.all(files.map(loadImage));
      let warning = "";
      if (imageUrl) {
        try { images.push(await loadRemoteImage(imageUrl)); }
        catch (error) { if (!images.length) throw error; warning = " Remote image blocked; uploaded images were used."; }
      }
      if (!images.length) throw new Error("No usable images were loaded.");
      const canvas = document.createElement("canvas"); canvas.width = WIDTH; canvas.height = HEIGHT;
      const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Canvas is unavailable.");
      const duration = Math.max(4, Math.ceil(20 / sceneLines.length));
      const totalSeconds = duration * sceneLines.length;
      audioTrack = await makeAudioTrack(voiceFile, musicFile, totalSeconds);
      stream = canvas.captureStream(30);
      if (audioTrack.stream) audioTrack.stream.getAudioTracks().forEach(track => stream.addTrack(track));
      const chunks = [];
      recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      const finished = new Promise((resolve, reject) => {
        recorder.addEventListener("dataavailable", event => { if (event.data?.size) chunks.push(event.data); });
        recorder.addEventListener("stop", resolve, { once: true });
        recorder.addEventListener("error", () => reject(new Error("The browser could not encode this video.")), { once: true });
      });
      recorder.start();
      audioTrack.start?.();
      for (let i = 0; i < sceneLines.length; i++) {
        status("Rendering scene " + (i + 1) + " of " + sceneLines.length + "…");
        const started = performance.now();
        await new Promise(resolve => {
          const frame = now => {
            const progress = Math.min(1, (now - started) / (duration * 1000));
            drawScene(ctx, images[i % images.length], title, sceneLines[i], cta, i, sceneLines.length, progress);
            if (progress < 1) requestAnimationFrame(frame); else resolve();
          };
          requestAnimationFrame(frame);
        });
      }
      recorder.stop();
      await finished;
      const blob = new Blob(chunks, { type: "video/webm" });
      if (!blob.size) throw new Error("The video export was empty. Try fewer or smaller media files.");
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      previousUrl = URL.createObjectURL(blob);
      const preview = byId("videoMakerPreview"); preview.src = previousUrl; preview.hidden = false;
      const link = document.createElement("a"); link.href = previousUrl;
      const filename = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).toLowerCase() || "reel";
      link.download = filename + "-reel.webm"; link.textContent = "Download finished video (WebM)";
      byId("videoMakerDownload").append(link);
      status("Video ready. Preview it and verify the claims, sound level, rights and platform rules before publishing." + warning);
    } catch (error) {
      status(error instanceof Error ? error.message : "Video creation failed.");
    } finally {
      if (recorder && recorder.state !== "inactive") { try { recorder.stop(); } catch {} }
      stream?.getTracks().forEach(track => track.stop());
      audioTrack?.cleanup();
      submit.disabled = false;
    }
  });

  window.addEventListener("beforeunload", () => {
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    if (recordedVoiceUrl) URL.revokeObjectURL(recordedVoiceUrl);
    micStream?.getTracks().forEach(track => track.stop());
  });
})();