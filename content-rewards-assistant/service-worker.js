"use strict";
const CACHE = "clipreward-static-v3";
const ASSETS = ["./", "./index.html", "./style.css", "./campaign-scout.js", "./core.js", "./app.js", "./manifest.webmanifest", "./icon.svg"];

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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

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
