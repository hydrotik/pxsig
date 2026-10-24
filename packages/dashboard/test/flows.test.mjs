/**
 * The dashboard's review and repair flows in a real browser, against a mocked server: the build
 * uses the plain example adapter (no design system needed), is served over HTTP like `pxsig
 * serve` serves it, and every /__pxsig/ request is answered by page.route, so nothing here can
 * write a baseline. Skips when no Chromium is available (PXSIG_CHROMIUM names an executable).
 */
import assert from 'node:assert/strict';
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = path.dirname(here);
const repo = path.resolve(dashboard, '..', '..');
const require = createRequire(path.join(dashboard, '../pxsig/package.json'));

let browser = null;
let skip = false;
let out = null;
let server = null;
let base = null;

before(async () => {
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch(process.env.PXSIG_CHROMIUM ? { executablePath: process.env.PXSIG_CHROMIUM } : {});
  } catch (e) {
    skip = `no Chromium (${String(e.message).split('\n')[0]})`;
    return;
  }
  const { build } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { vanillaExtractPlugin } = await import('@vanilla-extract/vite-plugin');
  const { dashboardConfig } = await import('../build-config.mjs');
  out = mkdtempSync(path.join(tmpdir(), 'pxsig-flows-'));
  const config = await dashboardConfig({ adapter: path.join(repo, 'examples/custom-ui/pxsig-ui'), cwd: repo, outDir: out, resolveFrom: [dashboard], react, vanillaExtractPlugin });
  await build({ ...config, configFile: false, logLevel: 'silent' });
  // Served under /report/ over HTTP, as the server serves it (so the page talks to /__pxsig/).
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let file = path.join(out, decodeURIComponent(u.pathname.replace(/^\/report\/?/, '')) || 'index.html');
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream' });
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

// --- data ---------------------------------------------------------------------------------------
const row = (id, extra = {}) => ({ id, story: id.replace(/(__[^@]+)?(@.+)?$/, ''), mode: id.includes('@light') ? 'light' : 'dark', state: null, pass: true, metrics: { ssim: 1, changedCells: 0 }, reasons: [], checkedAt: '2026-10-24T10:00:00.000Z', ...extra });
const changed = { pass: false, changed: true, metrics: { ssim: 0.8, changedCells: 12, changedCellsPct: 3, grid: 64 }, reasons: ['ssim 0.8 < min 0.99'] };
const entry = (id, issues = []) => ({ id, story: id.replace(/(__[^@]+)?(@.+)?$/, ''), component: 'Button', mode: 'dark', state: null, status: issues[0]?.code ?? 'ok', severity: issues[0]?.severity ?? 'info', issues, files: { sig: `${id}.psig`, sigExists: !issues.some((i) => i.code === 'unbaselined'), baseImage: true, latestRender: true } });

function data({ rows, entries, summary = {} }) {
  const byCode = {};
  for (const x of entries) for (const i of x.issues) byCode[i.code] = (byCode[i.code] ?? 0) + 1;
  const err = entries.filter((x) => x.severity === 'error').length;
  const warn = entries.filter((x) => x.severity === 'warn').length;
  return {
    generatedAt: '2026-10-24T10:00:00.000Z',
    project: 'demo',
    store: '.pxsig',
    check: {
      generatedAt: '2026-10-24T10:00:00.000Z',
      manifest: { grid: 64, gate: null, modes: null, defaultMode: 'dark' },
      summary: { entries: rows.length, checked: rows.length, skipped: 0, passed: rows.filter((r) => r.pass).length, failed: rows.filter((r) => !r.pass).length, flaky: 0, errors: rows.filter((r) => r.error).length, cached: 0, a11yViolations: 0, a11yNew: 0, modes: ['dark', 'light'], concurrency: 1, renderWallMs: 100, rustEngineMs: 1, rustProcessMs: 1, retryMs: 0, affected: null, totalMs: 200, ...summary },
      rows,
    },
    detailCalibration: null,
    bench: null,
    history: [],
    review: {},
    a11yReview: {},
    storybook: { baseUrl: 'http://127.0.0.1:1' },
    paths: { diffRoot: '/p/demo/diffs/', renders: '/p/demo/renders/', baselines: '' },
    sigs: {},
    integrity: {
      schemaVersion: 1,
      generatedAt: '2026-10-24T10:00:00.000Z',
      sources: { storyIndex: { source: 'storybook', inScope: entries.length }, report: { generatedAt: '2026-10-24T10:00:00.000Z' } },
      setup: [],
      summary: { status: err ? 'attention' : warn ? 'warnings' : 'clean', headline: '', entries: entries.length, components: 1, componentsBySeverity: { error: err ? 1 : 0, warn: !err && warn ? 1 : 0, info: 0 }, bySeverity: { error: err, warn, info: entries.length - err - warn }, byCode },
      components: [{ component: 'Button', status: entries[0]?.status ?? 'ok', severity: err ? 'error' : warn ? 'warn' : 'info', entries: entries.length, stories: 1, counts: byCode }],
      entries,
    },
  };
}

/** A page on the mocked server. `events` is the SSE stream body; `posts` collects every POST. */
async function open(d, { hash = '', events = 'event: hello\ndata: {}\n\n', answers = {} } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const posts = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/__pxsig/**', async (route) => {
    const req = route.request();
    const name = new URL(req.url()).pathname.replace('/__pxsig/', '');
    if (name === 'events') return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: `retry: 60000\n${events}` });
    if (name === 'data') return route.fulfill({ json: d });
    if (name === 'projects') return route.fulfill({ json: { projects: [{ name: 'demo', root: '.', entries: d.check.rows.length, integrity: null }] } });
    if (req.method() === 'POST') {
      posts.push({ name, body: req.postDataJSON() });
      return route.fulfill({ json: answers[name] ?? { ok: true } });
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.route('**/p/demo/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto(`${base}/report/${hash}`);
  return { page, posts, errors };
}

test('new entries waiting for a first approval keep the banner, counted on their own, with the queue that approves them', async (t) => {
  if (skip) return t.skip(skip);
  const ids = ['ui-button--new', 'ui-button--new@light'];
  const d = data({
    rows: [row('ui-button--ok'), ...ids.map((id) => row(id, { pass: false, new: true, metrics: null, reasons: ['new'] }))],
    entries: [entry('ui-button--ok'), ...ids.map((id) => entry(id, [{ code: 'unbaselined', severity: 'warn', reason: 'no signature' }]))],
  });
  const { page, errors } = await open(d);
  try {
    const banner = page.getByRole('region', { name: 'Coverage' });
    await banner.waitFor();
    assert.match(await banner.innerText(), /Needs a first approval: 2 entries/);
    await banner.getByRole('button', { name: 'Approve 2 new entries' }).waitFor();
    assert.equal(await banner.getByRole('button', { name: 'Run safe repairs' }).count(), 0, 'nothing to repair: the entries are rendered');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("a failed check's error reaches the page", async (t) => {
  if (skip) return t.skip(skip);
  const d = data({ rows: [row('ui-button--ok')], entries: [entry('ui-button--ok')] });
  const events = 'event: hello\ndata: {}\n\nevent: check\ndata: {"project":"demo","state":"error","ids":["ui-button--ok"],"error":"setup error: Storybook is not reachable","setup":true}\n\n';
  const { page } = await open(d, { events });
  try {
    await page.getByText('Check not run: setup error').waitFor();
    await page.getByText('setup error: Storybook is not reachable').waitFor();
    await page.getByRole('button', { name: 'Dismiss' }).click();
    assert.equal(await page.getByText('Check not run: setup error').count(), 0);
  } finally {
    await page.close();
  }
});

test('a render error card offers a re-check of that entry', async (t) => {
  if (skip) return t.skip(skip);
  const id = 'ui-button--broken';
  const d = data({ rows: [row('ui-button--ok'), row(id, { pass: false, metrics: null, error: 'locator.click: Timeout 5000ms exceeded' })], entries: [entry('ui-button--ok'), entry(id, [{ code: 'render-error', severity: 'error', reason: 'timeout' }])] });
  const { page, posts } = await open(d, { hash: '#tab=stories', answers: { check: { ok: true, queued: [id] } } });
  try {
    const card = page.getByRole('group', { name: id });
    await card.waitFor();
    await card.getByRole('button', { name: 'Re-check' }).click();
    await card.getByRole('button', { name: /Checking/ }).waitFor();
    assert.deepEqual(posts.find((p) => p.name === 'check')?.body, { project: 'demo', ids: [id] });
  } finally {
    await page.close();
  }
});

test("the inspector approves a story's entries together, and re-checks one entry", async (t) => {
  if (skip) return t.skip(skip);
  const story = 'ui-button--primary';
  const d = data({
    rows: [row(story, changed), row(`${story}@light`, { ...changed, mode: 'light' }), row('ui-button--ok')],
    entries: [entry(story, [{ code: 'changed', severity: 'warn', reason: 'gate failed' }]), entry(`${story}@light`, [{ code: 'changed', severity: 'warn', reason: 'gate failed' }]), entry('ui-button--ok')],
  });
  const { page, posts } = await open(d, {
    hash: `#inspect=${story}`,
    answers: { 'approve-story': { ok: true, story, batch: 'b1', approved: [story, `${story}@light`], skipped: [] }, check: { ok: true, queued: [story] } },
  });
  try {
    const button = page.getByRole('button', { name: 'Approve story · 2 entries' });
    await button.waitFor();
    await button.click();
    await page.getByText(`Approved 2 entries of ${story}.`).waitFor();
    assert.deepEqual(posts.find((p) => p.name === 'approve-story')?.body, { project: 'demo', story });
    await page.getByRole('button', { name: 'Re-check' }).click();
    await page.getByText('Queued 1 entry').waitFor();
    assert.deepEqual(posts.find((p) => p.name === 'check')?.body, { project: 'demo', ids: [story] });
    assert.equal(posts.filter((p) => p.name === 'approve').length, 0, 'no single approvals were sent');
  } finally {
    await page.close();
  }
});
