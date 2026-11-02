"use strict";
const CACHE = "clipreward-static-v35";
const ASSETS = ["./", "./index.html", "./style.css", "./campaign-scout.js", "./campaign-feed.js", "./discovery-engine.js", "./video-studio.js", "./video-studio-ui.js", "./video-analysis.js", "./video-analysis-ui.js", "./speech-dictation.js", "./speech-dictation-ui.js", "./rewards-intelligence.js", "./core.js", "./submission-alerts.js", "./tracker-import.js", "./payout-forecast.js", "./app.js", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith("clipreward-static-") && key !== CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL("./#campaigns", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      const existing = windowClients.find((client) => "focus" in client);
      if (existing) {
        if ("navigate" in existing) {
          return existing.navigate(target).then(() => existing.focus());
        }
        return existing.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;

  // Network-first keeps deployed app updates fresh; cached files remain available offline.
  event.respondWith(
    fetch(request).then((response) => {
      if (!response.ok || response.type !== "basic") return response;
      return caches.open(CACHE)
        .then((cache) => cache.put(request, response.clone()))
        .then(() => response);
    }).catch(() => caches.match(request).then((cached) => {
      if (cached) return cached;
      if (request.mode === "navigate") return caches.match("./index.html");
      return Response.error();
    }))
  );
});
