"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { assembleSite } = require("./scripts/pages-build.js");

const MIME_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
});

function isWithin(parent, candidate) {
  return candidate === parent || candidate.startsWith(parent + path.sep);
}

function resolvePublicFile(rootDir, requestUrl) {
  let parsed;
  let pathname;
  try {
    parsed = new URL(String(requestUrl || "/"), "http://localhost");
    if (parsed.origin !== "http://localhost") return null;
    pathname = decodeURIComponent(parsed.pathname);
  } catch (_) {
    return null;
  }

  if (pathname.includes("\\") || pathname.includes("\0")) return null;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === ".." || segment.startsWith("."))) {
    return null;
  }

  const relative = segments.length ? segments.join(path.sep) : "index.html";
  let candidate = path.resolve(rootDir, relative);
  if (!isWithin(rootDir, candidate)) return null;

  try {
    let realPath = fs.realpathSync(candidate);
    if (!isWithin(rootDir, realPath)) return null;
    let stats = fs.statSync(realPath);
    if (stats.isDirectory()) {
      candidate = path.join(realPath, "index.html");
      realPath = fs.realpathSync(candidate);
      if (!isWithin(rootDir, realPath)) return null;
      stats = fs.statSync(realPath);
    }
    if (!stats.isFile()) return null;
    return { filePath: realPath, stats };
  } catch (_) {
    return null;
  }
}

function createStaticSite(options = {}) {
  const sourceDir = path.resolve(options.rootDir || __dirname);
  const outputDir = path.resolve(options.outputDir || path.join(
    os.tmpdir(),
    "ai-commerce-hub-site-" + process.pid
  ));

  const result = assembleSite({ rootDir: sourceDir, outputDir });
  const publicRoot = fs.realpathSync(result.outputDir);

  function handle(request, response) {
    if (!request || !["GET", "HEAD"].includes(request.method)) return false;
    const asset = resolvePublicFile(publicRoot, request.url);
    if (!asset) return false;

    const extension = path.extname(asset.filePath).toLowerCase();
    const contentType = MIME_TYPES[extension] || "application/octet-stream";
    response.writeHead(200, {
      "content-type": contentType,
      "content-length": asset.stats.size,
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer"
    });
    if (request.method === "HEAD") {
      response.end();
      return true;
    }

    const stream = fs.createReadStream(asset.filePath);
    stream.on("error", () => {
      if (response.headersSent) response.destroy();
      else {
        response.writeHead(500, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff"
        });
        response.end(JSON.stringify({ error: "static_asset_unavailable" }));
      }
    });
    stream.pipe(response);
    return true;
  }

  function dispose() {
    if (options.keepOutput === true) return;
    fs.rmSync(outputDir, { recursive: true, force: true });
  }

  return Object.freeze({ handle, dispose, rootDir: publicRoot, outputDir });
}

module.exports = { MIME_TYPES, resolvePublicFile, createStaticSite };
