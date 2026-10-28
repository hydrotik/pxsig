/**
 * static.mjs — serve a built Storybook (`storybook.staticDir`) when the configured one is not running.
 *
 * `check --full`, `manifest` and the server first ask `storybook.url` for its index. When nothing
 * answers there and the project has a `storybook.staticDir` holding a build (`index.json` +
 * `iframe.html`), they serve that folder themselves on a free 127.0.0.1 port and render against it.
 * A Storybook that answers with a broken index is not replaced: that is a setup error to fix.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fetchStoryIndex } from './integrity.mjs';
/** @import { AddressInfo } from 'node:net' */
/** @import { StaticServer } from '../types.js' */
/** What `fetchStoryIndex` (lib/integrity.mjs) found. */
/** @typedef {Awaited<ReturnType<typeof fetchStoryIndex>>} StoryIndexProbe */

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

/**
 * Does `dir` hold a Storybook build?
 * @param {string | null | undefined} dir
 */
export const isStorybookBuild = (dir) =>
  !!dir && existsSync(join(dir, 'index.json')) && existsSync(join(dir, 'iframe.html'));

/**
 * Serve `dir` read-only on 127.0.0.1 (port 0 = a free one). Resolves to { url, port, close }.
 * @param {string} dir
 * @param {{ port?: number }} [opts]
 * @returns {Promise<StaticServer>}
 */
export function serveStaticDir(dir, { port = 0 } = {}) {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    let file;
    try {
      // A request the server is handling always has a URL (node:http types it optional for clients).
      file = resolve(
        root,
        `.${decodeURIComponent(new URL(/** @type {string} */ (req.url), 'http://x').pathname)}`
      );
    } catch {
      return res.writeHead(400).end();
    }
    if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => {
      // Listening on a TCP port: `address()` is an AddressInfo.
      const p = /** @type {AddressInfo} */ (server.address()).port;
      server.unref();
      ok({
        url: `http://127.0.0.1:${p}`,
        port: p,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/**
 * Make sure the project has a Storybook to render against. Returns
 * `{ url, served: false }` when `storybook.url` answers (healthy or not: a broken index is the
 * caller's setup error), or `{ url, served: true, close }` after serving `storybook.staticDir`.
 * On success with a served build, `P.storybook.url` is rewritten to the served address, so the
 * run manifest and every renderer use it.
 * @param {{ storybook: { url: string, staticDir: string | null } }} P
 * @param {{ log?: (message: string) => void, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ url: string, served: false, index: StoryIndexProbe } | { url: string, served: true, close: () => Promise<void>, index: StoryIndexProbe }>}
 */
export async function ensureStorybook(P, { log = () => {}, fetchImpl } = {}) {
  const idx = await fetchStoryIndex(P.storybook.url, { timeoutMs: 3000, fetchImpl });
  if (idx.reachable) return { url: P.storybook.url, served: false, index: idx };
  const dir = P.storybook.staticDir;
  if (!dir) return { url: P.storybook.url, served: false, index: idx };
  if (!isStorybookBuild(dir)) {
    log(
      `storybook.staticDir ${dir} holds no Storybook build (index.json + iframe.html): build it first`
    );
    return { url: P.storybook.url, served: false, index: idx };
  }
  const s = await serveStaticDir(dir);
  log(`Storybook not reachable at ${P.storybook.url}: serving storybook.staticDir at ${s.url}`);
  P.storybook.url = s.url;
  return {
    url: s.url,
    served: true,
    close: s.close,
    index: await fetchStoryIndex(s.url, { fetchImpl }),
  };
}
