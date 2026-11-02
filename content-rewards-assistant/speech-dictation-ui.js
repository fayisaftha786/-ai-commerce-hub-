(function () {
  "use strict";
  const root = typeof globalThis !== "undefined" ? globalThis : window;
  const Dictation = root.ClipRewardSpeechDictation;
  if (!Dictation || !root.document) return;

  function init() {
    const $ = (id) => root.document.getElementById(id);
    const startButton = $("speech-dictation-start");
    const stopButton = $("speech-dictation-stop");
    const targetSelect = $("speech-dictation-target");
    const languageSelect = $("speech-dictation-language");
    const cloudConsent = $("speech-dictation-cloud-consent");
    const status = $("speech-dictation-status");
    if (!startButton || startButton.dataset.bound === "true") return;
    startButton.dataset.bound = "true";

    const controller = Dictation.createController(root);
    const lineTargets = new Set(["video-analysis-scene-captions", "video-captions"]);

    function setStatus(message, isError) {
      status.textContent = message;
      status.classList.toggle("video-status-error", !!isError);
    }

    function friendlyError(code) {
      const messages = {
        "not-allowed": "Microphone or speech permission was denied. Allow microphone access in browser site settings, then try again.",
        "service-not-allowed": "The browser blocked its speech service.",
        "audio-capture": "No working microphone was found. Check the phone's microphone permission.",
        "no-speech": "No speech was detected. Check microphone access and try speaking closer to the phone.",
        "network": "The speech service is unavailable. Check the connection, or use on-device mode when supported.",
        "language-not-supported": "This language is not available in the selected recognition mode. Install its on-device language pack or explicitly allow online recognition.",
        "on-device-unavailable": "This browser does not expose on-device speech recognition. To protect privacy, online recognition is off until you explicitly allow it below.",
        "unsupported": "This browser does not support Web Speech recognition. Use the phone keyboard's microphone or paste a transcript instead.",
        "already-running": "Voice typing is already active.",
        "aborted": "Voice typing was stopped.",
        "InvalidStateError": "The speech recognizer is already active or could not start. Stop it and try again."
      };
      return messages[code] || ("Speech recognition failed (" + code + "). Check the microphone permission and browser support.");
    }

    function updateButtons(state) {
      const active = state !== "idle";
      startButton.disabled = active || !controller.isSupported();
      stopButton.disabled = !active;
    }

    if (!controller.isSupported()) {
      startButton.disabled = true;
      stopButton.disabled = true;
      setStatus("Voice typing is not supported in this browser. Use your phone keyboard microphone or paste a transcript.", false);
    } else {
      updateButtons("idle");
      setStatus("Ready. Choose a text field and language, then start voice typing.", false);
    }

    startButton.addEventListener("click", () => {
      const target = $(targetSelect.value);
      if (!target || typeof target.value !== "string") {
        setStatus("Choose a valid text field before starting voice typing.", true);
        return;
      }
      if (target.id === "video-analysis-transcript") {
        const details = target.closest("details");
        if (details) details.open = true;
      }

      const targetLabel = targetSelect.options[targetSelect.selectedIndex].textContent.trim();
      const requireOnDevice = !cloudConsent.checked;
      const result = controller.start({
        language: languageSelect.value,
        requireOnDevice: requireOnDevice,
        onState: updateButtons,
        onError: (code) => setStatus(friendlyError(code), true),
        onText: (transcript) => {
          const existing = target.value || "";
          const separator = lineTargets.has(target.id)
            ? (existing.trim() ? "\n" : "")
            : (existing && !/\s$/.test(existing) ? " " : "");
          const maxLength = Number(target.maxLength) > 0 ? Number(target.maxLength) : 12000;
          const available = Math.max(0, maxLength - existing.length - separator.length);
          if (available <= 0) {
            setStatus("The selected field reached its character limit. Shorten it before continuing.", true);
            controller.stop();
            return;
          }
          const accepted = transcript.slice(0, available);
          target.value = existing + separator + accepted;
          target.dispatchEvent(new root.Event("input", { bubbles: true }));
          setStatus("Added voice text to " + targetLabel + ". Check the wording; tap Stop when finished.", false);
          if (accepted.length < transcript.length) {
            setStatus("The field reached its character limit. The remaining words were not added.", true);
            controller.stop();
          }
        }
      });

      if (!result.ok) {
        setStatus(friendlyError(result.error), true);
        updateButtons("idle");
        return;
      }
      setStatus((requireOnDevice ? "On-device voice typing started." : "Online speech recognition permitted and started.") +
        " Speak clearly, then tap Stop. Review every word before publishing.", false);
    });

    stopButton.addEventListener("click", () => {
      if (controller.stop()) setStatus("Stopping voice typing. Check the text before using it.", false);
    });

    root.addEventListener("pagehide", () => controller.abort(), { once: true });
  }

  if (root.document.readyState === "loading") {
    root.document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
