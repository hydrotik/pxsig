/**
 * serve/http.mjs — the server's HTTP helpers: content types, errors that carry a status, JSON
 * answers, request bodies, files, and the CORS headers for a project's Storybook.
 */
import { createReadStream, statSync } from 'node:fs';
import { extname, sep } from 'node:path';
/** @import { IncomingMessage, ServerResponse } from 'node:http' */
/** @import { HttpError, RequestBody } from '../types/t5.js' */

/** @type {Record<string, string>} */
export const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.log': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};
/**
 * @param {number} status
 * @param {string} message
 * @returns {HttpError}
 */
export const httpError = (status, message) => Object.assign(new Error(message), { status });
/**
 * @param {Set<string>} allowedOrigins
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 */
export const cors = (allowedOrigins, req, res) => {
  const o = req.headers.origin;
  if (o && allowedOrigins.has(o)) {
    res.setHeader('access-control-allow-origin', o);
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    // Never x-pxsig-token: another origin cannot send a decision.
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('vary', 'origin');
  }
};
/**
 * @param {ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
export const json = (res, status, body) => {
  res.writeHead(status, {
    'content-type': TYPES['.json'],
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
};
/**
 * The request's JSON body (`{}` when empty); a body that does not parse rejects with status 400.
 * @param {IncomingMessage} req
 * @returns {Promise<RequestBody>}
 */
export const readBody = (req) =>
  new Promise((ok, fail) => {
    let s = '';
    req.on('data', (/** @type {Buffer} */ c) => {
      s += c;
      if (s.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        // Whatever the client sent: every key is checked where it is read.
        ok(s ? /** @type {RequestBody} */ (JSON.parse(s)) : {});
      } catch (e) {
        // JSON.parse throws a SyntaxError.
        fail(Object.assign(/** @type {SyntaxError} */ (e), { status: 400 }));
      }
    });
  });
/**
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {string} file
 */
export const sendFile = (req, res, file) => {
  const st = statSync(file);
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': st.size,
    'cache-control': 'no-cache',
    'last-modified': st.mtime.toUTCString(),
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
};
/**
 * @param {string} root
 * @param {string} file
 */
export const inside = (root, file) => file === root || file.startsWith(root + sep);
