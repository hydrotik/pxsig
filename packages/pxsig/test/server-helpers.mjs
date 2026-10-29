/**
 * server-helpers.mjs — the stand-in Storybook, the `pxsig serve` launcher and the probes that
 * server-flow.test.mjs and server-lifecycle.test.mjs share.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readToken } from '../src/lib/guard.mjs';
import { hasRust, rustBin } from './fixture.mjs';

/** @import { IndexStory } from '../src/types.js' */
/** @typedef {ReturnType<typeof import('./fixture.mjs').fixture>} Fixture */
/**
 * The keys of the server's POST answers these tests read; each answer has those of its action
 * (docs/server.md).
 * @typedef {{
 *   registered: string[],
 *   queued: string[],
 *   skipped: { name?: string, id?: string, why: string }[],
 *   applied: { action: string, result: string }[],
 *   approved: string[],
 * }} PostAnswer
 */

export const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

let chromium = null;
try {
  const pw = await import('playwright');
  const b = await pw.chromium.launch();
  await b.close();
  chromium = true;
} catch {
  chromium = null;
}
export const needs = !hasRust ? 'Rust binary not built' : !chromium ? 'no Chromium' : false;

/** @returns {Promise<number>} */
export const freePort = () =>
  new Promise((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      // Listening on TCP: the address is an AddressInfo.
      const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
      s.close(() => ok(p));
    });
  });

/**
 * A stand-in Storybook: `/index.json` lists `stories`; `/iframe.html?id=` renders a block, or
 * Storybook's error display for an id containing "broken". The preview object answers what
 * pxsig reads: `storyStoreValue.loadStory` (parameters) and `currentRender` (render finished).
 * @param {IndexStory[]} stories
 */
export async function fakeStorybook(stories) {
  /** @param {string} id */
  const page = (id) => {
    const broken = id.includes('broken');
    return `<!doctype html><html><head><style>body{margin:0;background:#fff}#storybook-root>div{inline-size:96px;block-size:64px;background:#2a4a7a}</style></head>
<body class="${broken ? 'sb-show-errordisplay' : 'sb-show-main'}"><div id="storybook-root">${broken ? '' : '<div></div>'}</div><pre id="error-message">${broken ? 'Story threw: boom' : ''}</pre>
<script>window.__STORYBOOK_PREVIEW__ = { storeInitializationPromise: Promise.resolve(), currentRender: { id: ${JSON.stringify(id)}, phase: 'finished' },
  storyStoreValue: { loadStory: async ({ storyId }) => { if (storyId.includes('unreadable')) throw new Error('loadStory threw'); return { parameters: { pxsig: {} }, tags: [], playFunction: null }; } } };</script></body></html>`;
  };
  const server = createServer((req, res) => {
    // A request to an http server always has a url.
    const u = new URL(/** @type {string} */ (req.url), 'http://x');
    if (u.pathname === '/index.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify({
          v: 5,
          entries: Object.fromEntries(
            stories.map((s) => [
              s.id,
              {
                type: 'story',
                id: s.id,
                title: s.title,
                name: s.name,
                importPath: `./${s.importPath}`,
                tags: [],
              },
            ])
          ),
        })
      );
    }
    if (u.pathname === '/iframe.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(page(u.searchParams.get('id') ?? ''));
    }
    res.writeHead(404).end();
  });
  await /** @type {Promise<void>} */ (new Promise((ok) => server.listen(0, '127.0.0.1', ok)));
  // Listening on TCP: the address is an AddressInfo.
  return {
    url: `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`,
    close: () => server.close(),
  };
}

/**
 * Start `pxsig serve` on a fixture; `storybook` overrides the config's storybook.url, `bin` the
 * engine binary.
 * @param {Fixture} f
 * @param {{ storybook?: string, bin?: string }} [opts]
 */
export async function serve(f, { storybook, bin = rustBin } = {}) {
  if (storybook) {
    const cfgPath = join(f.repo, 'pxsig.config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    writeFileSync(cfgPath, JSON.stringify({ ...cfg, storybook: { url: storybook } }, null, 2));
  }
  const port = await freePort();
  const proc = spawn(
    process.execPath,
    [join(src, 'serve.mjs'), '--port', String(port), '--no-open'],
    { cwd: f.repo, env: { ...f.env, PXSIG_BIN: bin, PXSIG_WORKSPACE: '' } }
  );
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  await /** @type {Promise<void>} */ (
    new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error(`server did not start:\n${log}`)), 20000);
      const on = () => /dashboard →/.test(log) && (clearTimeout(t), ok());
      proc.stdout.on('data', on);
    })
  );
  const base = `http://127.0.0.1:${port}`;
  // As the dashboard posts: with the server's token (`headers` adds or overrides, e.g. no token).
  /**
   * @param {string} action
   * @param {unknown} body
   * @param {Record<string, string>} [headers]
   */
  const post = async (action, body, headers = {}) => {
    const r = await fetch(`${base}/__pxsig/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // The server wrote its token before it printed its URL.
        'x-pxsig-token': /** @type {string} */ (readToken(f.repo, base)),
        ...headers,
      },
      body: JSON.stringify(body),
    });
    // The server answers JSON (docs/server.md).
    return { status: r.status, body: /** @type {PostAnswer} */ (await r.json()) };
  };
  const idle = async () => {
    for (let i = 0; i < 600; i++) {
      // GET /__pxsig/status answers JSON (docs/server.md).
      const s = /** @type {{ running?: unknown, queued?: unknown, repairing?: unknown }} */ (
        await (await fetch(`${base}/__pxsig/status`)).json()
      );
      if (!s.running && !s.queued && !s.repairing) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`the queue did not drain:\n${log}`);
  };
  return { base, port, post, idle, log: () => log, stop: () => proc.kill() };
}

/** @param {Fixture} f */
export const rowsOf = (f) =>
  JSON.parse(readFileSync(join(f.px, 'reports', 'check.json'), 'utf8')).rows;
