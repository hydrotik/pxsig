/**
 * flows-helpers.mjs — what the flows tests share: `setupFlows()` builds the dashboard with the plain
 * example adapter (or PXSIG_FLOWS_ADAPTER), serves it over HTTP and launches Chromium before a
 * file's tests (and cleans up after), and `open()` opens a page on the mocked server. `noChromium()`
 * is the skip when Chromium does not launch.
 */
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { load } from '../../pxsig/src/dashboard-check/capture.mjs';
import { sampleImages } from '../../pxsig/src/dashboard-check/server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = path.dirname(here);
const repo = path.resolve(dashboard, '..', '..');
const require = createRequire(path.join(dashboard, '../pxsig/package.json'));

export let browser = null;
export let skip = false;
let out = null;
let server = null;
export let base = null;

/**
 * The skip reason when Chromium does not launch. CI sets PXSIG_TEST_STRICT=1 (ci.yml, the `node`
 * job), and there the launch error is thrown instead: a broken browser install fails, not skips.
 * @param {unknown} e the launch error
 */
export function noChromium(e) {
  if (process.env.PXSIG_TEST_STRICT === '1') throw e;
  return `no Chromium (${String(/** @type {Error} */ (e).message).split('\n')[0]})`;
}

/** Builds, serves and launches before the calling file's tests; closes and removes them after. */
export function setupFlows() {
  before(async () => {
    try {
      const { chromium } = require('playwright');
      browser = await chromium.launch(
        process.env.PXSIG_CHROMIUM ? { executablePath: process.env.PXSIG_CHROMIUM } : {}
      );
    } catch (e) {
      skip = noChromium(e);
      return;
    }
    const { build } = await import('vite');
    const react = (await import('@vitejs/plugin-react')).default;
    const { vanillaExtractPlugin } = await import('@vanilla-extract/vite-plugin');
    const { dashboardConfig } = await import('../build-config.mjs');
    out = mkdtempSync(path.join(tmpdir(), 'pxsig-flows-'));
    const config = await dashboardConfig({
      // PXSIG_FLOWS_ADAPTER runs the flows on another adapter (`hydrotik`, with PXSIG_DS_SOURCE).
      adapter: process.env.PXSIG_FLOWS_ADAPTER ?? path.join(repo, 'examples/custom-ui/pxsig-ui'),
      cwd: repo,
      outDir: out,
      resolveFrom: [dashboard],
      react,
      vanillaExtractPlugin,
    });
    await build({ ...config, configFile: false, logLevel: 'silent' });
    // Served under /report/ over HTTP, as the server serves it (so the page talks to /__pxsig/).
    server = createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      let file = path.join(
        out,
        decodeURIComponent(u.pathname.replace(/^\/report\/?/, '')) || 'index.html'
      );
      if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!existsSync(file)) return res.writeHead(404).end();
      res.writeHead(200, {
        'content-type': file.endsWith('.html')
          ? 'text/html'
          : file.endsWith('.js')
            ? 'text/javascript'
            : file.endsWith('.css')
              ? 'text/css'
              : 'application/octet-stream',
      });
      createReadStream(file).pipe(res);
    });
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await browser?.close();
    server?.close();
    if (out) rmSync(out, { recursive: true, force: true });
  });
}

// --- data: the shared scenarios (fixtures/scenarios.mjs, also what `pxsig dashboard check` renders)

/**
 * A page on the mocked server. `events` is the SSE stream body; `posts` collects every POST;
 * `approving` is the status answer's (unset: unknown, as from an older server). `images` serves
 * the sample PNGs under /p/demo/, as the screens server does, so the inspector draws its stage; a
 * function picks them per path (a `sampleImages()` result, or null for a 404).
 * `routes(page)` adds the caller's own routes before the page loads; they take precedence.
 */
export async function open(
  d,
  {
    hash = '',
    events = 'event: hello\ndata: {}\n\n',
    answers = {},
    init = null,
    approving,
    images = false,
    routes = null,
  } = {}
) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  if (init) await page.addInitScript(init);
  const posts = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/__pxsig/**', async (route) => {
    const req = route.request();
    const name = new URL(req.url()).pathname.replace('/__pxsig/', '');
    if (name === 'events')
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: `retry: 60000\n${events}`,
      });
    if (name === 'data') return route.fulfill({ json: d });
    if (name === 'status') return route.fulfill({ json: approving ? { approving } : {} });
    if (name === 'projects')
      return route.fulfill({
        json: {
          projects: [{ name: 'demo', root: '.', entries: d.check.rows.length, integrity: null }],
        },
      });
    if (req.method() === 'POST') {
      posts.push({ name, body: req.postDataJSON() });
      const a = answers[name] ?? { ok: true };
      return route.fulfill(a.status ? { status: a.status, json: a.json } : { json: a });
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  const sample = images === true ? sampleImages() : null;
  await page.route('**/p/demo/**', async (route) => {
    const u = new URL(route.request().url()).pathname;
    const png = typeof images === 'function' ? await images(u) : sample;
    if (!png || !u.endsWith('.png')) return route.fulfill({ status: 404, body: '' });
    const body = u.includes('/diffs/') ? png.diff : u.includes('/base') ? png.baseline : png.render;
    return route.fulfill({ status: 200, contentType: 'image/png', body });
  });
  if (routes) await routes(page);
  // One retry on Windows' ERR_NO_BUFFER_SPACE, as `pxsig dashboard check` does.
  await load(page, `${base}/report/${hash}`);
  return { page, posts, errors };
}
