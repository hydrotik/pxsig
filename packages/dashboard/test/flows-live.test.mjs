/**
 * The dashboard's live data in a real browser, against a mocked server (see flows-helpers.mjs): a
 * decision's `review` event is applied in place, with no fetch of `/__pxsig/data`; other events
 * fetch it, one fetch at a time with at most one waiting. The page's EventSource is replaced by
 * one the test dispatches events on. Skips when no Chromium is available.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changed, data, entry, row } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

const id = 'ui-button--primary';
const d = data({
  rows: [row(id, changed), row('ui-button--ok')],
  entries: [entry(id, [{ code: 'changed', severity: 'warn', reason: 'gate failed' }])],
});

/** An EventSource the test drives: `window.__es`, which says hello once the page listens. */
function fakeEvents() {
  class Fake extends EventTarget {
    constructor() {
      super();
      window.__es = this;
      setTimeout(() => this.dispatchEvent(new MessageEvent('hello', { data: '{}' })));
    }
    close() {}
  }
  window.EventSource = Fake;
}

/** The entry's card on Review Stories, showing `status`. */
const card = (/** @type {import('playwright').Page} */ page, /** @type {string} */ status) =>
  page.getByRole('button', { name: new RegExp(`^${id} ${status} `) });

/** A page whose `/__pxsig/data` fetches are counted, and answered after `delay` ms. */
async function livePage(delay = 0) {
  const { page } = await open(d, { hash: '#tab=stories', init: fakeEvents });
  const fetches = { started: 0, done: 0 };
  // Registered after open()'s routes, so it answers the data requests from here on.
  await page.route('**/__pxsig/data*', async (route) => {
    fetches.started++;
    await new Promise((ok) => setTimeout(ok, delay));
    await route.fulfill({ json: d });
    fetches.done++;
  });
  await card(page, 'Changed').waitFor();
  // The page's first fetch may have reached this route: count from here.
  await page.waitForTimeout(delay + 100);
  Object.assign(fetches, { started: 0, done: 0 });
  const send = (/** @type {string} */ name, /** @type {object} */ body) =>
    page.evaluate(
      ([n, b]) => window.__es.dispatchEvent(new MessageEvent(n, { data: JSON.stringify(b) })),
      [name, body]
    );
  return { page, fetches, send };
}

test('a decision event updates the page without fetching the data', async (t) => {
  if (skip) return t.skip(skip);
  const { page, fetches, send } = await livePage();
  try {
    await send('review', { project: 'demo', id, entry: { state: 'rejected', at: 'x' } });
    await card(page, 'Rejected').waitFor();
    const approved = { ...d.check.rows[0], approved: { at: 'x', batch: 'b' } };
    const summary = { ...d.check.summary, failed: 0, changed: 0, approved: 1 };
    await send('review', {
      project: 'demo',
      id,
      entry: { state: 'approved', at: 'x', batch: 'b' },
      row: approved,
      summary,
    });
    await card(page, 'Approved').waitFor();
    // Another project's decision is not this page's.
    await send('review', { project: 'other', id, entry: null });
    await page.waitForTimeout(200);
    await card(page, 'Approved').waitFor();
    assert.equal(fetches.started, 0, 'no fetch of /__pxsig/data');
    // An event the page cannot apply fetches the data instead.
    await send('review', { project: 'demo', id, refetch: true });
    await page.waitForTimeout(200);
    assert.equal(fetches.started, 1);
  } finally {
    await page.close();
  }
});

test('a burst of data events fetches once, then once more', async (t) => {
  if (skip) return t.skip(skip);
  const { page, fetches, send } = await livePage(400);
  try {
    for (let i = 0; i < 5; i++) await send('data', { project: 'demo' });
    // A decision while a fetch is under way waits for the next fetch, which follows it.
    await send('review', { project: 'demo', id, entry: { state: 'rejected', at: 'x' } });
    await page.waitForTimeout(1500);
    assert.deepEqual(fetches, { started: 2, done: 2 });
  } finally {
    await page.close();
  }
});
