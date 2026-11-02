(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClipRewardSpeechDictation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function getConstructor(environment) {
    const env = environment || {};
    return env.SpeechRecognition || env.webkitSpeechRecognition || null;
  }

  function createController(environment) {
    const env = environment || {};
    let recognition = null;
    let state = "idle";

    function notify(callbacks, nextState) {
      state = nextState;
      if (callbacks && typeof callbacks.onState === "function") callbacks.onState(nextState);
    }

    function start(options) {
      const config = options && typeof options === "object" ? options : {};
      const callbacks = config.callbacks || config;
      if (recognition) return { ok: false, error: "already-running" };
      const Recognition = getConstructor(env);
      if (typeof Recognition !== "function") return { ok: false, error: "unsupported" };

      let instance;
      try {
        instance = new Recognition();
        instance.lang = String(config.language || "ml-IN");
        instance.continuous = true;
        instance.interimResults = false;
        instance.maxAlternatives = 1;

        if (config.requireOnDevice) {
          if (!("processLocally" in instance)) return { ok: false, error: "on-device-unavailable" };
          instance.processLocally = true;
        } else if ("processLocally" in instance) {
          instance.processLocally = false;
        }

        instance.onresult = function (event) {
          const results = event && event.results;
          if (!results || typeof results.length !== "number") return;
          const first = Number.isInteger(event.resultIndex) ? event.resultIndex : 0;
          for (let index = first; index < results.length; index += 1) {
            const result = results[index];
            const alternative = result && result[0];
            const transcript = alternative && typeof alternative.transcript === "string"
              ? alternative.transcript.trim() : "";
            if (result && result.isFinal && transcript &&
                typeof callbacks.onText === "function") {
              callbacks.onText(transcript);
            }
          }
        };

        instance.onerror = function (event) {
          if (recognition === instance) recognition = null;
          notify(callbacks, "idle");
          if (typeof callbacks.onError === "function") {
            callbacks.onError(String(event && event.error || "unknown"));
          }
        };

        instance.onend = function () {
          if (recognition === instance) recognition = null;
          notify(callbacks, "idle");
        };

        instance.start();
        recognition = instance;
        notify(callbacks, "listening");
        return { ok: true, onDevice: !!config.requireOnDevice };
      } catch (error) {
        if (recognition === instance) recognition = null;
        notify(callbacks, "idle");
        const reason = error && (error.name || error.message) || "start-failed";
        if (typeof callbacks.onError === "function") callbacks.onError(String(reason));
        return { ok: false, error: String(reason) };
      }
    }

    function stop() {
      if (!recognition) return false;
      const instance = recognition;
      notify(null, "stopping");
      try {
        instance.stop();
        return true;
      } catch (_) {
        return false;
      }
    }

    function abort() {
      if (!recognition) return false;
      const instance = recognition;
      try {
        if (typeof instance.abort === "function") instance.abort();
        else instance.stop();
      } catch (_) {}
      recognition = null;
      state = "idle";
      return true;
    }

    return {
      start: start,
      stop: stop,
      abort: abort,
      getState: function () { return state; },
      isSupported: function () { return typeof getConstructor(env) === "function"; }
    };
  }

  return { getConstructor: getConstructor, createController: createController };
});
