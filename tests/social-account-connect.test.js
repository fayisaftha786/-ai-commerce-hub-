"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const connector = require("../social-account-connect.js");

function makeNode() {
  return {
    value: "",
    disabled: false,
    textContent: "",
    events: {},
    addEventListener(name, callback) { this.events[name] = callback; }
  };
}

function makeWindow(options = {}) {
  const nodes = new Map();
  const values = new Map();
  const requests = [];
  const windowObject = {
    document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, makeNode()); return nodes.get(id); } },
    localStorage: {
      getItem(key) { return values.get(key) || ""; },
      setItem(key, value) { values.set(key, value); }
    },
    location: {
      href: options.href || "https://app.example.com/",
      origin: new URL(options.href || "https://app.example.com/").origin,
      assigned: "",
      assign(value) { this.assigned = value; }
    },
    history: { replaceState() {} },
    URL,
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith("/api/social/providers")) {
        return { ok: true, async json() { return { youtubeOAuth: { provider: "youtube", configured: options.configured === true, missing: options.missing || ["GOOGLE_CLIENT_ID"] } }; } };
      }
      if (url.endsWith("/api/social/connections")) {
        return { ok: true, async json() { return { connections: [{ provider: "youtube", status: options.connectionStatus || "not_connected", channelTitle: "Creator channel" }] }; } };
      }
      if (url.endsWith("/api/social/youtube/disconnect")) {
        return { ok: true, async json() { return { status: "not_connected" }; } };
      }
      throw new Error("unexpected URL " + url);
    }
  };
  return { windowObject, nodes, values, requests };
}

test("accepts only HTTPS backend origins, except localhost development", () => {
  assert.equal(connector.normalizeBackendOrigin("https://api.example.com/"), "https://api.example.com");
  assert.equal(connector.normalizeBackendOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(connector.normalizeBackendOrigin("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  for (const value of [
    "http://api.example.com",
    "https://user:pass@api.example.com",
    "https://api.example.com/path",
    "https://api.example.com/?token=secret",
    "javascript:alert(1)"
  ]) assert.equal(connector.normalizeBackendOrigin(value), "");
});

test("keeps YouTube connect disabled until the private backend confirms OAuth readiness", async () => {
  const fixture = makeWindow({ configured: false, missing: ["GOOGLE_CLIENT_ID", "SOCIAL_TOKEN_ENCRYPTION_KEY"] });
  fixture.windowObject.localStorage.setItem("ai-commerce-hub.social-backend-origin.v1", "https://api.example.com");
  connector.init(fixture.windowObject);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.nodes.get("connectYouTubeAccount").disabled, true);
  assert.match(fixture.nodes.get("socialAccountConnectionStatus").textContent, /GOOGLE_CLIENT_ID/);
});

test("enables only the configured YouTube OAuth flow and never puts credentials in the frontend URL", async () => {
  const fixture = makeWindow({ configured: true });
  fixture.windowObject.localStorage.setItem("ai-commerce-hub.social-backend-origin.v1", "https://api.example.com");
  connector.init(fixture.windowObject);
  await new Promise((resolve) => setImmediate(resolve));
  const button = fixture.nodes.get("connectYouTubeAccount");
  assert.equal(button.disabled, false);
  button.events.click();
  assert.equal(fixture.windowObject.location.assigned, "https://api.example.com/api/social/youtube/connect");
  assert.equal(fixture.windowObject.location.assigned.includes("client_secret"), false);
});

test("shows the connected channel without displaying or persisting access tokens", async () => {
  const fixture = makeWindow({ configured: true, connectionStatus: "connected" });
  fixture.windowObject.localStorage.setItem("ai-commerce-hub.social-backend-origin.v1", "https://api.example.com");
  connector.init(fixture.windowObject);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(fixture.nodes.get("socialAccountConnectionStatus").textContent, /Creator channel/);
  assert.equal(fixture.nodes.get("disconnectYouTubeAccount").disabled, false);
  assert.ok(fixture.requests.some((item) => item.url.endsWith("/api/social/connections") && item.init.credentials === "include"));
});

test("disconnect sends only the expected action header with credentialed request", async () => {
  const fixture = makeWindow({ configured: true, connectionStatus: "connected" });
  fixture.windowObject.localStorage.setItem("ai-commerce-hub.social-backend-origin.v1", "https://api.example.com");
  connector.init(fixture.windowObject);
  await new Promise((resolve) => setImmediate(resolve));
  await fixture.nodes.get("disconnectYouTubeAccount").events.click();
  const request = fixture.requests.find((item) => item.url.endsWith("/api/social/youtube/disconnect"));
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.credentials, "include");
  assert.equal(request.init.headers["X-AI-Commerce-Action"], "social-disconnect");
});

test("automatically detects a private backend hosted on the same origin as the app", async () => {
  const fixture = makeWindow({ configured: true });
  connector.init(fixture.windowObject);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.nodes.get("socialBackendOrigin").value, "https://app.example.com");
  assert.equal(fixture.nodes.get("connectYouTubeAccount").disabled, false);
  assert.ok(fixture.requests.some((item) => item.url === "https://app.example.com/api/social/providers"));
  fixture.nodes.get("connectYouTubeAccount").events.click();
  assert.equal(fixture.windowObject.location.assigned, "https://app.example.com/api/social/youtube/connect");
});

test("does not assume GitHub Pages is a backend when same-origin API is missing", async () => {
  const fixture = makeWindow({ configured: true });
  const originalFetch = fixture.windowObject.fetch;
  fixture.windowObject.fetch = async (url, init) => {
    if (url.endsWith("/api/social/providers") && url.startsWith("https://pages.example.com")) {
      return { ok: false, status: 404 };
    }
    return originalFetch(url, init);
  };
  fixture.windowObject.location.href = "https://pages.example.com/-ai-commerce-hub-/";
  fixture.windowObject.location.origin = "https://pages.example.com";
  connector.init(fixture.windowObject);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.nodes.get("connectYouTubeAccount").disabled, true);
  assert.match(fixture.nodes.get("socialAccountConnectionStatus").textContent, /enter the HTTPS backend origin|GitHub Pages is static/i);
});
