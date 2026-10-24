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
async function open(d, { hash = '', events = 'event: hello\ndata: {}\n\n', answers = {}, init = null } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  if (init) await page.addInitScript(init);
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

test('a link that names the theme opens in it, over the remembered one (the Storybook addon passes its own)', async (t) => {
  if (skip) return t.skip(skip);
  const d = data({ rows: [row('ui-button--ok')], entries: [entry('ui-button--ok')] });
  for (const [mode, stored, toggle] of [['dark', 'light', 'Light theme'], ['light', 'dark', 'Dark theme']]) {
    const { page } = await open(d, { hash: `?theme=${mode}`, init: `localStorage.setItem('pxsig-dashboard-theme', '${stored}')` });
    try {
      await page.getByRole('button', { name: toggle }).waitFor();
    } finally {
      await page.close();
    }
  }
});

// --- the Overview's columns, its errors card and the stale heatmap ---------------------------------

const stale = { code: 'stale', severity: 'warn', reason: 'src/x.tsx edited after the verdict' };
/** Entries spread over components (`Name:index`), the ledger's components counted from them. */
function spread(d) {
  const L = d.integrity;
  const names = [...new Set(L.entries.map((x) => x.component))];
  L.components = names.map((component) => {
    const es = L.entries.filter((x) => x.component === component);
    const counts = {};
    for (const x of es) for (const i of x.issues) counts[i.code] = (counts[i.code] ?? 0) + 1;
    const severity = es.some((x) => x.severity === 'error') ? 'error' : es.some((x) => x.severity === 'warn') ? 'warn' : 'info';
    return { component, status: es.find((x) => x.severity === severity)?.status ?? 'ok', severity, entries: es.length, stories: 1, counts };
  });
  const by = { error: 0, warn: 0, info: 0 };
  for (const c of L.components) by[c.severity]++;
  L.summary.components = L.components.length;
  L.summary.componentsBySeverity = by;
  L.summary.status = by.error ? 'attention' : by.warn ? 'warnings' : 'clean';
  return d;
}
const inComponent = (component, id, issues) => ({ ...entry(id, issues), component });
const history = (n) => Array.from({ length: n }, (_, i) => ({ at: `2026-10-2${i}T10:00:00.000Z`, summary: { stories: 4, failed: i % 3, cached: 0, elapsedMs: 40 }, failedIds: [] }));

test('the Overview: open items and stale entries on the left, errors (only with errors) and changed entries per run on the right', async (t) => {
  if (skip) return t.skip(skip);
  const broken = 'ui-card--broken';
  const d = spread(
    data({
      rows: [row('ui-button--ok'), row(broken, { pass: false, metrics: null, error: 'locator.click: Timeout 5000ms exceeded' })],
      entries: [entry('ui-button--ok', [stale]), inComponent('Card', broken, [{ code: 'never-checked', severity: 'error', reason: 'no verdict' }])],
    })
  );
  d.history = history(3);
  const { page, errors } = await open(d);
  try {
    const box = async (name) => page.getByRole('heading', { name, exact: true }).boundingBox();
    await page.getByRole('heading', { name: 'Errors', exact: true }).waitFor();
    const [items, heat, errs, runs] = [await box('Open Items'), await box('Stale Entries by Component'), await box('Errors'), await box('Changed Entries per Run')];
    assert.ok(items.x < errs.x && Math.abs(items.y - errs.y) < 4, 'open items and errors start one row, side by side');
    assert.ok(Math.abs(items.x - heat.x) < 1 && heat.y > items.y, 'stale entries sit under open items');
    assert.ok(Math.abs(errs.x - runs.x) < 1 && runs.y > errs.y, 'changed entries per run sit under errors');
    const card = page.getByRole('table').filter({ hasText: 'Entry or component' });
    assert.match(await card.innerText(), /Render error[\s\S]*ui-card--broken[\s\S]*Coverage error[\s\S]*Card/);
    // The coverage errors are in the card, not also in the banner above it; other tabs keep the banner.
    assert.equal(await page.getByRole('region', { name: 'Coverage' }).count(), 0);
    await page.getByRole('link', { name: /^Help/ }).click();
    await page.getByRole('region', { name: 'Coverage' }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('the Overview shows no errors card without errors; one column on a narrow page', async (t) => {
  if (skip) return t.skip(skip);
  const d = spread(data({ rows: [row('ui-button--ok')], entries: [entry('ui-button--ok')] }));
  d.history = history(2);
  const { page } = await open(d);
  try {
    await page.getByRole('heading', { name: 'Changed Entries per Run' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Errors', exact: true }).count(), 0);
    await page.getByText('No stale entries').waitFor();
    await page.setViewportSize({ width: 640, height: 900 });
    const items = await page.getByRole('heading', { name: 'Open Items' }).boundingBox();
    const runs = await page.getByRole('heading', { name: 'Changed Entries per Run' }).boundingBox();
    assert.ok(Math.abs(items.x - runs.x) < 1 && runs.y > items.y, 'one column: the right column follows the left');
  } finally {
    await page.close();
  }
});

test('stale heatmap tiles name their component and count, worst share first, and open Coverage filtered to it', async (t) => {
  if (skip) return t.skip(skip);
  const d = spread(
    data({
      rows: [],
      entries: [
        inComponent('Button', 'ui-button--a', [stale]),
        inComponent('Button', 'ui-button--b'),
        inComponent('Button', 'ui-button--c'),
        inComponent('Card', 'ui-card--a', [stale]),
        inComponent('Card', 'ui-card--b', [stale]),
        inComponent('Dialog', 'ui-dialog--a'),
      ],
    })
  );
  const { page, errors } = await open(d);
  try {
    const grid = page.getByRole('list', { name: 'Stale Entries by Component' });
    await grid.waitFor();
    const names = await grid.getByRole('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
    assert.deepEqual(names, ['Card: 2 stale of 2 entries', 'Button: 1 stale of 3 entries'], 'no tile for a component with nothing stale');
    assert.match(await grid.innerText(), /2 stale of 2/, 'the count is on the tile, not only its colour');
    await grid.getByRole('button', { name: 'Button: 1 stale of 3 entries' }).click();
    await page.getByRole('button', { name: 'Only Button' }).waitFor();
    await page.getByRole('heading', { name: 'Button', exact: true }).waitFor();
    const table = page.getByRole('table').filter({ hasText: 'Component' }).first();
    assert.doesNotMatch(await table.innerText(), /Card/, 'the components table shows only that component');
    // The button that names the filter clears it.
    await page.getByRole('button', { name: 'Only Button' }).click();
    await page.getByRole('cell', { name: 'Card' }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
