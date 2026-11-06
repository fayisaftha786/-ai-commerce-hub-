"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Renderer = require("../auto-video-renderer.js");

function pack(duration = "20–45 seconds") {
  return {
    ok: true,
    campaign: { title: "Verified creator campaign", acceptedPlatforms: ["Instagram", "YouTube"] },
    production: {
      duration,
      scenes: [
        { voiceoverMl: "ഒരു ചെറിയ പരിചയം.", voiceoverEn: "A short introduction." },
        { voiceoverMl: "വിശദാംശങ്ങൾ പരിശോധിക്കുക.", voiceoverEn: "Check the details." },
        { voiceoverMl: "ഞാൻ പരിശോധിച്ചത്: [സ്ഥിരീകരിച്ച വിവരം ഇവിടെ ചേർക്കുക].", voiceoverEn: "I checked: [insert your verified observation]." },
        { voiceoverMl: "എനിക്ക് സ്ഥിരീകരിക്കാനാകുന്നത്: [തെളിവുള്ള യഥാർത്ഥ വിവരം മാത്രം ചേർക്കുക].", voiceoverEn: "I can confirm: [insert only a fact you can substantiate]." },
        { voiceoverMl: "ഔദ്യോഗിക വിവരങ്ങൾ പരിശോധിക്കുക.", voiceoverEn: "Check the official details." }
      ]
    },
    hashtagsFound: ["#CreatorCampaign"],
    mentionsFound: ["@samplebrand"],
    disclosureRules: ["Add paid partnership disclosure."]
  };
}

test("prepares a bilingual text storyboard without inventing evidence", () => {
  const result = Renderer.prepare(pack());
  assert.equal(result.title, "Verified creator campaign");
  assert.equal(result.durationSeconds, 30);
  assert.deepEqual(result.platforms, ["Instagram", "YouTube"]);
  assert.equal(result.scenes.length, 5);
  assert.equal(result.scenes[2].needsEvidence, true);
  assert.match(result.scenes[2].ml, /സ്ഥിരീകരിച്ച വിവരം ചേർക്കുക/);
  assert.match(result.scenes[2].en, /verified observation/);
  assert.deepEqual(result.tags, ["#CreatorCampaign"]);
  assert.deepEqual(result.mentions, ["@samplebrand"]);
});

test("respects stated campaign duration when it fits the renderer", () => {
  assert.equal(Renderer.resolveDuration("20–45 seconds"), 30);
  assert.equal(Renderer.resolveDuration("At least 45 seconds"), 45);
  assert.equal(Renderer.resolveDuration("Up to 20 seconds"), 20);
  assert.equal(Renderer.resolveDuration("Not stated in the readable public brief"), 15);
  assert.throws(() => Renderer.resolveDuration("Up to 10 seconds"), /15 second minimum/);
  assert.throws(() => Renderer.resolveDuration("At least 120 seconds"), /15–90 second/);
});

test("rejects incomplete or malformed campaign packs", () => {
  assert.throws(() => Renderer.prepare(null), /complete fresh campaign/);
  assert.throws(() => Renderer.prepare({ ok: false }), /complete fresh campaign/);
  const invalid = pack();
  invalid.production.scenes.pop();
  assert.throws(() => Renderer.prepare(invalid), /complete fresh campaign/);
});

test("reports browser WebM capability without claiming MP4 support", () => {
  const unsupported = Renderer.getCapabilities({});
  assert.equal(unsupported.supported, false);
  assert.ok(unsupported.missing.includes("MediaRecorder"));
  assert.equal(unsupported.extension, "webm");
});

test("render refuses unsupported browsers before touching media", async () => {
  await assert.rejects(Renderer.render(pack(), {}), /Automatic video export is unavailable/);
});
