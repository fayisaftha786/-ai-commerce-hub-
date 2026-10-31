"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_STATE = Object.freeze({ campaigns: [], scans: [], updatedAt: "" });
const MAX_STORE_BYTES = 10 * 1024 * 1024;

function normaliseState(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    campaigns: Array.isArray(input.campaigns) ? input.campaigns.slice(0, 500) : [],
    scans: Array.isArray(input.scans) ? input.scans.slice(0, 50) : [],
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt.slice(0, 40) : ""
  };
}

function createFileStore(options = {}) {
  const filePath = path.resolve(options.filePath || process.env.DISCOVERY_STORE_PATH ||
    path.join(process.cwd(), ".data", "content-rewards-discovery.json"));
  let writeQueue = Promise.resolve();

  async function readState() {
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > MAX_STORE_BYTES) throw new Error("Discovery store exceeds the 10 MB safety limit.");
      const raw = await fs.readFile(filePath, "utf8");
      return normaliseState(JSON.parse(raw));
    } catch (error) {
      if (error && error.code === "ENOENT") return { ...DEFAULT_STATE };
      throw error;
    }
  }

  function writeState(value) {
    const state = normaliseState(value);
    const operation = writeQueue.then(async () => {
      const directory = path.dirname(filePath);
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const temporaryPath = filePath + "." + process.pid + "." + Date.now() + ".tmp";
      try {
        await fs.writeFile(temporaryPath, JSON.stringify(state), { encoding: "utf8", mode: 0o600, flag: "wx" });
        await fs.rename(temporaryPath, filePath);
      } catch (error) {
        await fs.rm(temporaryPath, { force: true }).catch(() => {});
        throw error;
      }
    });
    writeQueue = operation.catch(() => {});
    return operation;
  }

  return { filePath, readState, writeState };
}

module.exports = { DEFAULT_STATE, MAX_STORE_BYTES, normaliseState, createFileStore };
