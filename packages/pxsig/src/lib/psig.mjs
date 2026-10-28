/**
 * psig.mjs — read `.psig` baselines from JS (the Rust CLI writes them; see docs/spec.md).
 *
 * "PSIG" · u16 LE container version · u32 LE header length · UTF-8 JSON header · sections.
 * Only reading lives here: the header, and the baseline image section, for the dashboard,
 * the approval classifier and the integrity ledger.
 */
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
/** @import { PsigHeader } from '../types.js' */

const PREFIX = 10;

/**
 * The header of a `.psig` (reads only the start of the file). null when it isn't one.
 * @param {string} path
 * @returns {PsigHeader | null}
 */
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
    // The header pxsig's engine wrote (docs/spec.md section 5); every key a reader uses is optional.
    return /** @type {PsigHeader} */ (JSON.parse(head.toString('utf8')));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * One section's bytes, or null.
 * @param {string} path
 * @param {string} name
 * @returns {Buffer | null}
 */
export function readSection(path, name) {
  let buf;
  try {
    buf = readFileSync(path);
  } catch {
    return null;
  }
  if (buf.length < PREFIX || buf.toString('latin1', 0, 4) !== 'PSIG') return null;
  const len = buf.readUInt32LE(6);
  // The header pxsig's engine wrote (docs/spec.md section 5).
  const header = /** @type {PsigHeader} */ (
    JSON.parse(buf.subarray(PREFIX, PREFIX + len).toString('utf8'))
  );
  let at = PREFIX + len;
  for (const s of header.sections ?? []) {
    if (s.name === name) return buf.subarray(at, at + s.length);
    at += s.length;
  }
  return null;
}

/**
 * The baseline image (PNG bytes) of a `.psig`, or null.
 * @param {string} path
 */
export const readImage = (path) => readSection(path, 'image');

/**
 * True when a `.psig` carries a baseline image (header only).
 * @param {string} path
 */
export const hasImage = (path) => !!readHeader(path)?.sections?.some((s) => s.name === 'image');
