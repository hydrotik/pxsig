/**
 * React renders per step, in a real browser against a mocked server (see flows-helpers.mjs and
 * renders-harness.mjs): the page's mount, the Review section, opening the inspector, the next
 * entry (J), fit (F) and closing. Each step's count of components rendered has a ceiling, so the
 * counts can only go down; lower a ceiling when a change brings its step under it.
 * Each step's counts are printed; PXSIG_RENDERS_REPORT=1 adds the top renderers. The ceilings hold
 * for the default (plain) adapter only: another adapter (PXSIG_FLOWS_ADAPTER) is measured, not held.
 *
 * The page is 1920 CSS px wide, so every section link fits in the top bar with any machine's
 * fonts. At 1280 px a wider fallback font (Linux's, where the plain adapter's system font is
 * another) moves links into the More menu, and the mount renders 120 components instead of 83:
 * the bar's fit re-renders the list and the menu's links mount. From 1600 px the counts are the
 * same with every font tried (the system font, Verdana, Courier New, Times New Roman).
 * Skips when no Chromium is available.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setupFlows, skip, open } from './flows-helpers.mjs';
import { HOOK, measure, measureMount } from './renders-harness.mjs';
import { demo } from './renders-demo.mjs';

setupFlows();

/** Wide enough for every section link with any font (above). */
const WIDTH = 1920;

/**
 * Components rendered per step, at most (plain adapter). Measured: mount 83, review 592, open 273,
 * next 273, fit 6, close 2. Opening and the next entry wait on image loads, and a slower machine
 * can split their commits differently, so those two hold one inspector render (about 50) of room.
 */
const CEILINGS = {
  mount: 83,
  review: 592,
  open: 325,
  next: 325,
  fit: 6,
  close: 2,
};

const approving = { allowed: true, folder: 'demo', command: 'pxsig serve --link' };

test('renders per step stay under their ceilings', async (t) => {
  if (skip) return t.skip(skip);
  const { page, errors } = await open(demo(), {
    approving,
    images: true,
    init: HOOK,
    width: WIDTH,
  });
  try {
    const steps = {};
    steps.mount = await measureMount(page);
    steps.review = await measure(page, () =>
      page.evaluate(() => {
        location.hash = 'stories';
      })
    );
    steps.open = await measure(page, async () => {
      await page.locator('button[data-status="changed"]').first().click();
      await page.getByRole('dialog').waitFor();
    });
    steps.next = await measure(page, () => page.keyboard.press('j'));
    steps.fit = await measure(page, () => page.keyboard.press('f'));
    steps.close = await measure(page, async () => {
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
    });
    // Every step's counts, before any assertion: a failure on one machine shows them all.
    for (const [name, s] of Object.entries(steps))
      t.diagnostic(
        `${name}: ${s.commits} commits, ${s.rendered} rendered, ${s.mounted} mounted` +
          (process.env.PXSIG_RENDERS_REPORT === '1'
            ? `; ${s.top.map(([n, c]) => `${n} ${c}`).join(', ')}`
            : '')
      );
    assert.deepEqual(errors, []);
    if (process.env.PXSIG_FLOWS_ADAPTER) return;
    const over = Object.entries(steps)
      .filter(([name, s]) => s.rendered > CEILINGS[name])
      .map(
        ([name, s]) =>
          `${name}: ${s.rendered} components rendered, above the ceiling of ${CEILINGS[name]}`
      );
    assert.deepEqual(over, []);
  } finally {
    await page.close();
  }
});
