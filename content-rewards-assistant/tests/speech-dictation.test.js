"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Dictation = require("../speech-dictation.js");

test("reports unsupported browsers without trying to open a microphone", () => {
  const controller = Dictation.createController({});
  assert.equal(controller.isSupported(), false);
  assert.deepEqual(controller.start({}), { ok: false, error: "unsupported" });
});

test("supports the prefixed recognizer and configures Malayalam on-device dictation", () => {
  let instance;
  class MockRecognition {
    constructor() {
      instance = this;
      this.processLocally = false;
      this.started = false;
    }
    start() { this.started = true; }
    stop() {}
  }
  const states = [];
  const controller = Dictation.createController({ webkitSpeechRecognition: MockRecognition });
  const result = controller.start({
    language: "ml-IN",
    requireOnDevice: true,
    onState: (state) => states.push(state)
  });
  assert.equal(result.ok, true);
  assert.equal(result.onDevice, true);
  assert.equal(instance.lang, "ml-IN");
  assert.equal(instance.continuous, true);
  assert.equal(instance.interimResults, false);
  assert.equal(instance.maxAlternatives, 1);
  assert.equal(instance.processLocally, true);
  assert.equal(instance.started, true);
  assert.deepEqual(states, ["listening"]);
  assert.equal(controller.getState(), "listening");
});

test("refuses online-only browsers unless online recognition was explicitly allowed", () => {
  class OnlineOnlyRecognition {
    start() { throw new Error("must not start"); }
  }
  const controller = Dictation.createController({ SpeechRecognition: OnlineOnlyRecognition });
  assert.deepEqual(controller.start({ requireOnDevice: true }), {
    ok: false,
    error: "on-device-unavailable"
  });
  assert.equal(controller.getState(), "idle");
});

test("only forwards final speech results and appends each result once", () => {
  let instance;
  class MockRecognition {
    constructor() { instance = this; }
    start() {}
    stop() {}
  }
  const received = [];
  const controller = Dictation.createController({ SpeechRecognition: MockRecognition });
  assert.equal(controller.start({ language: "en-IN", onText: (text) => received.push(text) }).ok, true);
  instance.onresult({
    resultIndex: 0,
    results: [
      Object.assign([{ transcript: "interim" }], { isFinal: false }),
      Object.assign([{ transcript: " final words " }], { isFinal: true })
    ]
  });
  assert.deepEqual(received, ["final words"]);
});

test("reports service errors and resets the controller state", () => {
  let instance;
  const errors = [];
  const states = [];
  class MockRecognition {
    constructor() { instance = this; }
    start() {}
    stop() {}
  }
  const controller = Dictation.createController({ SpeechRecognition: MockRecognition });
  controller.start({
    onError: (error) => errors.push(error),
    onState: (state) => states.push(state)
  });
  instance.onerror({ error: "not-allowed" });
  assert.deepEqual(errors, ["not-allowed"]);
  assert.equal(controller.getState(), "idle");
  assert.deepEqual(states, ["listening", "idle"]);
});

test("stop keeps the active recognizer until its end event and pagehide can abort it", () => {
  let instance;
  class MockRecognition {
    constructor() { instance = this; this.stopped = false; this.aborted = false; }
    start() {}
    stop() { this.stopped = true; }
    abort() { this.aborted = true; }
  }
  const controller = Dictation.createController({ SpeechRecognition: MockRecognition });
  controller.start({});
  assert.equal(controller.stop(), true);
  assert.equal(instance.stopped, true);
  assert.equal(controller.getState(), "stopping");
  instance.onend();
  assert.equal(controller.getState(), "idle");
  controller.start({});
  assert.equal(controller.abort(), true);
  assert.equal(instance.aborted, true);
  assert.equal(controller.getState(), "idle");
});

test("voice dictation controls are wired and cached for the Content Rewards app", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const worker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  const ui = fs.readFileSync(path.join(root, "speech-dictation-ui.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "..", "package.json"), "utf8"));
  for (const id of [
    "speech-dictation-target", "speech-dictation-language", "speech-dictation-cloud-consent",
    "speech-dictation-start", "speech-dictation-stop", "speech-dictation-status",
    "video-analysis-transcript", "video-analysis-notes", "video-analysis-scene-captions",
    "video-captions", "video-post-caption"
  ]) assert.ok(html.includes('id="' + id + '"'), "missing dictation target/control " + id);
  assert.match(html, /speech-dictation\.js/);
  assert.match(html, /speech-dictation-ui\.js/);
  assert.match(ui, /requireOnDevice/);
  assert.match(ui, /dispatchEvent/);
  assert.match(worker, /clipreward-static-v42/);
  assert.match(worker, /speech-dictation\.js/);
  assert.match(worker, /speech-dictation-ui\.js/);
  assert.match(packageJson.scripts.check, /content-rewards-assistant\/speech-dictation\.js/);
  assert.match(packageJson.scripts.check, /content-rewards-assistant\/speech-dictation-ui\.js/);
  assert.match(packageJson.scripts.check, /content-rewards-assistant\/tests\/speech-dictation\.test\.js/);
});
