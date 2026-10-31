/**
 * The dashboard's top bar and Overview in a real browser, against a mocked server (see
 * flows-helpers.mjs): the title, versions and modes, the Overview's columns and errors card, and
 * the stale heatmap. Skips when no Chromium is available (PXSIG_CHROMIUM names an executable).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { data, entry, history, inComponent, row, spread, stale } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

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
      // The top bar's heading: the loading page has its own (read, not drawn) until the data is in.
      const h1 = page.locator('nav').getByRole('heading', { level: 1 });
      await h1.waitFor();
      assert.equal(await h1.innerText(), 'pxsig • demo', 'no label: the project name, as before');
      assert.equal(await page.title(), 'pxsig • demo', 'the browser tab names it too');
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
      // The top bar's heading: the loading page has its own (read, not drawn) until the data is in.
      const h1 = page.locator('nav').getByRole('heading', { level: 1 });
      await h1.waitFor();
      assert.equal(await h1.innerText(), 'pxsig • Hydrotik');
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
    // A workspace label names the application, over the project's own label.
    const { page, errors } = await open({ ...labelled, scope: 'hydrotik ds' });
    try {
      const h1 = page.locator('nav').getByRole('heading', { level: 1 });
      await h1.waitFor();
      assert.equal(await h1.innerText(), 'pxsig • hydrotik ds');
      assert.equal(await page.title(), 'pxsig • hydrotik ds');
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
