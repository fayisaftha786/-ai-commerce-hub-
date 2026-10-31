"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createFileStore, MAX_STORE_BYTES } = require("../discovery-store.js");

test("file store starts empty and atomically persists bounded discovery snapshots", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clipreward-store-"));
  try {
    const store = createFileStore({ filePath: path.join(directory, "data.json") });
    assert.deepEqual(await store.readState(), { campaigns: [], scans: [], updatedAt: "" });
    await store.writeState({
      campaigns: Array.from({ length: 505 }, (_, id) => ({ id })),
      scans: Array.from({ length: 55 }, (_, id) => ({ id })),
      updatedAt: "2026-10-31T00:00:00.000Z"
    });
    const result = await store.readState();
    assert.equal(result.campaigns.length, 500);
    assert.equal(result.scans.length, 50);
    assert.equal(result.updatedAt, "2026-10-31T00:00:00.000Z");
    assert.equal((await fs.readdir(directory)).some((name) => name.endsWith(".tmp")), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("file store serializes concurrent writes and leaves the latest valid state", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clipreward-store-"));
  try {
    const store = createFileStore({ filePath: path.join(directory, "data.json") });
    await Promise.all([
      store.writeState({ campaigns: [{ id: "first" }] }),
      store.writeState({ campaigns: [{ id: "second" }] }),
      store.writeState({ campaigns: [{ id: "third" }] })
    ]);
    assert.deepEqual((await store.readState()).campaigns, [{ id: "third" }]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("file store rejects corrupt or oversized data instead of silently resetting it", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clipreward-store-"));
  const file = path.join(directory, "data.json");
  try {
    await fs.writeFile(file, "{broken", "utf8");
    const store = createFileStore({ filePath: file });
    await assert.rejects(store.readState(), SyntaxError);
    await fs.writeFile(file, " ".repeat(MAX_STORE_BYTES + 1), "utf8");
    await assert.rejects(store.readState(), /10 MB safety limit/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
