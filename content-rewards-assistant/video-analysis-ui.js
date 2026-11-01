(function () {
  "use strict";
  const root = typeof globalThis !== "undefined" ? globalThis : window;
  const Analysis = root.ClipRewardVideoAnalysis;
  if (!Analysis || !root.document) return;

  function init() {
    const $ = (id) => root.document.getElementById(id);
    const fileInput = $("video-analysis-file");
    const analyzeButton = $("video-analysis-run");
    const generateButton = $("video-analysis-generate");
    const status = $("video-analysis-status");
    const frames = $("video-analysis-frames");
    const scenes = $("video-analysis-scenes");
    const sceneCaptions = $("video-analysis-scene-captions");
    const downloadSrtButton = $("video-analysis-download-srt");
    const metadata = $("video-analysis-metadata");
    const packagePanel = $("video-analysis-package");
    const titleOutput = $("video-analysis-title");
    const captionOutput = $("video-analysis-caption");
    const tagsOutput = $("video-analysis-tags");
    const warnings = $("video-analysis-warnings");
    const mediaInput = $("video-media-files");
    const postCaption = $("video-post-caption");
    if (!fileInput || !analyzeButton || analyzeButton.dataset.bound === "true") return;
    analyzeButton.dataset.bound = "true";

    let analysis = null;
    let postPackage = null;

    function setStatus(message, isError) {
      status.textContent = message;
      status.classList.toggle("video-status-error", !!isError);
    }

    function renderMetadata(result) {
      metadata.replaceChildren();
      const items = [
        ["Duration", result.durationLabel],
        ["Resolution", result.width + " × " + result.height],
        ["Aspect", result.aspect + " · " + result.aspectRatio],
        ["File size", result.sizeMb + " MB"],
        ["Average data rate", result.averageBitrateKbps + " kbps"]
      ];
      items.forEach(([label, value]) => {
        const chip = root.document.createElement("div");
        chip.className = "video-analysis-metric";
        const small = root.document.createElement("small");
        small.textContent = label;
        const strong = root.document.createElement("strong");
        strong.textContent = value;
        chip.append(small, strong);
        metadata.append(chip);
      });
      frames.replaceChildren();
      result.frames.forEach((frame) => {
        const figure = root.document.createElement("figure");
        figure.className = "video-analysis-frame";
        const image = root.document.createElement("img");
        image.src = frame.dataUrl;
        image.alt = frame.label + " preview at " + frame.timeSeconds.toFixed(1) + " seconds";
        const caption = root.document.createElement("figcaption");
        caption.textContent = frame.label + " · " + Analysis.formatDuration(frame.timeSeconds);
        figure.append(image, caption);
        frames.append(figure);
      });
      if (!result.frames.length) {
        const note = root.document.createElement("p");
        note.textContent = "Frame previews are unavailable in this browser. Metadata was still read.";
        frames.append(note);
      }
    }

    function renderSceneMap(sceneMap) {
      scenes.replaceChildren();
      if (!sceneMap || !Array.isArray(sceneMap.scenes) || !sceneMap.scenes.length) {
        scenes.textContent = "Scene mapping was not available for this file.";
        downloadSrtButton.disabled = true;
        return;
      }
      const summary = root.document.createElement("p");
      summary.className = "video-scene-map-summary";
      summary.textContent = sceneMap.scenes.length + " scene segment(s) · " +
        sceneMap.cuts.length + " possible cut(s) · " + sceneMap.sampleCount +
        " sampled frames · about every " + sceneMap.sampleIntervalSeconds + " sec";
      scenes.append(summary);
      const list = root.document.createElement("ol");
      list.className = "video-scene-list";
      sceneMap.scenes.forEach((scene) => {
        const item = root.document.createElement("li");
        const strong = root.document.createElement("strong");
        strong.textContent = "Scene " + scene.number + " · " +
          Analysis.formatDuration(scene.startSeconds) + " – " +
          Analysis.formatDuration(scene.endSeconds);
        const detail = root.document.createElement("small");
        detail.textContent = scene.durationSeconds.toFixed(1) + " sec" +
          (scene.cutScore === null ? " · opening segment" : " · change score " + scene.cutScore);
        item.append(strong, detail);
        list.append(item);
      });
      scenes.append(list);
      downloadSrtButton.disabled = false;
      sceneCaptions.placeholder = sceneMap.scenes.map((scene) => "Scene " + scene.number + " subtitle").join("\n");
    }

    function selectedCampaign() {
      const select = $("draft-campaign");
      const option = select && select.selectedOptions && select.selectedOptions[0];
      return option && select.value ? {
        name: option.textContent.trim(),
        rules: option.dataset ? option.dataset.rules || "" : ""
      } : { name: "", rules: "" };
    }

    analyzeButton.addEventListener("click", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) {
        setStatus("Choose your own video file first.", true);
        return;
      }
      analyzeButton.disabled = true;
      generateButton.disabled = true;
      analysis = null;
      postPackage = null;
      packagePanel.hidden = true;
      downloadSrtButton.disabled = true;
      sceneCaptions.value = "";
      setStatus("Reading video metadata and sampling frame previews on this device…", false);
      try {
        analysis = await Analysis.analyzeVideoFile(file, root, {
          onSceneProgress: (percent) => setStatus("Checking scene changes locally… " + percent + "%", false)
        });
        renderMetadata(analysis);
        renderSceneMap(analysis.sceneMap);
        const frameText = analysis.frames.length + " frame preview(s) created. ";
        const sceneText = analysis.sceneMap
          ? " Detected " + analysis.sceneMap.scenes.length + " scene segment(s) from " + analysis.sceneMap.sampleCount + " samples."
          : " Scene detection was unavailable on this browser.";
        setStatus("Analysis complete: " + analysis.durationLabel + " · " + analysis.width + " × " + analysis.height +
          " · " + analysis.sizeMb + " MB. " + frameText + sceneText + " Your source file stays in this browser.", false);
        generateButton.disabled = false;
      } catch (error) {
        setStatus((error && error.message) || "Could not analyse this video.", true);
      } finally {
        analyzeButton.disabled = false;
      }
    });

    generateButton.addEventListener("click", () => {
      if (!analysis) {
        setStatus("Analyse a video first.", true);
        return;
      }
      try {
        const campaign = selectedCampaign();
        postPackage = Analysis.buildPostPackage({
          platform: $("video-target-platform").value,
          language: $("draft-language").value,
          topic: $("video-analysis-topic").value,
          notes: $("video-analysis-notes").value,
          transcript: $("video-analysis-transcript").value,
          disclosure: $("video-analysis-disclosure").value,
          campaignName: campaign.name,
          campaignRules: campaign.rules,
          video: analysis
        });
        titleOutput.value = postPackage.title;
        captionOutput.value = postPackage.caption;
        tagsOutput.value = postPackage.hashtags.join(" ");
        warnings.replaceChildren();
        postPackage.warnings.forEach((warningText) => {
          const item = root.document.createElement("li");
          item.textContent = warningText;
          warnings.append(item);
        });
        packagePanel.hidden = false;
        postCaption.value = postPackage.caption;
        postCaption.dispatchEvent(new root.Event("input", { bubbles: true }));
        $("video-captions").value = [postPackage.title, $("video-analysis-notes").value.trim()].filter(Boolean).slice(0, 8).join("\n");
        $("draft-topic").value = $("video-analysis-topic").value.trim();
        $("draft-benefit").value = $("video-analysis-notes").value.trim();
        setStatus("Post package prepared for " + postPackage.platform + ". Review the copy and campaign warnings before sending or publishing.", false);
      } catch (error) {
        setStatus((error && error.message) || "Could not prepare the post package.", true);
      }
    });

    function download(name, mime, text) {
      const blob = new root.Blob([text], { type: mime });
      const url = root.URL.createObjectURL(blob);
      const anchor = root.document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      root.document.body.append(anchor);
      anchor.click();
      anchor.remove();
      root.setTimeout(() => root.URL.revokeObjectURL(url), 1500);
    }

    downloadSrtButton.addEventListener("click", () => {
      if (!analysis || !analysis.sceneMap) return setStatus("Analyse the video to build scene timings first.", true);
      try {
        const srt = Analysis.buildSrt(analysis.sceneMap, sceneCaptions.value);
        download("clip-subtitles.srt", "application/x-subrip;charset=utf-8", srt);
        setStatus("SRT subtitles downloaded. Check the timestamps and wording in your video editor.", false);
      } catch (error) {
        setStatus((error && error.message) || "Could not build the subtitle file.", true);
      }
    });

    async function copyText(value, target) {
      if (!value.trim()) {
        setStatus("There is no text to copy yet.", true);
        return;
      }
      try {
        await root.navigator.clipboard.writeText(value);
        setStatus("Copied to clipboard.", false);
      } catch (_) {
        target.focus();
        target.select();
        setStatus("Clipboard access is unavailable. The text is selected; copy it manually.", false);
      }
    }

    $("video-analysis-copy-caption").addEventListener("click", () => copyText(captionOutput.value, captionOutput));
    $("video-analysis-download-text").addEventListener("click", () => {
      if (!postPackage) return setStatus("Generate the post package first.", true);
      const text = [
        "TITLE\n" + postPackage.title,
        "PLATFORM\n" + postPackage.platform,
        "CAPTION\n" + postPackage.caption,
        "WARNINGS\n" + postPackage.warnings.map((item) => "- " + item).join("\n")
      ].join("\n\n");
      download("clip-post-package.txt", "text/plain;charset=utf-8", text);
      setStatus("Post copy downloaded as a text file.", false);
    });
    $("video-analysis-download-json").addEventListener("click", () => {
      if (!postPackage) return setStatus("Generate the post package first.", true);
      download("clip-post-package.json", "application/json", JSON.stringify(postPackage, null, 2));
      setStatus("Post package JSON downloaded.", false);
    });

    $("video-analysis-use-editor").addEventListener("click", () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return setStatus("Choose and analyse a source video first.", true);
      try {
        const existing = Array.from(mediaInput.files || []);
        const combined = existing.some((item) => item.name === file.name && item.size === file.size)
          ? existing : existing.concat(file);
        const validated = root.ClipRewardVideoStudio.validateFiles(combined, $("video-audio-file").files && $("video-audio-file").files[0]);
        if (!root.DataTransfer) throw new Error("This browser cannot pass the selected file into the editor. Select it again in the editor's media field.");
        const transfer = new root.DataTransfer();
        combined.forEach((item) => transfer.items.add(item));
        mediaInput.files = transfer.files;
        mediaInput.dispatchEvent(new root.Event("change", { bubbles: true }));
        setStatus("Source video added to the local video editor (" + validated.count + " media file(s)).", false);
      } catch (error) {
        setStatus((error && error.message) || "Could not add the source video to the editor.", true);
      }
    });

    $("video-analysis-send-social").addEventListener("click", () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file || !analysis || !postPackage) {
        setStatus("Analyse the video and generate its post package first.", true);
        return;
      }
      if (file.size > 50 * 1024 * 1024) {
        setStatus("The Social Media Desk accepts up to 50 MB per file. Make a smaller copy before sending.", true);
        return;
      }
      const targetUrl = new URL("../", root.location.href);
      targetUrl.hash = "socialDeskHeading";
      let child = null;
      let sent = false;
      const cleanup = () => {
        root.removeEventListener("message", onMessage);
        root.clearTimeout(timeout);
      };
      const timeout = root.setTimeout(() => {
        cleanup();
        setStatus("The Social Media Desk did not respond. Allow pop-ups for this site and try again.", true);
      }, 15000);
      function onMessage(event) {
        if (event.origin !== root.location.origin || event.source !== child || !event.data) return;
        if (event.data.type === "AI_COMMERCE_SOCIAL_DESK_READY" && !sent) {
          sent = true;
          child.postMessage({
            type: "AI_COMMERCE_CLIP_HANDOFF",
            payload: {
              file,
              caption: postPackage.caption,
              title: postPackage.title,
              platform: postPackage.platform
            }
          }, root.location.origin);
          setStatus("Sending the video and caption to Social Media Desk…", false);
        } else if (event.data.type === "AI_COMMERCE_CLIP_HANDOFF_ACK") {
          cleanup();
          if (event.data.ok) {
            setStatus(event.data.mediaImported
              ? "Video and caption loaded in Social Media Desk. Review them and use the official publish action; nothing has been posted yet."
              : "Caption loaded, but this browser could not attach the video automatically. Select the video again in Social Media Desk.", !event.data.mediaImported);
          } else setStatus(event.data.error || "Social Media Desk could not import this post package.", true);
        }
      }
      root.addEventListener("message", onMessage);
      child = root.open(targetUrl.href, "_blank");
      if (!child) {
        cleanup();
        setStatus("The browser blocked the Social Media Desk tab. Allow pop-ups and try again.", true);
      }
    });

    fileInput.addEventListener("change", () => {
      analysis = null;
      postPackage = null;
      metadata.replaceChildren();
      frames.replaceChildren();
      scenes.textContent = "Analyse a video to detect possible scene changes.";
      sceneCaptions.value = "";
      downloadSrtButton.disabled = true;
      packagePanel.hidden = true;
      generateButton.disabled = true;
      setStatus("Video selected. Press Analyse to read its metadata and preview frames.", false);
    });
  }

  if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();