/**
 * The dashboard's review and repair flows in a real browser, against a mocked server: the build
 * uses the plain example adapter (no design system needed), is served over HTTP like `pxsig
 * serve` serves it, and every /__pxsig/ request is answered by page.route, so nothing here can
 * write a baseline. Skips when no Chromium is available (PXSIG_CHROMIUM names an executable).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changed, data, entry, row } from '../fixtures/scenarios.mjs';
import { setupFlows, browser, skip, base, open } from './flows-helpers.mjs';

setupFlows();

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
  /** @type {[what: string, search: string, answer: unknown, shows: string][]} */
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
