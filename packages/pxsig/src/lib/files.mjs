/**
 * files.mjs — how pxsig writes its records, so a crash, a full disk or a killed process never
 * leaves half of one.
 *
 * - `writeAtomic` (and `writeJson`): a whole file, written to a temporary file beside it, flushed,
 *   then renamed over the old one. A reader sees the old file or the new one, never a mix; when
 *   the write fails (no space left), the old file is untouched.
 * - `appendLine`: one line added to a log in a single write. A torn tail left by an earlier crash
 *   is closed off first, so it can never swallow the new line.
 * - `readLines`: a log's complete lines; a line that does not parse, or a last line without its
 *   newline (a write cut short), is returned apart as `torn` (integrity code `log-torn`).
 * - `readJsonFile` (throws) and `readJson` (a fallback instead): one JSON file. A UTF-8 byte order
 *   mark (Windows Notepad writes one) is skipped; a UTF-16 file is refused with a message that
 *   names the encoding.
 *
 * `fault(point)` exits at a named point when `PXSIG_FAULT` names it, and only under NODE_ENV=test:
 * the crash tests use it; it does nothing in a normal run.
 */
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
/** @import { TornLine } from '../types.js' */

/**
 * Test-only: stop here as a crash would (exit 97), when PXSIG_FAULT names this point.
 * @param {string} point
 */
export function fault(point) {
  if (process.env.NODE_ENV === 'test' && process.env.PXSIG_FAULT === point) process.exit(97);
}

/** @param {number} ms */
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Write `data` to `path` whole: temp file, fsync, rename (retried while Windows holds the file).
 * @param {string} path
 * @param {string | NodeJS.ArrayBufferView} data
 * @returns {string} `path`
 */
export function writeAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    const fd = openSync(tmp, 'w');
    try {
      // node:fs types writeSync as two overloads, text or bytes; one call takes either.
      writeSync(fd, /** @type {string} */ (data));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    for (let i = 0; ; i++) {
      try {
        renameSync(tmp, path);
        return path;
      } catch (e) {
        // Windows refuses a rename while another process (a virus scanner, an editor) has the file open.
        if (
          i >= 4 ||
          !(
            /** @type {(string | undefined)[]} */ (['EPERM', 'EBUSY', 'EACCES']).includes(
              /** @type {NodeJS.ErrnoException} */ (e).code
            )
          )
        )
          throw e;
        sleep(50 * (i + 1));
      }
    }
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/**
 * A JSON record, written whole.
 * @param {string} path
 * @param {unknown} value
 * @param {{ pretty?: boolean }} [opts]
 */
export const writeJson = (path, value, { pretty = false } = {}) =>
  writeAtomic(path, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);

/**
 * The UTF-16 byte order a JSON file was saved in, or null. A BOM says so; without one, a JSON
 * text starts with an ASCII character, so a zero byte beside it marks UTF-16.
 * @param {Buffer} b
 * @returns {'LE' | 'BE' | null}
 */
function utf16Of(b) {
  if (b.length < 2) return null;
  if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] !== 0 && b[1] === 0)) return 'LE';
  if ((b[0] === 0xfe && b[1] === 0xff) || (b[0] === 0 && b[1] !== 0)) return 'BE';
  return null;
}

/**
 * A JSON file's value. Throws when the file is missing, does not parse, or is UTF-16.
 * @param {string} path
 * @returns {unknown}
 */
export function readJsonFile(path) {
  const b = readFileSync(path);
  const order = utf16Of(b);
  if (order) throw new Error(`${path} is UTF-16 ${order}; save it as UTF-8`);
  const text = b.toString('utf8');
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

/**
 * A JSON file's value, or `fallback` when it is missing, does not parse or is UTF-16. The value is
 * unchecked: the caller says what it holds.
 * @param {string} path
 * @param {unknown} [fallback]
 * @returns {unknown}
 */
export const readJson = (path, fallback = null) => {
  try {
    return readJsonFile(path);
  } catch {
    return fallback;
  }
};

/**
 * Does the file end mid-line (a write cut short)?
 * @param {number} fd
 */
function endsTorn(fd) {
  const { size } = fstatSync(fd);
  if (!size) return false;
  const b = Buffer.alloc(1);
  readSync(fd, b, 0, 1, size - 1);
  return b[0] !== 0x0a;
}

/**
 * Add one line to a log in one write; `line` is a string or a value to JSON-encode.
 * @param {string} path
 * @param {unknown} line
 */
export function appendLine(path, line) {
  mkdirSync(dirname(path), { recursive: true });
  const text = `${typeof line === 'string' ? line.replace(/\n+$/, '') : JSON.stringify(line)}\n`;
  const fd = openSync(path, 'a+');
  try {
    const lead = endsTorn(fd) ? '\n' : '';
    if (process.env.NODE_ENV === 'test' && process.env.PXSIG_FAULT === 'mid-append') {
      writeSync(fd, `${lead}${text.slice(0, Math.ceil(text.length / 2))}`);
      process.exit(97);
    }
    writeSync(fd, `${lead}${text}`);
  } finally {
    closeSync(fd);
  }
}

/**
 * `{ lines, torn }`: the parsed lines, and `{ line, text }` for each one that is cut or broken.
 * @param {string} path
 * @returns {{ lines: unknown[], torn: TornLine[] }}
 */
export function readLines(path) {
  if (!existsSync(path)) return { lines: [], torn: [] };
  const raw = readFileSync(path, 'utf8');
  const parts = raw.split('\n');
  /** @type {unknown[]} */
  const lines = [];
  /** @type {TornLine[]} */
  const torn = [];
  parts.forEach((text, i) => {
    if (!text.trim()) return;
    const last = i === parts.length - 1; // no newline after it
    try {
      if (last) throw new Error('cut short');
      lines.push(JSON.parse(text));
    } catch {
      torn.push({ line: i + 1, text: text.length > 80 ? `${text.slice(0, 80)}…` : text });
    }
  });
  return { lines, torn };
}

/**
 * Rewrite a log with only its complete lines (what `doctor --repair --only log-torn` does).
 * @param {string} path
 * @returns {number} how many lines were dropped
 */
export function dropTorn(path) {
  const { torn } = readLines(path);
  if (!torn.length) return 0;
  const cut = new Set(torn.map((t) => t.line));
  // The complete lines keep their exact bytes.
  const keep = readFileSync(path, 'utf8')
    .split('\n')
    .filter((text, i) => text.trim() && !cut.has(i + 1));
  writeAtomic(path, keep.map((t) => `${t}\n`).join(''));
  return torn.length;
}
