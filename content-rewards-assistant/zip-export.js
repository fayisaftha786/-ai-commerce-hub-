(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClipRewardZipExport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const UINT32_MAX = 0xffffffff;
  const UTF8_FLAG = 0x0800;
  const encoder = typeof TextEncoder === "function" ? new TextEncoder() : null;
  let crcTable = null;
  function textBytes(value) {
    if (!encoder) throw new Error("UTF-8 encoding is unavailable in this browser.");
    return encoder.encode(String(value));
  }
  function bytesFor(value) {
    if (typeof Blob !== "undefined" && value instanceof Blob) return value;
    if (typeof value === "string") return new Blob([value], { type: "text/plain;charset=utf-8" });
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return new Blob([value], { type: "application/octet-stream" });
    throw new Error("ZIP entries must contain text, bytes or a Blob.");
  }
  function safePath(value) {
    const path = String(value == null ? "" : value);
    if (!path || path.startsWith("/") || path.startsWith("\\") || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) {
      throw new Error("A ZIP entry has an unsafe file path.");
    }
    const parts = path.split("/");
    if (parts.some((part) => !part || part === "." || part === "..")) throw new Error("A ZIP entry has an unsafe file path.");
    return parts.join("/");
  }
  function getCrcTable() {
    if (crcTable) return crcTable;
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let value = n;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      crcTable[n] = value >>> 0;
    }
    return crcTable;
  }
  function crcUpdate(crc, bytes) {
    const table = getCrcTable();
    let value = crc >>> 0;
    for (let i = 0; i < bytes.length; i += 1) value = table[(value ^ bytes[i]) & 0xff] ^ (value >>> 8);
    return value >>> 0;
  }
  async function crc32(blob) {
    let value = 0xffffffff;
    if (blob && typeof blob.stream === "function") {
      const reader = blob.stream().getReader();
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          value = crcUpdate(value, result.value instanceof Uint8Array ? result.value : new Uint8Array(result.value));
        }
      } finally {
        if (typeof reader.releaseLock === "function") reader.releaseLock();
      }
    } else if (blob && typeof blob.arrayBuffer === "function") {
      value = crcUpdate(value, new Uint8Array(await blob.arrayBuffer()));
    } else throw new Error("This browser cannot read ZIP entry data.");
    return (value ^ 0xffffffff) >>> 0;
  }
  function dosDateTime(date) {
    const safe = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
    const year = Math.min(2107, Math.max(1980, safe.getUTCFullYear()));
    const time = (safe.getUTCHours() << 11) | (safe.getUTCMinutes() << 5) | Math.floor(safe.getUTCSeconds() / 2);
    const day = ((year - 1980) << 9) | ((safe.getUTCMonth() + 1) << 5) | safe.getUTCDate();
    return { time, date: day };
  }
  function writeLocalHeader(nameLength, size, checksum, stamp) {
    const bytes = new Uint8Array(30);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, UTF8_FLAG, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, stamp.time, true);
    view.setUint16(12, stamp.date, true);
    view.setUint32(14, checksum, true);
    view.setUint32(18, size, true);
    view.setUint32(22, size, true);
    view.setUint16(26, nameLength, true);
    view.setUint16(28, 0, true);
    return bytes;
  }
  function writeCentralHeader(nameLength, size, checksum, stamp, offset) {
    const bytes = new Uint8Array(46);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, UTF8_FLAG, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, stamp.time, true);
    view.setUint16(14, stamp.date, true);
    view.setUint32(16, checksum, true);
    view.setUint32(20, size, true);
    view.setUint32(24, size, true);
    view.setUint16(28, nameLength, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, offset, true);
    return bytes;
  }
  function writeEndRecord(count, centralSize, centralOffset) {
    const bytes = new Uint8Array(22);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(4, 0, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, count, true);
    view.setUint16(10, count, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, centralOffset, true);
    view.setUint16(20, 0, true);
    return bytes;
  }
  async function createZip(entries, options) {
    if (!Array.isArray(entries) || entries.length === 0) throw new Error("At least one ZIP file is required.");
    if (entries.length > 65535) throw new Error("The ZIP contains too many files.");
    const opts = options && typeof options === "object" ? options : {};
    const stamp = dosDateTime(opts.date instanceof Date ? opts.date : new Date());
    const names = new Set();
    const dataParts = [];
    const centralParts = [];
    let localOffset = 0;
    let centralSize = 0;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") throw new Error("A ZIP file entry is invalid.");
      const name = safePath(entry.name);
      if (names.has(name)) throw new Error("Duplicate ZIP file path: " + name);
      names.add(name);
      const nameBytes = textBytes(name);
      if (nameBytes.length > 65535) throw new Error("A ZIP file name is too long.");
      const blob = bytesFor(entry.data);
      const size = blob.size;
      if (!Number.isSafeInteger(size) || size < 0 || size > UINT32_MAX) throw new Error("A ZIP file exceeds the 4 GB ZIP32 file-size limit: " + name);
      if (localOffset + 30 + nameBytes.length + size > UINT32_MAX) throw new Error("The complete ZIP exceeds the 4 GB ZIP32 archive limit.");
      const checksum = await crc32(blob);
      dataParts.push(writeLocalHeader(nameBytes.length, size, checksum, stamp), nameBytes, blob);
      centralParts.push(writeCentralHeader(nameBytes.length, size, checksum, stamp, localOffset), nameBytes);
      centralSize += 46 + nameBytes.length;
      localOffset += 30 + nameBytes.length + size;
      if (centralSize > UINT32_MAX || localOffset + centralSize + 22 > UINT32_MAX) throw new Error("The complete ZIP exceeds the 4 GB ZIP32 archive limit.");
    }
    dataParts.push(...centralParts, writeEndRecord(entries.length, centralSize, localOffset));
    return new Blob(dataParts, { type: "application/zip" });
  }
  return { createZip, crc32, safePath };
});
