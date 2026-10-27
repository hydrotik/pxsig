/**
 * psig.mjs — read `.psig` baselines from JS (the Rust CLI writes them; see docs/spec.md).
 *
 * "PSIG" · u16 LE container version · u32 LE header length · UTF-8 JSON header · sections.
 * Only reading lives here: the header, and the baseline image section, for the dashboard,
 * the approval classifier and the integrity ledger.
 */
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';

const PREFIX = 10;

/** The header of a `.psig` (reads only the start of the file). null when it isn't one. */
export function readHeader(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const pre = Buffer.alloc(PREFIX);
    if (readSync(fd, pre, 0, PREFIX, 0) < PREFIX || pre.toString('latin1', 0, 4) !== 'PSIG')
      return null;
    const len = pre.readUInt32LE(6);
    const head = Buffer.alloc(len);
    readSync(fd, head, 0, len, PREFIX);
    return JSON.parse(head.toString('utf8'));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** One section's bytes, or null. */
export function readSection(path, name) {
  let buf;
  try {
    buf = readFileSync(path);
  } catch {
    return null;
  }
  if (buf.length < PREFIX || buf.toString('latin1', 0, 4) !== 'PSIG') return null;
  const len = buf.readUInt32LE(6);
  const header = JSON.parse(buf.subarray(PREFIX, PREFIX + len).toString('utf8'));
  let at = PREFIX + len;
  for (const s of header.sections ?? []) {
    if (s.name === name) return buf.subarray(at, at + s.length);
    at += s.length;
  }
  return null;
}

/** The baseline image (PNG bytes) of a `.psig`, or null. */
export const readImage = (path) => readSection(path, 'image');

/** True when a `.psig` carries a baseline image (header only). */
export const hasImage = (path) => !!readHeader(path)?.sections?.some((s) => s.name === 'image');
