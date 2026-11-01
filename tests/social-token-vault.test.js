"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createEncryptedTokenVault, parseEncryptionKey } = require("../social-token-vault.js");

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "social-token-vault-"));
}

function sessionHash(value) {
  return require("node:crypto").createHash("sha256").update(value).digest("hex");
}

test("accepts only a 32-byte hex or base64 encryption key", () => {
  assert.equal(parseEncryptionKey("ab".repeat(32)).length, 32);
  assert.equal(parseEncryptionKey(Buffer.alloc(32, 7).toString("base64")).length, 32);
  assert.throws(() => parseEncryptionKey("short"), /32-byte key/i);
});

test("encrypts token records at rest and persists them across vault instances", () => {
  const directory = temporaryDirectory();
  const filePath = path.join(directory, "vault.json");
  const key = Buffer.alloc(32, 11).toString("base64");
  const hash = sessionHash("browser-session-id");
  try {
    const first = createEncryptedTokenVault({ filePath, encryptionKey: key });
    first.set(hash, "youtube", {
      accessToken: "very-secret-access-token",
      refreshToken: "very-secret-refresh-token",
      expiresAt: 2000000000000,
      channelId: "channel-id",
      channelTitle: "My channel"
    });
    const raw = fs.readFileSync(filePath, "utf8");
    assert.equal(raw.includes("very-secret-access-token"), false);
    assert.equal(raw.includes("very-secret-refresh-token"), false);
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
    assert.deepEqual(first.get(hash, "youtube"), {
      accessToken: "very-secret-access-token",
      refreshToken: "very-secret-refresh-token",
      expiresAt: 2000000000000,
      channelId: "channel-id",
      channelTitle: "My channel"
    });

    const second = createEncryptedTokenVault({ filePath, encryptionKey: key });
    assert.equal(second.get(hash, "youtube").channelTitle, "My channel");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects ciphertext modified after encryption and rejects a wrong key", () => {
  const directory = temporaryDirectory();
  const filePath = path.join(directory, "vault.json");
  const key = Buffer.alloc(32, 3).toString("base64");
  const hash = sessionHash("browser-session-id");
  try {
    const vault = createEncryptedTokenVault({ filePath, encryptionKey: key });
    vault.set(hash, "youtube", { accessToken: "secret" });
    const envelope = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const bytes = Buffer.from(envelope.ciphertext, "base64");
    bytes[0] ^= 0xff;
    envelope.ciphertext = bytes.toString("base64");
    fs.writeFileSync(filePath, JSON.stringify(envelope));
    assert.throws(() => createEncryptedTokenVault({ filePath, encryptionKey: key }).get(hash, "youtube"), /could not be decrypted/i);
    assert.throws(() => createEncryptedTokenVault({ filePath, encryptionKey: Buffer.alloc(32, 4).toString("base64") }).get(hash, "youtube"), /could not be decrypted/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("validates session digests, providers and record shape", () => {
  const directory = temporaryDirectory();
  try {
    const vault = createEncryptedTokenVault({
      filePath: path.join(directory, "vault.json"),
      encryptionKey: Buffer.alloc(32, 9).toString("base64")
    });
    assert.throws(() => vault.get("bad", "youtube"), /SHA-256/i);
    assert.throws(() => vault.get("a".repeat(64), "unknown"), /Unsupported token provider/i);
    assert.throws(() => vault.set("a".repeat(64), "youtube", null), /record must be an object/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("deletes only the selected provider connection", () => {
  const directory = temporaryDirectory();
  const hash = sessionHash("browser-session-id");
  try {
    const vault = createEncryptedTokenVault({
      filePath: path.join(directory, "vault.json"),
      encryptionKey: Buffer.alloc(32, 5).toString("base64")
    });
    vault.set(hash, "youtube", { accessToken: "youtube-token" });
    vault.set(hash, "instagram", { accessToken: "instagram-token" });
    assert.equal(vault.deleteProvider(hash, "youtube"), true);
    assert.equal(vault.get(hash, "youtube"), null);
    assert.equal(vault.get(hash, "instagram").accessToken, "instagram-token");
    assert.equal(vault.deleteProvider(hash, "youtube"), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
