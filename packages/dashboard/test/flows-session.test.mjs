/**
 * The review session's summary in a real browser, against a mocked server (see flows-helpers.mjs):
 * a long list of rejected entries keeps its `pxsig check …` command inside the dialog. Skips when
 * no Chromium is available (PXSIG_CHROMIUM names an executable).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scenarioData } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

// What the Copy button puts on the clipboard (headless Chromium has none to read back).
const CLIPBOARD = `Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: (t) => ((window.__copied = t), Promise.resolve()), readText: async () => '' },
});`;

test('the review summary: a long rejected list keeps the command inside the dialog, the title in view, and copies all of it', async (t) => {
  if (skip) return t.skip(skip);
  const d = scenarioData('long-rejections');
  const rejected = Object.keys(d.review).filter((id) => d.review[id].state === 'rejected');
  const command = `pxsig check ${rejected.join(' ')}`;
  const { page, errors } = await open(d, { hash: '#overview', init: CLIPBOARD });
  try {
    // Every entry is decided: the queue opens straight on its summary.
    await page
      .getByRole('button', { name: /^Changed/ })
      .first()
      .click();
    const title = page.getByRole('heading', { name: 'Review complete' });
    await title.waitFor();
    // Focus moves into the dialog on open; let it land (and scroll whatever it scrolls) first.
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const h = [...document.querySelectorAll('h1, h2, h3')].find(
        (e) => e.textContent?.trim() === 'Review complete'
      );
      // The dialog: the popup the title is in (its role, else the nearest box that clips).
      let box = h?.parentElement ?? null;
      const wide = [];
      for (let e = box; e && e !== document.body; e = e.parentElement) {
        if (e.scrollWidth > e.clientWidth + 1)
          wide.push(`${e.tagName} ${e.scrollWidth} > ${e.clientWidth}`);
        if (e.getAttribute('role') === 'dialog' || e.tagName === 'DIALOG') box = e;
      }
      const r = h?.getBoundingClientRect();
      const b = box?.getBoundingClientRect();
      return {
        wide,
        scrollLeft: box?.scrollLeft ?? null,
        titleInside: !!(r && b && r.left >= b.left && r.right <= b.right + 1 && r.top >= b.top),
      };
    });
    assert.deepEqual(m.wide, [], 'nothing from the title up to the page is wider than its box');
    assert.equal(m.scrollLeft, 0, 'the dialog is not scrolled sideways');
    assert.ok(m.titleInside, 'the title is inside the dialog, in view');
    assert.ok(await page.getByText('4 rejected', { exact: true }).isVisible(), 'its label shows');
    await page.getByRole('dialog').getByRole('button', { name: /^Copy/ }).first().click();
    assert.equal(await page.evaluate(() => window.__copied), command, 'the whole command');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
