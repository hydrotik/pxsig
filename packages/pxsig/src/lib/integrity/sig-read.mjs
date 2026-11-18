/**
 * integrity/sig-read.mjs — one read of a baseline for everything the ledger and `pxsig doctor`
 * need from it: whether it carries a baseline image (reconcile.mjs), its sha256 (unreviewed.mjs),
 * and whether it records text boxes and masks (text/doctor.mjs, capture/doctor.mjs). Each used to
 * open the file on its own; one read keeps `pxsig doctor` and the dashboard's integrity data at one
 * open per baseline.
 *
 * What a read found is cached by the file's size and mtime, as unreviewed.mjs cached the hash
 * before: a file changed since is read again. Only these few facts are kept, never the header.
 */
import { closeSync, fstatSync, openSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
/** @import { PsigHeader } from '../../types.js' */

/**
 * @typedef {object} SigFacts
 * @property {string} hash the file's sha256
 * @property {boolean} psig whether it reads as a `.psig` (psig.mjs `readHeader` is not null)
 * @property {boolean} image a baseline image section (psig.mjs `hasImage`)
 * @property {boolean} boxes a text record (a `boxes` section)
 * @property {boolean} masks masks recorded in the header
 */

/** "PSIG", the u16 container version and the u32 header length (lib/psig.mjs, docs/spec.md). */
const PREFIX = 10;

/**
 * The header of a `.psig` read whole, as psig.mjs `readHeader` reads it; null when it isn't one.
 * @param {Buffer} buf
 * @returns {PsigHeader | null}
 */
function headerOf(buf) {
  if (buf.length < PREFIX || buf.toString('latin1', 0, 4) !== 'PSIG') return null;
  const len = buf.readUInt32LE(6);
  // Past the end of the file: `readHeader` reads zeros there, which never parse.
  if (PREFIX + len > buf.length) return null;
  try {
    // The header pxsig's engine wrote (docs/spec.md section 5); every key a reader uses is optional.
    return /** @type {PsigHeader} */ (
      JSON.parse(buf.subarray(PREFIX, PREFIX + len).toString('utf8'))
    );
  } catch {
    return null;
  }
}

/** @type {Map<string, SigFacts & { key: string }>} */
const cache = new Map();

/** @param {{ size: number, mtimeMs: number }} st */
const keyOf = (st) => `${st.size}:${st.mtimeMs}`;

/**
 * Read a file once and keep its facts.
 * @param {string} path
 * @param {Buffer} buf
 * @param {string} key
 * @returns {SigFacts}
 */
function keep(path, buf, key) {
  const h = headerOf(buf);
  const sections = h?.sections ?? [];
  const facts = {
    hash: createHash('sha256').update(buf).digest('hex'),
    psig: !!h,
    image: sections.some((s) => s.name === 'image'),
    boxes: sections.some((s) => s.name === 'boxes'),
    masks: !!h?.masks?.masks?.length,
  };
  cache.set(path, { key, ...facts });
  return facts;
}

/**
 * A file's facts, from the cache while its size and mtime are unchanged; null when it does not
 * exist or cannot be read.
 * @param {string} path
 * @returns {SigFacts | null}
 */
export function sigFacts(path) {
  const st = statSync(path, { throwIfNoEntry: false });
  if (!st) return null;
  const key = keyOf(st);
  const hit = cache.get(path);
  if (hit?.key === key) return hit;
  try {
    return keep(path, readFileSync(path), key);
  } catch {
    return null;
  }
}

/**
 * Whether the `.psig` at `path` carries a baseline image (psig.mjs `hasImage`); its other facts
 * are kept for `sigFacts`. false when the file is missing or not a `.psig`. It reads the file
 * without a cache lookup: the ledger's first look at each baseline.
 * @param {string} path
 */
export function sigHasImage(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
  } catch {
    return false;
  }
  try {
    const key = keyOf(fstatSync(fd));
    return keep(path, readFileSync(fd), key).image;
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
}

/**
 * A file's sha256, cached by its size and mtime; null when it does not exist.
 * @param {string} path
 */
export const hashOf = (path) => sigFacts(path)?.hash ?? null;
