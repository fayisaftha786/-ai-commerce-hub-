"use strict";

const CACHE_NAME = "ai-commerce-hub-pwa-v1";
const ASSET_PATHS = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.webmanifest",
  "./icon.svg",
  "./product-utils.js",
  "./offer-engine.js",
  "./discovery-engine.js",
  "./catalog-import.js",
  "./marketplace-search.js",
  "./campaign-report.js",
  "./video-maker.js",
  "./social-center.js",
  "./app.js",
  "./service-worker.js"
];

function assetUrl(path) {
  return new URL(path, self.registration.scope).href;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSET_PATHS.map(assetUrl));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith("ai-commerce-hub-pwa-") && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  const scopeUrl = self.registration.scope;
  if (requestUrl.origin !== self.location.origin || !requestUrl.href.startsWith(scopeUrl)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      // Network-first keeps deployed fixes fresh; the cache is the offline fallback.
      const response = await fetch(request);
      if (response && response.ok) await cache.put(request, response.clone());
      return response;
    } catch {
      const cached = await cache.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        return await cache.match(assetUrl("./index.html")) || Response.error();
      }
      return Response.error();
    }
  })());
});
