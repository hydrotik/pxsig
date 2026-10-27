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
import {
  changed,
  data,
  entry,
  history,
  inComponent,
  row,
  spread,
  stale,
} from '../fixtures/scenarios.mjs';

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
    browser = await chromium.launch(
      process.env.PXSIG_CHROMIUM ? { executablePath: process.env.PXSIG_CHROMIUM } : {}
    );
  } catch (e) {
    skip = `no Chromium (${String(e.message).split('\n')[0]})`;
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

// --- data: the shared scenarios (fixtures/scenarios.mjs, also what `pxsig dashboard check` renders)

/** A page on the mocked server. `events` is the SSE stream body; `posts` collects every POST. */
async function open(
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

test('new entries waiting for a first approval keep the banner, counted on their own, with the queue that approves them', async (t) => {
  if (skip) return t.skip(skip);
  const ids = ['ui-button--new', 'ui-button--new@light'];
  const d = data({
    rows: [
      row('ui-button--ok'),
      ...ids.map((id) => row(id, { pass: false, new: true, metrics: null, reasons: ['new'] })),
    ],
    entries: [
      entry('ui-button--ok'),
      ...ids.map((id) =>
        entry(id, [{ code: 'unbaselined', severity: 'warn', reason: 'no signature' }])
      ),
    ],
  });
  const { page, errors } = await open(d);
  try {
    const banner = page.getByRole('region', { name: 'Coverage' });
    await banner.waitFor();
    assert.match(await banner.innerText(), /Needs a first approval: 2 entries/);
    await banner.getByRole('button', { name: 'Approve 2 new entries' }).waitFor();
    assert.equal(
      await banner.getByRole('button', { name: 'Run safe repairs' }).count(),
      0,
      'nothing to repair: the entries are rendered'
    );
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('the top bar: the title is the label (else the project), the versions on hover of "pxsig", the modes beside the connection', async (t) => {
  if (skip) return t.skip(skip);
  // Beside the connection badge, not in the title.
  const modesBeside = (page) =>
    page.evaluate(() => {
      const badge = [...document.querySelectorAll('nav *')].find(
        (e) => e.children.length === 0 && e.textContent === 'dark · light'
      );
      return {
        inTitle: Boolean(badge?.closest('h1')),
        next: badge?.nextElementSibling?.textContent ?? null,
      };
    });
  const plain = data({ rows: [row('ui-button--ok')], entries: [entry('ui-button--ok')] });
  {
    const { page, errors } = await open(plain);
    try {
      const h1 = page.getByRole('heading', { level: 1 });
      await h1.waitFor();
      assert.equal(await h1.innerText(), 'pxsig · demo', 'no label: the project name, as before');
      const m = await modesBeside(page);
      assert.equal(m.inTitle, false);
      assert.match(m.next, /^(Live|Offline)$/, 'the connection badge comes right after');
      // An older server sends no versions: the contract the page was built against still shows.
      assert.match(
        await h1.locator('span[title]').getAttribute('title'),
        /^UI contract \d+\.\d+\.\d+$/
      );
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
  const labelled = {
    ...plain,
    label: 'Hydrotik',
    versions: { pxsig: '9.8.7', engine: '9.8.6', contract: '1.1.0' },
  };
  {
    const { page, errors } = await open(labelled);
    try {
      const h1 = page.getByRole('heading', { level: 1 });
      await h1.waitFor();
      assert.equal(await h1.innerText(), 'pxsig · Hydrotik');
      // The plain example adapter has no Tooltip: the fallback puts the text in the native title.
      assert.equal(
        await h1.locator('span[title]').getAttribute('title'),
        'pxsig 9.8.7 · engine 9.8.6 · UI contract 1.1.0'
      );
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
  {
    const { page } = await open(labelled, { hash: '#help' });
    try {
      await page.getByText('This page: pxsig 9.8.7 · engine 9.8.6 · UI contract 1.1.0.').waitFor();
    } finally {
      await page.close();
    }
  }
});

test('a sparse report (a check.json whose summary is empty) renders every section, with zeros', async (t) => {
  if (skip) return t.skip(skip);
  const d = data({ rows: [row('ui-button--ok')], entries: [entry('ui-button--ok')] });
  d.check.summary = {};
  for (const tab of ['overview', 'stories', 'integrity', 'a11y', 'history', 'diagnostics']) {
    const { page, errors } = await open(d, { hash: `#tab=${tab}` });
    try {
      await page.getByRole('main').waitFor();
      await page.waitForTimeout(150);
      assert.deepEqual(errors, [], `the ${tab} section`);
    } finally {
      await page.close();
    }
  }
});

test("a failed check's error reaches the page", async (t) => {
  if (skip) return t.skip(skip);
  const d = data({ rows: [row('ui-button--ok')], entries: [entry('ui-button--ok')] });
  const events =
    'event: hello\ndata: {}\n\nevent: check\ndata: {"project":"demo","state":"error","ids":["ui-button--ok"],"error":"setup error: Storybook is not reachable","setup":true}\n\n';
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
  const d = data({
    rows: [
      row('ui-button--ok'),
      row(id, { pass: false, metrics: null, error: 'locator.click: Timeout 5000ms exceeded' }),
    ],
    entries: [
      entry('ui-button--ok'),
      entry(id, [{ code: 'render-error', severity: 'error', reason: 'timeout' }]),
    ],
  });
  const { page, posts } = await open(d, {
    hash: '#tab=stories',
    answers: { check: { ok: true, queued: [id] } },
  });
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
    rows: [
      row(story, changed),
      row(`${story}@light`, { ...changed, mode: 'light' }),
      row('ui-button--ok'),
    ],
    entries: [
      entry(story, [{ code: 'changed', severity: 'warn', reason: 'gate failed' }]),
      entry(`${story}@light`, [{ code: 'changed', severity: 'warn', reason: 'gate failed' }]),
      entry('ui-button--ok'),
    ],
  });
  const { page, posts } = await open(d, {
    hash: `#inspect=${story}`,
    answers: {
      'approve-story': {
        ok: true,
        story,
        batch: 'b1',
        approved: [story, `${story}@light`],
        skipped: [],
      },
      check: { ok: true, queued: [story] },
    },
  });
  try {
    const button = page.getByRole('button', { name: 'Approve story · 2 entries' });
    await button.waitFor();
    await button.click();
    await page.getByText(`Approved 2 entries of ${story}.`).waitFor();
    assert.deepEqual(posts.find((p) => p.name === 'approve-story')?.body, {
      project: 'demo',
      story,
    });
    await page.getByRole('button', { name: 'Re-check' }).click();
    await page.getByText('Queued 1 entry').waitFor();
    assert.deepEqual(posts.find((p) => p.name === 'check')?.body, {
      project: 'demo',
      ids: [story],
    });
    assert.equal(
      posts.filter((p) => p.name === 'approve').length,
      0,
      'no single approvals were sent'
    );
  } finally {
    await page.close();
  }
});

test('a link that names the theme opens in it, over the remembered one (the Storybook addon passes its own)', async (t) => {
  if (skip) return t.skip(skip);
  const d = data({ rows: [row('ui-button--ok')], entries: [entry('ui-button--ok')] });
  for (const [mode, stored, toggle] of [
    ['dark', 'light', 'Light theme'],
    ['light', 'dark', 'Dark theme'],
  ]) {
    const { page } = await open(d, {
      hash: `?theme=${mode}`,
      init: `localStorage.setItem('pxsig-dashboard-theme', '${stored}')`,
    });
    try {
      await page.getByRole('button', { name: toggle }).waitFor();
    } finally {
      await page.close();
    }
  }
});

// --- the Overview's columns, its errors card and the stale heatmap ---------------------------------

test('the Overview: open items and stale entries on the left, errors (only with errors) and changed entries per run on the right', async (t) => {
  if (skip) return t.skip(skip);
  const broken = 'ui-card--broken';
  const d = spread(
    data({
      rows: [
        row('ui-button--ok'),
        row(broken, {
          pass: false,
          metrics: null,
          error: 'locator.click: Timeout 5000ms exceeded',
        }),
      ],
      entries: [
        entry('ui-button--ok', [stale]),
        inComponent('Card', broken, [
          { code: 'never-checked', severity: 'error', reason: 'no verdict' },
        ]),
      ],
    })
  );
  d.history = history(3);
  const { page, errors } = await open(d);
  try {
    const box = async (name) => page.getByRole('heading', { name, exact: true }).boundingBox();
    await page.getByRole('heading', { name: 'Errors', exact: true }).waitFor();
    const [items, heat, errs, runs] = [
      await box('Open Items'),
      await box('Stale Entries by Component'),
      await box('Errors'),
      await box('Changed Entries per Run'),
    ];
    assert.ok(
      items.x < errs.x && Math.abs(items.y - errs.y) < 4,
      'open items and errors start one row, side by side'
    );
    assert.ok(
      Math.abs(items.x - heat.x) < 1 && heat.y > items.y,
      'stale entries sit under open items'
    );
    assert.ok(
      Math.abs(errs.x - runs.x) < 1 && runs.y > errs.y,
      'changed entries per run sit under errors'
    );
    const card = page.getByRole('table').filter({ hasText: 'Entry or component' });
    assert.match(
      await card.innerText(),
      /Render error[\s\S]*ui-card--broken[\s\S]*Coverage error[\s\S]*Card/
    );
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
    assert.ok(
      Math.abs(items.x - runs.x) < 1 && runs.y > items.y,
      'one column: the right column follows the left'
    );
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
    const names = await grid
      .getByRole('button')
      .evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
    assert.deepEqual(
      names,
      ['Card: 2 stale of 2 entries', 'Button: 1 stale of 3 entries'],
      'no tile for a component with nothing stale'
    );
    assert.match(
      await grid.innerText(),
      /2 stale of 2/,
      'the count is on the tile, not only its colour'
    );
    // The tile's text, read as one line, is inside its name (WCAG 2.5.3): a space between the two lines.
    const text = await grid
      .getByRole('button')
      .first()
      .evaluate((b) => b.textContent);
    assert.equal(text, 'Card 2 stale of 2');
    await grid.getByRole('button', { name: 'Button: 1 stale of 3 entries' }).click();
    await page.getByRole('button', { name: 'Only Button' }).waitFor();
    await page.getByRole('heading', { name: 'Button', exact: true }).waitFor();
    const table = page.getByRole('table').filter({ hasText: 'Component' }).first();
    assert.doesNotMatch(
      await table.innerText(),
      /Card/,
      'the components table shows only that component'
    );
    // The button that names the filter clears it.
    await page.getByRole('button', { name: 'Only Button' }).click();
    await page.getByRole('cell', { name: 'Card' }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('every page the dashboard can open on has one main region and one level-one heading', async (t) => {
  if (skip) return t.skip(skip);
  const story = 'ui-button--primary';
  const d = data({ rows: [row(story, changed)], entries: [entry(story)] });
  // `data`: answer the report request with it, a status for a failed load, or never (still loading).
  const visit = async (search, answer) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route('**/__pxsig/**', (route) => {
      const name = new URL(route.request().url()).pathname.replace('/__pxsig/', '');
      if (name === 'events')
        return route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: 'retry: 60000\nevent: hello\ndata: {}\n\n',
        });
      if (name === 'data')
        return answer === 'never'
          ? undefined
          : typeof answer === 'number'
            ? route.fulfill({ status: answer, json: { error: 'unreadable' } })
            : route.fulfill({ json: answer });
      if (name === 'projects')
        return route.fulfill({
          json: { projects: [{ name: 'demo', root: '.', entries: 1, integrity: null }] },
        });
      return route.fulfill({ status: 404, json: {} });
    });
    await page.route('**/p/demo/**', (route) => route.fulfill({ status: 404, body: '' }));
    await page.goto(`${base}/report/${search}`);
    return page;
  };
  const cases = [
    ['loading', '', 'never', 'Loading…'],
    ['a failed load', '', 500, 'Report data failed to load'],
    ['the Storybook panel', `?embed=1&story=${story}`, d, story],
    ['the decision window', '?decide=1', d, 'Opened on its own'],
  ];
  for (const [what, search, answer, shows] of cases) {
    const page = await visit(search, answer);
    try {
      await page.getByText(shows).first().waitFor();
      assert.equal(await page.getByRole('main').count(), 1, `${what}: one main region`);
      assert.equal(
        await page.getByRole('heading', { level: 1 }).count(),
        1,
        `${what}: one level-one heading`
      );
    } finally {
      await page.close();
    }
  }
});

// --- the dashboard link ----------------------------------------------------------------------------

test('the dashboard link: its ticket is traded once and leaves the address bar', async (t) => {
  if (skip) return t.skip(skip);
  const story = 'ui-button--primary';
  const d = data({
    rows: [row(story, changed)],
    entries: [entry(story, [{ code: 'changed', severity: 'warn', reason: 'gate failed' }])],
  });
  const { page, posts } = await open(d, { hash: `#inspect=${story}&ticket=${'a'.repeat(64)}` });
  try {
    await page.getByRole('button', { name: 'Approve' }).first().waitFor();
    await page.waitForFunction(() => !location.hash.includes('ticket'));
    assert.deepEqual(
      posts.filter((p) => p.name === 'session').map((p) => p.body),
      [{ ticket: 'a'.repeat(64) }]
    );
    assert.ok(page.url().includes(`inspect=${story}`), 'the rest of the address stays');
    // The link pasted into this tab, which is already on the dashboard: only the fragment changes.
    const traded = page.waitForRequest(
      (r) => r.url().endsWith('/__pxsig/session') && r.postDataJSON()?.ticket === 'b'.repeat(64)
    );
    await page.evaluate(
      (t) => (location.hash = `inspect=ui-button--primary&ticket=${t}`),
      'b'.repeat(64)
    );
    await traded;
    await page.waitForFunction(() => !location.hash.includes('ticket'));
    assert.deepEqual(
      posts.filter((p) => p.name === 'session').map((p) => p.body.ticket.slice(0, 1)),
      ['a', 'b']
    );
  } finally {
    await page.close();
  }
});

test('a decision without the dashboard link says how to get it, under the header', async (t) => {
  if (skip) return t.skip(skip);
  const story = 'ui-button--primary';
  const d = data({
    rows: [row(story, changed)],
    entries: [entry(story, [{ code: 'changed', severity: 'warn', reason: 'gate failed' }])],
  });
  const { page } = await open(d, {
    hash: `#inspect=${story}`,
    answers: {
      approve: {
        status: 403,
        json: { error: 'approving here needs the dashboard link', code: 'needs-dashboard-link' },
      },
    },
  });
  try {
    let alerted = null;
    page.on('dialog', (dl) => ((alerted = dl.message()), dl.dismiss()));
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.getByText('Open the dashboard link from the terminal to approve here').waitFor();
    assert.equal(alerted, null, 'no alert: the line under the header says it');
  } finally {
    await page.close();
  }
});

test('the Storybook panel decides through a small window of the server, which closes when done', async (t) => {
  if (skip) return t.skip(skip);
  const story = 'ui-button--primary';
  const d = data({
    rows: [row(story, changed)],
    entries: [entry(story, [{ code: 'changed', severity: 'warn', reason: 'gate failed' }])],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const posts = [];
  await context.route('**/__pxsig/**', async (route) => {
    const req = route.request();
    const name = new URL(req.url()).pathname.replace('/__pxsig/', '');
    if (name === 'events')
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: 'retry: 60000\nevent: hello\ndata: {}\n\n',
      });
    if (name === 'data') return route.fulfill({ json: d });
    if (name === 'projects')
      return route.fulfill({
        json: { projects: [{ name: 'demo', root: '.', entries: 1, integrity: null }] },
      });
    if (req.method() === 'POST') {
      posts.push({ name, body: req.postDataJSON(), from: req.frame().url() });
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await context.route('**/p/demo/**', (route) => route.fulfill({ status: 404, body: '' }));
  // Storybook, on another site (localhost, another port: as the addon frames it), framing the inspector.
  const storybook = createServer((req, res) =>
    res
      .writeHead(200, { 'content-type': 'text/html' })
      .end(
        `<!doctype html><iframe id="panel" style="width:1200px;height:800px" src="${base}/report/?embed=1&story=${story}"></iframe>`
      )
  );
  await new Promise((ok) => storybook.listen(0, '127.0.0.1', ok));
  const host = await context.newPage();
  try {
    await host.goto(`http://localhost:${storybook.address().port}/`);
    const panel = host.frameLocator('#panel');
    await panel.getByRole('button', { name: 'Approve', exact: true }).waitFor();
    const opened = context.waitForEvent('page');
    await panel.getByRole('button', { name: 'Approve', exact: true }).click();
    const win = await opened;
    assert.match(win.url(), /\/report\/\?decide=1$/);
    await win.waitForEvent('close');
    const decision = posts.find((p) => p.name === 'approve');
    assert.deepEqual(decision?.body, { project: 'demo', id: story });
    assert.match(decision.from, /\?decide=1$/, 'posted by the small window, not by the frame');
  } finally {
    await context.close();
    storybook.close();
  }
});
