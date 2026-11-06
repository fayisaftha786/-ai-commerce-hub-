"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Zip = require("../zip-export.js");

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

test("creates a valid UTF-8 ZIP with STORE entries, CRC32 and central directory", async () => {
  const archive = await Zip.createZip([
    { name: "campaign/readme.txt", data: "hello" },
    { name: "captions/മലയാളം.vtt", data: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nനമസ്കാരം" }
  ], { date: new Date("2026-11-06T10:00:00.000Z") });
  assert.equal(archive.type, "application/zip");
  const bytes = new Uint8Array(await archive.arrayBuffer());
  const view = viewOf(bytes);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(6, true) & 0x0800, 0x0800);
  assert.equal(view.getUint16(8, true), 0);
  const firstNameLength = view.getUint16(26, true);
  const firstExtraLength = view.getUint16(28, true);
  const firstDataOffset = 30 + firstNameLength + firstExtraLength;
  const firstSize = view.getUint32(18, true);
  assert.equal(new TextDecoder().decode(bytes.slice(30, 30 + firstNameLength)), "campaign/readme.txt");
  assert.equal(new TextDecoder().decode(bytes.slice(firstDataOffset, firstDataOffset + firstSize)), "hello");
  assert.equal(view.getUint32(14, true), 0x3610a686);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  const centralOffset = view.getUint32(end + 16, true);
  assert.equal(view.getUint32(centralOffset, true), 0x02014b50);
  const firstCentralNameLength = view.getUint16(centralOffset + 28, true);
  const nextCentralOffset = centralOffset + 46 + firstCentralNameLength;
  assert.equal(view.getUint32(nextCentralOffset, true), 0x02014b50);
  const secondCentralNameLength = view.getUint16(nextCentralOffset + 28, true);
  const secondNameOffset = nextCentralOffset + 46;
  assert.equal(new TextDecoder().decode(bytes.slice(secondNameOffset, secondNameOffset + secondCentralNameLength)), "captions/മലയാളം.vtt");
  assert.equal(view.getUint32(end + 12, true), bytes.length - 22 - centralOffset);
});

test("streams Blob bytes and returns the expected CRC32 for the ZIP standard sample", async () => {
  assert.equal(await Zip.crc32(new Blob(["hello"])), 0x3610a686);
  const first = new Blob([new Uint8Array(128 * 1024).fill(65)]);
  const second = new Blob([new Uint8Array(128 * 1024).fill(65)]);
  assert.equal(await Zip.crc32(first), await Zip.crc32(second));
});

test("rejects empty archives, duplicate paths, traversal paths and invalid entries", async () => {
  await assert.rejects(Zip.createZip([]), /At least one ZIP file/);
  await assert.rejects(Zip.createZip([{ name: "same.txt", data: "a" }, { name: "same.txt", data: "b" }]), /Duplicate ZIP file path/);
  await assert.rejects(Zip.createZip([{ name: "../outside.txt", data: "x" }]), /unsafe file path/);
  await assert.rejects(Zip.createZip([{ name: "campaign\\outside.txt", data: "x" }]), /unsafe file path/);
  await assert.rejects(Zip.createZip([{ name: "empty.txt", data: null }]), /must contain text, bytes or a Blob/);
});

test("normalizes only safe relative ZIP entry names", () => {
  assert.equal(Zip.safePath("campaign/evidence.json"), "campaign/evidence.json");
  assert.throws(() => Zip.safePath("/root.txt"), /unsafe file path/);
  assert.throws(() => Zip.safePath("campaign/../root.txt"), /unsafe file path/);
  assert.throws(() => Zip.safePath(""), /unsafe file path/);
});
