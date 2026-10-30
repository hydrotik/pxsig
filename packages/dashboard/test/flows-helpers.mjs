/**
 * flows-helpers.mjs — what the flows tests share: `setupFlows()` builds the dashboard with the plain
 * example adapter, serves it over HTTP and launches Chromium before a file's tests (and cleans up
 * after), and `open()` opens a page on the mocked server. `noChromium()` is the skip when Chromium
 * does not launch.
 */
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

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
      adapter: path.join(repo, 'examples/custom-ui/pxsig-ui'),
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

/** A page on the mocked server. `events` is the SSE stream body; `posts` collects every POST. */
export async function open(
  d,
  { hash = '', events = 'event: hello\ndata: {}\n\n', answers = {}, init = null } = {}
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
  await page.route('**/p/demo/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto(`${base}/report/${hash}`);
  return { page, posts, errors };
}
