"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) api.init(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const LIMITS = Object.freeze({ product: 100, benefit: 180, price: 40, audience: 100, cta: 120 });

  function clean(value, max) {
    return String(value || "").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, max);
  }

  function buildVideoScript(input = {}) {
    const language = input.language === "English" ? "English" : "Malayalam";
    const product = clean(input.product, LIMITS.product);
    const benefit = clean(input.benefit, LIMITS.benefit);
    const price = clean(input.price, LIMITS.price);
    const audience = clean(input.audience, LIMITS.audience);
    const cta = clean(input.cta, LIMITS.cta) || (language === "Malayalam" ? "വിലയും വിവരങ്ങളും പരിശോധിക്കാൻ ലിങ്ക് തുറക്കൂ" : "Open the link to check details and current price");
    if (!product || !benefit) {
      return { valid: false, error: language === "Malayalam" ? "ഉൽപ്പന്നത്തിന്റെ പേരും സ്ഥിരീകരിച്ച ഗുണവും നൽകുക." : "Enter the product name and a verified benefit." };
    }

    const scenes = language === "Malayalam" ? [
      { time: "0–3 സെക്കൻഡ്", title: "Hook / ശ്രദ്ധ പിടിക്കുക", visual: "ഉൽപ്പന്നത്തിന്റെ വ്യക്തമായ ക്ലോസ്-അപ്പ് കാണിക്കുക.", voice: product + " ഉപയോഗിച്ച് നോക്കാൻ ആഗ്രഹമുണ്ടോ?" },
      { time: "3–8 സെക്കൻഡ്", title: "ഉൽപ്പന്നം കാണിക്കുക", visual: "ഉൽപ്പന്നത്തിന്റെ രൂപവും ഉപയോഗിക്കുന്ന രീതിയും യഥാർത്ഥമായി കാണിക്കുക.", voice: "ഇതാണ് " + product + ". " + benefit },
      { time: "8–13 സെക്കൻഡ്", title: "പ്രയോജനം വിശദീകരിക്കുക", visual: "ഗുണം കാണിക്കുന്ന ഒരു യഥാർത്ഥ ഉദാഹരണം അല്ലെങ്കിൽ ഡെമോ കാണിക്കുക.", voice: "ഇത് നിങ്ങൾക്ക് അനുയോജ്യമാണോ എന്ന് വിശദാംശങ്ങൾ പരിശോധിക്കൂ." },
      { time: "13–18 സെക്കൻഡ്", title: "Call to action", visual: "ഉൽപ്പന്നവും ലിങ്ക് എവിടെ കണ്ടെത്താമെന്നും സ്ക്രീനിൽ കാണിക്കുക.", voice: cta }
    ] : [
      { time: "0–3 sec", title: "Hook", visual: "Show a clear close-up of the product.", voice: "Looking for something like " + product + "?" },
      { time: "3–8 sec", title: "Show the product", visual: "Show its real appearance and how it is used.", voice: "This is " + product + ". " + benefit },
      { time: "8–13 sec", title: "Explain the benefit", visual: "Demonstrate the stated benefit with a real example.", voice: "Check the details to see whether it suits your needs." },
      { time: "13–18 sec", title: "Call to action", visual: "Show the product and where viewers can find your link.", voice: cta }
    ];
    if (price) {
      scenes[3].voice += language === "Malayalam" ? " പരിശോധിച്ച വില: " + price + "." : " Verified price: " + price + ".";
    }
    if (audience) {
      scenes[0].visual += language === "Malayalam" ? " ലക്ഷ്യ പ്രേക്ഷകർ: " + audience + "." : " Intended audience: " + audience + ".";
    }
    const disclosure = language === "Malayalam"
      ? "അഫിലിയേറ്റ് ലിങ്ക്: ഈ ലിങ്കിലൂടെ വാങ്ങിയാൽ എനിക്ക് കമ്മീഷൻ ലഭിക്കാം."
      : "Affiliate disclosure: I may earn a commission if you buy through this link.";
    return { valid: true, language, product, scenes, disclosure, duration: "About 18 seconds", note: language === "Malayalam"
      ? "ഇത് ടെംപ്ലേറ്റ് അടിസ്ഥാനത്തിലുള്ള സ്ക്രിപ്റ്റാണ്; പ്രസിദ്ധീകരിക്കുന്നതിന് മുമ്പ് ഗുണവും വിലയും പരിശോധിക്കുക."
      : "This is a template-based script; verify the benefit and price before publishing." };
  }

  function formatVideoScript(result) {
    if (!result || !result.valid) return "";
    const lines = [result.product + " — Video Script", "Duration: " + result.duration, ""];
    for (const scene of result.scenes) {
      lines.push(scene.time + " | " + scene.title, "Visual: " + scene.visual, "Voice-over: " + scene.voice, "");
    }
    lines.push(result.disclosure, "", result.note);
    return lines.join("\n");
  }

  function init(root) {
    const doc = root.document;
    const $ = (id) => doc.getElementById(id);
    const form = $("videoScriptForm");
    if (!form) return;
    let latest = null;
    const output = $("videoScriptOutput");
    const status = $("videoScriptStatus");

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      latest = buildVideoScript({
        product: $("videoScriptProduct").value,
        benefit: $("videoScriptBenefit").value,
        price: $("videoScriptPrice").value,
        audience: $("videoScriptAudience").value,
        cta: $("videoScriptCta").value,
        language: $("videoScriptLanguage").value
      });
      output.replaceChildren();
      if (!latest.valid) {
        status.textContent = latest.error;
        return;
      }
      const heading = doc.createElement("h3");
      heading.textContent = latest.product + " — " + latest.duration;
      output.append(heading);
      for (const scene of latest.scenes) {
        const card = doc.createElement("article");
        card.className = "candidate-card";
        const title = doc.createElement("h4");
        title.textContent = scene.time + " · " + scene.title;
        const visual = doc.createElement("p");
        visual.textContent = "Visual: " + scene.visual;
        const voice = doc.createElement("p");
        voice.textContent = "Voice-over: " + scene.voice;
        card.append(title, visual, voice);
        output.append(card);
      }
      const disclosure = doc.createElement("p");
      disclosure.textContent = latest.disclosure;
      const note = doc.createElement("p");
      note.className = "hint";
      note.textContent = latest.note;
      output.append(disclosure, note);
      status.textContent = "Script ready. Review every claim before recording.";
    });

    $("copyVideoScript").addEventListener("click", async () => {
      if (!latest || !latest.valid) {
        status.textContent = "Create a script first.";
        return;
      }
      try {
        await root.navigator.clipboard.writeText(formatVideoScript(latest));
        status.textContent = "Script copied. You can record the voice-over or use it in a video editor.";
      } catch {
        status.textContent = "Clipboard unavailable. Use Download script instead.";
      }
    });

    $("downloadVideoScript").addEventListener("click", () => {
      if (!latest || !latest.valid) {
        status.textContent = "Create a script first.";
        return;
      }
      const blob = new Blob([formatVideoScript(latest) + "\n"], { type: "text/plain;charset=utf-8" });
      const url = root.URL.createObjectURL(blob);
      const link = doc.createElement("a");
      link.href = url;
      link.download = "product-video-script.txt";
      link.click();
      root.setTimeout(() => root.URL.revokeObjectURL(url), 1000);
      status.textContent = "Script download started.";
    });
  }

  return { buildVideoScript, formatVideoScript, init, LIMITS };
});
