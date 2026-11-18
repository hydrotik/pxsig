/**
 * lib/encode.mjs — gzip for the text the servers send (`pxsig serve`, the `dashboard check`
 * scenario server): the dashboard's script, styles and page, the reports' text files and the JSON
 * answers, when the request's Accept-Encoding allows gzip.
 *
 * - Only text types (text/*, JSON, JavaScript, XML, SVG) and only bodies of 1 KiB or more; images,
 *   fonts and anything already compressed go as they are. An event stream never comes here: its
 *   handlers write to the response themselves.
 * - Every response of a compressible type says `Vary: Accept-Encoding`, gzipped or not, added to
 *   any Vary already set (CORS sets `origin`).
 * - Files: the gzipped bytes are kept per path, size and modification time, up to 32 MiB in all
 *   (least recently used out first), so the 3 MB dashboard script is compressed once per build.
 *   Answers built per request (JSON) are compressed each time and never kept.
 * - gzip level 6 (node:zlib), synchronous: about 40 ms for the dashboard script, once per build.
 * - A project's store files (`/p/<project>/…`: renders, diffs, their pages, baseline headers,
 *   rejection packets) always go as they are (`sendAsIs`): the dashboard reads their sizes from
 *   Content-Length, which must be the file's own, and images gain nothing.
 */
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
/** @import { IncomingMessage, ServerResponse } from 'node:http' */
/** @import { Stats } from 'node:fs' */

/** Bodies smaller than this go as they are: gzip would save less than its own overhead. */
export const MIN_BYTES = 1024;
/** The most compressed file bytes kept at once. */
export const CACHE_BYTES = 32 * 1024 * 1024;
const LEVEL = 6;

/** Marks a response that is never encoded (`sendAsIs`). */
const AS_IS = Symbol('pxsig.sendAsIs');

/**
 * Send this response as it is, whatever its type and the request's Accept-Encoding: for a
 * project's store files, whose Content-Length the dashboard shows as their size. Call before
 * `writeHead`.
 * @param {ServerResponse} res
 */
export function sendAsIs(res) {
  /** @type {Record<symbol, boolean>} */ (/** @type {unknown} */ (res))[AS_IS] = true;
}

/**
 * Whether a content type is text worth compressing (never an event stream).
 * @param {string | undefined} type
 */
export const compressible = (type) =>
  !!type &&
  !/^text\/event-stream/i.test(type) &&
  /^(text\/|application\/(json|javascript|xml|manifest\+json)|image\/svg\+xml)/i.test(type);

/**
 * Whether the request accepts gzip (RFC 9110 §12.5.3): `gzip` or `*` with a q-value above 0, an
 * explicit `gzip;q=0` winning over `*`.
 * @param {IncomingMessage | undefined} req
 */
export function acceptsGzip(req) {
  const h = req?.headers?.['accept-encoding'];
  if (!h) return false;
  /** @type {Record<string, number>} */
  const q = {};
  for (const part of String(h).split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (!name) continue;
    const qp = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const v = qp ? Number(qp.slice(2)) : 1;
    q[name] = Number.isFinite(v) ? v : 0;
  }
  if ('gzip' in q) return q.gzip > 0;
  if ('x-gzip' in q) return q['x-gzip'] > 0;
  return (q['*'] ?? 0) > 0;
}

/**
 * Add `accept-encoding` to the response's Vary, keeping what is there.
 * @param {ServerResponse} res
 */
export function varyEncoding(res) {
  const have = res.getHeader('vary');
  const list = (Array.isArray(have) ? have.join(',') : String(have ?? ''))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.some((v) => v === '*' || v.toLowerCase() === 'accept-encoding')) return;
  res.setHeader('vary', [...list, 'accept-encoding'].join(', '));
}

/**
 * Before the head is written: for a compressible `type`, set Vary and, when gzip is accepted and
 * the body is large enough, Content-Encoding. Returns whether the body is to be gzipped.
 * @param {IncomingMessage | undefined} req
 * @param {ServerResponse} res
 * @param {string | undefined} type
 * @param {number} size
 */
function negotiate(req, res, type, size) {
  if (/** @type {Record<symbol, boolean>} */ (/** @type {unknown} */ (res))[AS_IS]) return false;
  if (!compressible(type)) return false;
  varyEncoding(res);
  if (res.getHeader('content-encoding') || size < MIN_BYTES || !acceptsGzip(req)) return false;
  res.setHeader('content-encoding', 'gzip');
  return true;
}

/**
 * A body built for this request (a JSON answer, a page): its gzipped bytes when the request takes
 * them (Content-Encoding and Vary are then set on `res`), else null and the body goes as it is.
 * Never kept. Call before `writeHead`.
 * @param {IncomingMessage | undefined} req
 * @param {ServerResponse} res
 * @param {string | Buffer} body
 * @param {string | undefined} type
 * @returns {Buffer | null}
 */
export function encodeBody(req, res, body, type) {
  const size = typeof body === 'string' ? Buffer.byteLength(body) : body.length;
  return negotiate(req, res, type, size) ? gzipSync(body, { level: LEVEL }) : null;
}

/** @type {Map<string, { size: number, mtimeMs: number, gz: Buffer }>} path → gzipped bytes, oldest use first */
const cache = new Map();
let cached = 0;

/**
 * A file's gzipped bytes when the request takes them (Content-Encoding and Vary are then set on
 * `res`), else null and the file goes as it is. Kept per path, size and mtime. Call before
 * `writeHead`.
 * @param {IncomingMessage | undefined} req
 * @param {ServerResponse} res
 * @param {string} file
 * @param {Stats} st
 * @param {string | undefined} type
 * @returns {Buffer | null}
 */
export function encodeFile(req, res, file, st, type) {
  if (!negotiate(req, res, type, st.size)) return null;
  const hit = cache.get(file);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) {
    // Most recently used goes last.
    cache.delete(file);
    cache.set(file, hit);
    return hit.gz;
  }
  if (hit) forget(file);
  const gz = gzipSync(readFileSync(file), { level: LEVEL });
  if (gz.length <= CACHE_BYTES) {
    cache.set(file, { size: st.size, mtimeMs: st.mtimeMs, gz });
    cached += gz.length;
    for (const [k] of cache) {
      if (cached <= CACHE_BYTES) break;
      forget(k);
    }
  }
  return gz;
}

/** @param {string} file */
function forget(file) {
  const e = cache.get(file);
  if (!e) return;
  cached -= e.gz.length;
  cache.delete(file);
}

/** What the file cache holds (for tests): entries and bytes. */
export const cacheStats = () => ({ entries: cache.size, bytes: cached });
