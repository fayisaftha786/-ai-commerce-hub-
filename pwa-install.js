(function initPwaInstall(root) {
  "use strict";

  const button = root.document.getElementById("installAppButton");
  const status = root.document.getElementById("installAppStatus");
  if (!button || !status) return;

  let deferredPrompt = null;

  root.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    status.textContent = "This app is ready to install. Tap Install app to add it to your home screen.";
  });

  button.addEventListener("click", async () => {
    if (!deferredPrompt) {
      status.textContent = root.location.protocol === "https:"
        ? "If the install prompt is unavailable, open the browser menu and choose Install app or Add to Home screen."
        : "Install and offline features require this app to be hosted over HTTPS. Open the published HTTPS site in your browser.";
      return;
    }

    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      status.textContent = choice && choice.outcome === "accepted"
        ? "Installation accepted. Look for AI Commerce Hub on your home screen."
        : "Installation was cancelled. You can install later from the browser menu.";
    } catch {
      status.textContent = "Could not open the install prompt. Use the browser menu and choose Install app or Add to Home screen.";
    }
  });

  root.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    button.hidden = true;
    status.textContent = "AI Commerce Hub is installed on this device.";
  });

  if (root.location.protocol === "file:") {
    status.textContent = "For installation and offline caching, publish the app over HTTPS first.";
  }
})(window);
