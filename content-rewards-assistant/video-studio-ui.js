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
    const caps = Studio.getCapabilities(root);
    $("video-capability").textContent = caps.supported
      ? "Ready · " + caps.formatLabel + " recording supported · " + caps.width + " × " + caps.height + " · " + caps.fps + " fps"
      : "Not supported in this browser: " + caps.missing.join(", ");
    $("video-capability").classList.toggle("video-capability-error", !caps.supported);

    function setStatus(message, isError) {
      status.textContent = message;
      status.classList.toggle("video-status-error", !!isError);
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
      deviceTestButton.disabled = !caps.supported || busy;
      createButton.disabled = !caps.supported || !valid ||
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
      if (!value) refreshPreflight();
    }

    [mediaInput, audioInput, durationInput, $("video-rights-confirm"), $("video-rules-confirm")]
      .forEach((element) => element.addEventListener("change", refreshPreflight));

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
      setStatus("Draft text copied into scene captions. Review and shorten each line for readability.", false);
    });

    createButton.addEventListener("click", async () => {
      if (busy) return;
      try { Studio.validateFiles(mediaInput.files, audioInput.files && audioInput.files[0]); }
      catch (error) { setStatus(error.message, true); return; }
      if (!$("video-rights-confirm").checked || !$("video-rules-confirm").checked) {
        setStatus("Confirm you have rights to every asset and have checked the campaign's live rules.", true);
        return;
      }
      if (outputUrl) root.URL.revokeObjectURL(outputUrl);
      outputUrl = "";
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
        preview.src = outputUrl;
        preview.hidden = false;
        downloadLink.href = outputUrl;
        downloadLink.download = "clipreward-video-" + new Date().toISOString().replace(/[:.]/g, "-") + "." + output.extension;
        downloadLink.textContent = "Save " + output.formatLabel + " video";
        downloadLink.hidden = false;
        setStatus("Export verified: " + output.width + " × " + output.height + " · " +
          output.duration.toFixed(1) + " sec · " + output.formatLabel + " · " +
          (output.size / (1024 * 1024)).toFixed(2) + " MB. Preview it, then save the file.", false);
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
      if (outputUrl) root.URL.revokeObjectURL(outputUrl);
    });
    refreshPreflight();
  }

  if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
