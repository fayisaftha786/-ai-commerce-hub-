(function () {
  "use strict";
  const root = typeof globalThis !== "undefined" ? globalThis : window;
  const Studio = root.ClipRewardVideoStudio;
  if (!Studio || !root.document) return;

  function init() {
    const doc = root.document;
    const $ = (id) => doc.getElementById(id);
    const mediaInput = $("video-media-files");
    const audioInput = $("video-audio-file");
    const durationInput = $("video-duration");
    const captionsInput = $("video-captions");
    const createButton = $("video-create-button");
    const deviceTestButton = $("video-device-test-button");
    const cancelButton = $("video-cancel-button");
    const downloadLink = $("video-download-link");
    const preview = $("video-output-preview");
    const status = $("video-export-status");
    const progress = $("video-export-progress");
    if (!mediaInput || !audioInput || !durationInput || !createButton || !status || createButton.dataset.bound === "true") return;
    createButton.dataset.bound = "true";

    let controller = null;
    let busy = false;
    let outputUrl = "";
    let renderedFile = null;
    let renderedDuration = 0;
    let activeShareCleanup = null;
    const campaignSelect = $("draft-campaign");
    const targetPlatform = $("video-target-platform");
    const postCaption = $("video-post-caption");
    const preflightPanel = $("video-campaign-preflight");
    const addTagsButton = $("video-add-campaign-tags");
    const shareButton = $("video-send-social-button");
    const preApprovalLabel = $("video-render-preapproval-label");
    const preApprovalConfirm = $("video-render-preapproval-confirm");

    function campaignAssessment() {
      const option = campaignSelect && campaignSelect.selectedOptions && campaignSelect.selectedOptions[0];
      const now = new Date();
      const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
      return Studio.inspectCampaignRules({
        selectedCampaign: !!(campaignSelect && campaignSelect.value),
        rules: option && option.dataset ? option.dataset.rules || "" : "",
        deadline: option && option.dataset ? option.dataset.deadline || "" : "",
        platform: targetPlatform.value,
        durationSeconds: Number(durationInput.value),
        today,
        postCaption: postCaption.value
      });
    }

    function renderCampaignPreflight() {
      const option = campaignSelect && campaignSelect.selectedOptions && campaignSelect.selectedOptions[0];
      const rules = option && option.dataset ? option.dataset.rules || "" : "";
      const requiresPreApproval = /(pre.?approval|approve.*draft|draft.*approval)/i.test(rules);
      if (preApprovalLabel) preApprovalLabel.hidden = !requiresPreApproval;
      if (!requiresPreApproval && preApprovalConfirm) preApprovalConfirm.checked = false;
      const assessment = campaignAssessment();
      preflightPanel.replaceChildren();
      preflightPanel.classList.toggle("video-preflight-blocked", assessment.status === "blocked");
      preflightPanel.classList.toggle("video-preflight-review", assessment.status === "needs-review" || assessment.status === "no-campaign");
      preflightPanel.classList.toggle("video-preflight-matched", assessment.status === "matched");

      const heading = doc.createElement("strong");
      heading.textContent = assessment.label;
      preflightPanel.appendChild(heading);

      assessment.blockingReasons.concat(assessment.reviewReasons).forEach((reason) => {
        const note = doc.createElement("p");
        note.className = "video-preflight-note";
        note.textContent = reason;
        preflightPanel.appendChild(note);
      });

      assessment.checks.forEach((check) => {
        const row = doc.createElement("div");
        row.className = "video-preflight-check video-preflight-" + check.status;
        const label = doc.createElement("span");
        label.textContent = check.key.replace(/-/g, " ");
        const detail = doc.createElement("small");
        detail.textContent = check.detail;
        row.append(label, detail);
        preflightPanel.appendChild(row);
      });
      return assessment;
    }

    const caps = Studio.getCapabilities(root);
    $("video-capability").textContent = caps.supported
      ? "Ready · " + caps.formatLabel + " recording supported · " + caps.width + " × " + caps.height + " · " + caps.fps + " fps"
      : "Not supported in this browser: " + caps.missing.join(", ");
    $("video-capability").classList.toggle("video-capability-error", !caps.supported);

    function setStatus(message, isError) {
      status.textContent = message;
      status.classList.toggle("video-status-error", !!isError);
    }

    function invalidateOutput() {
      const hadOutput = !!outputUrl || !downloadLink.hidden || !preview.hidden;
      if (outputUrl) root.URL.revokeObjectURL(outputUrl);
      outputUrl = "";
      renderedFile = null;
      renderedDuration = 0;
      shareButton.disabled = true;
      if (activeShareCleanup) activeShareCleanup();
      downloadLink.hidden = true;
      downloadLink.removeAttribute("href");
      downloadLink.removeAttribute("download");
      preview.pause();
      preview.hidden = true;
      preview.removeAttribute("src");
      progress.value = 0;
      return hadOutput;
    }

    function handleRenderInputChange() {
      const hadOutput = invalidateOutput();
      refreshPreflight();
      if (hadOutput) setStatus("Media or scene settings changed. Create a new video before saving.", false);
    }

    function refreshPreflight() {
      let valid = false;
      let summary = "Select photos or video clips to begin.";
      try {
        if (mediaInput.files && mediaInput.files.length) {
          const checked = Studio.validateFiles(mediaInput.files, audioInput.files && audioInput.files[0]);
          valid = true;
          summary = checked.count + " media file(s) · " + (checked.mediaBytes / (1024 * 1024)).toFixed(1) + " MB" +
            (checked.audioBytes ? " · audio " + (checked.audioBytes / (1024 * 1024)).toFixed(1) + " MB" : "");
        }
      } catch (error) { summary = error.message; }
      $("video-file-summary").textContent = summary;
      const campaignCheck = renderCampaignPreflight();
      deviceTestButton.disabled = !caps.supported || busy;
      createButton.disabled = !caps.supported || !valid || campaignCheck.status === "blocked" ||
        !$("video-rights-confirm").checked || !$("video-rules-confirm").checked || busy;
      if (busy) return;
      if (!valid) setStatus(summary, false);
      else if (!$("video-rights-confirm").checked || !$("video-rules-confirm").checked) {
        setStatus("Preflight: confirm media rights and check the live campaign requirements before export.", false);
      } else setStatus("Preflight passed. Ready to render locally on this device.", false);
    }

    function setBusy(value) {
      busy = value;
      createButton.disabled = value || !caps.supported;
      cancelButton.hidden = !value;
      cancelButton.disabled = !value;
      deviceTestButton.disabled = value || !caps.supported;
      mediaInput.disabled = value;
      audioInput.disabled = value;
      durationInput.disabled = value;
      captionsInput.disabled = value;
      $("video-rights-confirm").disabled = value;
      $("video-rules-confirm").disabled = value;
      campaignSelect.disabled = value;
      targetPlatform.disabled = value;
      postCaption.disabled = value;
      addTagsButton.disabled = value;
      if (preApprovalConfirm) preApprovalConfirm.disabled = value;
      shareButton.disabled = value || !renderedFile || renderedFile.size > Studio.MAX_SOCIAL_HANDOFF_BYTES;
      if (!value) refreshPreflight();
    }

    [mediaInput, audioInput, durationInput]
      .forEach((element) => element.addEventListener("change", handleRenderInputChange));
    [ $("video-rights-confirm"), $("video-rules-confirm"), targetPlatform ]
      .forEach((element) => element.addEventListener("change", refreshPreflight));
    campaignSelect.addEventListener("change", () => {
      if (preApprovalConfirm) preApprovalConfirm.checked = false;
      refreshPreflight();
    });
    captionsInput.addEventListener("input", handleRenderInputChange);
    postCaption.addEventListener("input", refreshPreflight);

    addTagsButton.addEventListener("click", () => {
      const assessment = campaignAssessment();
      const additions = assessment.missingHashtags.concat(assessment.missingMentions);
      if (!additions.length) {
        setStatus("No missing campaign hashtags or mentions were detected. Check the official brief for any unrecognised tag.", false);
        return;
      }
      const current = postCaption.value.trim();
      postCaption.value = (current ? current + "\n" : "") + additions.join(" ");
      refreshPreflight();
      setStatus("Detected campaign tags added to the post caption. Review them against the live campaign brief.", false);
    });

    $("video-use-script").addEventListener("click", () => {
      const draftOutput = $("draft-output");
      const source = (draftOutput ? draftOutput.value : "").split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !/^(PLATFORM:|HOOK|BODY|CTA|DISCLOSURE|CHECK BEFORE POSTING|ആരംഭം|വിശദീകരണം|പ്രതികരണം|വെളിപ്പെടുത്തൽ|പോസ്റ്റ് ചെയ്യുന്നതിന് മുമ്പ്)/i.test(line));
      if (!source.length) {
        setStatus("Generate a content draft first, then use it as scene captions.", true);
        return;
      }
      captionsInput.value = source.slice(0, Studio.MAX_MEDIA_FILES).join("\n");
      handleRenderInputChange();
      setStatus("Draft text copied into scene captions. Review and shorten each line for readability.", false);
    });

    function sendRenderedVideoToSocialDesk() {
      if (!renderedFile) {
        setStatus("Create and verify the video export before sending it to Social Media Desk.", true);
        return;
      }
      if (!$("video-rights-confirm").checked || !$("video-rules-confirm").checked) {
        setStatus("Confirm media rights and your review of the live campaign rules before sending the export.", true);
        return;
      }
      const campaignCheck = renderCampaignPreflight();
      if (campaignCheck.status === "blocked") {
        setStatus(campaignCheck.blockingReasons.join(" "), true);
        return;
      }
      const option = campaignSelect && campaignSelect.selectedOptions && campaignSelect.selectedOptions[0];
      const rules = option && option.dataset ? option.dataset.rules || "" : "";
      const plan = Studio.buildSocialHandoff({
        file: renderedFile,
        caption: postCaption.value,
        platform: targetPlatform.value,
        campaignId: campaignSelect.value,
        campaignName: option ? option.textContent.trim() : "",
        campaignPlatform: option && option.dataset ? option.dataset.platform || "" : "",
        campaignStatus: option && option.dataset ? option.dataset.status || "" : "",
        rules,
        preApprovalConfirmed: !!(preApprovalConfirm && preApprovalConfirm.checked),
        durationSeconds: renderedDuration
      });
      if (!plan.valid) {
        setStatus(plan.error, true);
        return;
      }

      if (activeShareCleanup) activeShareCleanup();
      const targetUrl = new URL("../", root.location.href);
      targetUrl.hash = "socialDeskHeading";
      let child = null;
      let sent = false;
      let acknowledged = false;
      let timeout = 0;
      let resultTimeout = 0;
      const cleanup = () => {
        root.removeEventListener("message", onMessage);
        root.removeEventListener("pagehide", cleanup);
        if (timeout) root.clearTimeout(timeout);
        if (resultTimeout) root.clearTimeout(resultTimeout);
        if (activeShareCleanup === cleanup) activeShareCleanup = null;
      };
      activeShareCleanup = cleanup;
      timeout = root.setTimeout(() => {
        cleanup();
        setStatus("Social Media Desk did not respond. Allow pop-ups and try again.", true);
      }, 15000);

      function onMessage(event) {
        if (event.origin !== root.location.origin || event.source !== child || !event.data) return;
        if (event.data.type === "AI_COMMERCE_SOCIAL_DESK_READY" && !sent) {
          sent = true;
          child.postMessage({ type: "AI_COMMERCE_CLIP_HANDOFF", payload: plan.payload }, root.location.origin);
          setStatus("Sending the finished, verified video export and caption to Social Media Desk…", false);
          return;
        }
        if (event.data.type === "AI_COMMERCE_CLIP_HANDOFF_ACK") {
          if (!event.data.ok) {
            cleanup();
            setStatus(event.data.error || "Social Media Desk rejected this rendered-video handoff.", true);
            return;
          }
          acknowledged = true;
          if (timeout) root.clearTimeout(timeout);
          timeout = 0;
          setStatus(event.data.mediaImported
            ? "Finished video and caption loaded in Social Media Desk. Check the target account, visibility and campaign rules before confirming upload."
            : "Caption loaded, but this browser could not attach the video. Save the export and select it manually in Social Media Desk.", !event.data.mediaImported);
          resultTimeout = root.setTimeout(cleanup, 35 * 60 * 1000);
          return;
        }
        if (acknowledged && event.data.type === "AI_COMMERCE_YOUTUBE_PUBLISH_RESULT") {
          const result = event.data.payload && typeof event.data.payload === "object" ? event.data.payload : {};
          const videoId = String(result.videoId || "");
          const publishedAt = new Date(result.publishedAt || "");
          let url = "";
          try {
            const parsed = new URL(String(result.url || ""));
            const validWatch = parsed.protocol === "https:" &&
              (parsed.hostname === "www.youtube.com" || parsed.hostname === "youtube.com") &&
              parsed.pathname === "/watch" && parsed.searchParams.get("v") === videoId;
            const validShort = parsed.protocol === "https:" &&
              parsed.hostname === "youtu.be" && parsed.pathname.replace(/^\//, "") === videoId;
            if (validWatch || validShort) url = parsed.href;
          } catch (_) {}
          if (!url || !videoId || result.privacyStatus !== "public" ||
              result.uploadStatus !== "processed" || result.processingStatus !== "succeeded" ||
              Number.isNaN(publishedAt.getTime())) {
            setStatus("YouTube has not confirmed a processed public video. No Content Rewards timer has started. Check status again after processing.", true);
            return;
          }
          cleanup();
          const handoffResult = {
            ...result,
            url,
            videoId,
            privacyStatus: "public",
            publishedAt: publishedAt.toISOString(),
            campaignId: plan.payload.campaignId
          };
          if (typeof root.CustomEvent === "function") {
            root.dispatchEvent(new root.CustomEvent("clipreward:youtube-published", { detail: handoffResult }));
          }
          setStatus(plan.payload.campaignId
            ? "YouTube confirms the finished export is processed and public. Its real link/time was sent to the selected campaign tracker. Submit clip in Content Rewards before 30 minutes; this app has not submitted it."
            : "YouTube confirms the finished export is processed and public. Add its link to the correct Content Rewards campaign, then submit the link manually.", false);
        }
      }

      root.addEventListener("message", onMessage);
      root.addEventListener("pagehide", cleanup, { once: true });
      child = root.open(targetUrl.href, "_blank");
      if (!child) {
        cleanup();
        setStatus("The browser blocked Social Media Desk. Allow pop-ups for this site and try again.", true);
      }
    }

    shareButton.addEventListener("click", sendRenderedVideoToSocialDesk);

    createButton.addEventListener("click", async () => {
      if (busy) return;
      try { Studio.validateFiles(mediaInput.files, audioInput.files && audioInput.files[0]); }
      catch (error) { setStatus(error.message, true); return; }
      const campaignCheck = renderCampaignPreflight();
      if (campaignCheck.status === "blocked") {
        setStatus(campaignCheck.blockingReasons.join(" "), true);
        return;
      }
      if (!$("video-rights-confirm").checked || !$("video-rules-confirm").checked) {
        setStatus("Confirm you have rights to every asset and have checked the campaign's live rules.", true);
        return;
      }
      if (outputUrl) root.URL.revokeObjectURL(outputUrl);
      outputUrl = "";
      renderedFile = null;
      renderedDuration = 0;
      shareButton.disabled = true;
      downloadLink.hidden = true;
      preview.hidden = true;
      preview.removeAttribute("src");
      progress.value = 0;
      controller = new root.AbortController();
      setBusy(true);
      setStatus("Loading and checking media files…", false);
      try {
        const output = await Studio.render({
          files: mediaInput.files,
          audioFile: audioInput.files && audioInput.files[0],
          durationSeconds: Number(durationInput.value),
          captions: captionsInput.value,
          signal: controller.signal,
          onProgress: (value) => {
            progress.value = value;
            setStatus("Rendering video on this device… " + value + "%", false);
          }
        });
        outputUrl = root.URL.createObjectURL(output.blob);
        renderedDuration = output.duration;
        const outputName = "clipreward-video-" + new Date().toISOString().replace(/[:.]/g, "-") + "." + output.extension;
        const outputType = String(output.mimeType || output.blob.type || "video/webm").split(";")[0].trim().toLowerCase();
        try {
          renderedFile = new root.File(
            [output.blob],
            outputName,
            { type: outputType, lastModified: Date.now() }
          );
        } catch (_) {
          renderedFile = null;
        }
        shareButton.disabled = !renderedFile || renderedFile.size > Studio.MAX_SOCIAL_HANDOFF_BYTES;
        preview.src = outputUrl;
        preview.hidden = false;
        downloadLink.href = outputUrl;
        downloadLink.download = "clipreward-video-" + new Date().toISOString().replace(/[:.]/g, "-") + "." + output.extension;
        downloadLink.textContent = "Save " + output.formatLabel + " video";
        downloadLink.hidden = false;
        const sizeLabel = (output.size / (1024 * 1024)).toFixed(2) + " MB";
        setStatus("Export verified: " + output.width + " × " + output.height + " · " +
          output.duration.toFixed(1) + " sec · " + output.formatLabel + " · " + sizeLabel +
          (renderedFile && renderedFile.size <= Studio.MAX_SOCIAL_HANDOFF_BYTES
            ? ". Preview it, save it or send this finished export to Social Media Desk."
            : renderedFile
              ? ". This export exceeds the 50 MB Social Desk handoff limit; save and compress a copy before upload."
              : ". This browser cannot create a transferable File object; save the export and select it manually in Social Media Desk."), false);
      } catch (error) {
        if (error && error.name === "AbortError") setStatus("Export cancelled. No completed file was saved.", false);
        else setStatus((error && error.message) || "Video export failed. Try smaller files or another supported browser.", true);
      } finally {
        controller = null;
        setBusy(false);
      }
    });

    deviceTestButton.addEventListener("click", async () => {
      if (busy || !caps.supported) return;
      if (outputUrl) root.URL.revokeObjectURL(outputUrl);
      outputUrl = "";
      renderedFile = null;
      shareButton.disabled = true;
      downloadLink.hidden = true;
      preview.hidden = true;
      preview.removeAttribute("src");
      progress.value = 0;
      controller = new root.AbortController();
      setBusy(true);
      setStatus("Running a four-second device export test…", false);
      try {
        const output = await Studio.renderDeviceTest({
          signal: controller.signal,
          onProgress: (value) => {
            progress.value = value;
            setStatus("Device video test… " + value + "%", false);
          }
        });
        outputUrl = root.URL.createObjectURL(output.blob);
        preview.src = outputUrl;
        preview.hidden = false;
        downloadLink.href = outputUrl;
        downloadLink.download = "clipreward-device-test." + output.extension;
        downloadLink.textContent = "Save test " + output.formatLabel;
        downloadLink.hidden = false;
        setStatus("Device test passed: " + output.width + " × " + output.height + " · " +
          output.duration.toFixed(1) + " sec · " + output.formatLabel + ". This confirms this browser can render and read a video file.", false);
      } catch (error) {
        if (error && error.name === "AbortError") setStatus("Device test cancelled.", false);
        else setStatus((error && error.message) || "Device test failed. This browser/device is not ready for video export.", true);
      } finally {
        controller = null;
        setBusy(false);
      }
    });

    cancelButton.addEventListener("click", () => {
      if (controller) controller.abort();
    });

    root.addEventListener("pagehide", () => {
      if (controller) controller.abort();
      if (activeShareCleanup) activeShareCleanup();
      if (outputUrl) root.URL.revokeObjectURL(outputUrl);
    });
    refreshPreflight();
  }

  if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
