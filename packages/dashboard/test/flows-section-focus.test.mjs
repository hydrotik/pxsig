/**
 * A section chosen in the top bar (a click, Enter on a link, a link in the More menu) moves focus
 * to the section's heading, so a screen reader announces it and Tab goes on in the section. A
 * load, a deep link and Back / Forward leave focus where it is. In a real browser against a
 * mocked server (see flows-helpers.mjs); PXSIG_FLOWS_ADAPTER runs it on another adapter. Skips
 * when no Chromium is available.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCENARIOS } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

/** @param {import('playwright').Page} page */
const focused = (page) => page.evaluate(() => document.activeElement?.id ?? '');
/** Waits for the frame after a section change, when the heading takes focus. */
const frames = (page) =>
  page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
/** @param {import('playwright').Page} page @param {string} id */
const link = (page, id) => page.locator(`nav a[href="#${id}"]`).first();

test('a section chosen in the bar focuses its heading; a load and Back / Forward do not', async (t) => {
  if (skip) return t.skip(skip);
  const { page, errors } = await open(SCENARIOS.clean(), { hash: '#overview' });
  try {
    await link(page, 'stories').waitFor();
    await frames(page);
    assert.notEqual(await focused(page), 'section-title', 'not on load');

    await link(page, 'stories').click();
    await page.waitForFunction(() => document.activeElement?.id === 'section-title');
    // Tab goes on in the section, not back in the bar.
    await page.keyboard.press('Tab');
    assert.ok(
      await page.evaluate(() => !!document.activeElement?.closest('main')),
      'Tab continues in the section'
    );

    await link(page, 'history').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.id === 'section-title');

    // Back and Forward change the section and leave focus alone.
    await page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement)?.blur());
    await page.goBack();
    await page.waitForFunction(() => location.hash === '#stories');
    await frames(page);
    assert.notEqual(await focused(page), 'section-title', 'not on Back');
    await page.goForward();
    await page.waitForFunction(() => location.hash === '#history');
    await frames(page);
    assert.notEqual(await focused(page), 'section-title', 'not on Forward');

    // The heading is visually hidden: no focus ring or halo shows on it.
    const look = await page.evaluate(() => {
      const h = /** @type {HTMLElement} */ (document.getElementById('section-title'));
      const st = getComputedStyle(h);
      return { clip: st.clipPath, shadow: st.boxShadow, width: h.getBoundingClientRect().width };
    });
    assert.equal(look.clip, 'inset(50%)');
    assert.equal(look.shadow, 'none');
    assert.ok(look.width <= 1);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('a deep link does not focus the heading', async (t) => {
  if (skip) return t.skip(skip);
  const { page } = await open(SCENARIOS.clean(), { hash: '#history' });
  try {
    await link(page, 'history').waitFor();
    await frames(page);
    assert.notEqual(await focused(page), 'section-title');
  } finally {
    await page.close();
  }
});

test('a section chosen in the More menu focuses its heading', async (t) => {
  if (skip) return t.skip(skip);
  const { page, errors } = await open(SCENARIOS.clean(), { hash: '#overview' });
  try {
    await page.setViewportSize({ width: 390, height: 800 });
    const more = page.getByRole('button', { name: 'More sections' });
    await more.waitFor();
    await more.click();
    await page.getByRole('menu').locator('a[href="#history"]').click();
    await page.waitForFunction(() => location.hash === '#history');
    await page.waitForFunction(() => document.activeElement?.id === 'section-title');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
