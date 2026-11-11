/**
 * The plain adapter's top bar (adapters/plain/nav.tsx) in a real browser, against a mocked server
 * (flows-helpers.mjs): one line at every width, the links that do not fit in a More menu, Help
 * (`keep`) in the bar, and the menu button pattern from the keyboard. Skips when no Chromium is
 * available (PXSIG_CHROMIUM names an executable).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scenarioData } from '../fixtures/scenarios.mjs';
import { setupFlows, skip, open } from './flows-helpers.mjs';

setupFlows();

/** Another adapter (PXSIG_FLOWS_ADAPTER) draws its own top bar: the live screens cover it. */
const other = process.env.PXSIG_FLOWS_ADAPTER ? 'the plain adapter only' : null;

/** The bar's height, every section link, those in the bar, those in the menu, and whether More shows. */
const bar = (page) =>
  page.locator('nav.plain-nav').evaluate((nav) => {
    const name = (a) => a.firstChild?.textContent ?? '';
    const more = /** @type {HTMLElement} */ (nav.querySelector('.plain-more'));
    return {
      height: nav.getBoundingClientRect().height,
      all: [...nav.querySelectorAll(':scope > ul > li > a')].map(name),
      shown: [...nav.querySelectorAll(':scope > ul > li:not([hidden]) > a')].map(name),
      menu: [...nav.querySelectorAll('[role="menuitem"]')].map(name),
      more: !more.hidden,
    };
  });

test('the top bar is one line at every width: the links that do not fit are under More', async (t) => {
  if (skip || other) return t.skip(skip || other);
  const { page, errors } = await open(scenarioData('several-projects'));
  try {
    const heights = new Set();
    const moved = new Set();
    for (const width of [1600, 1280, 1024, 900, 800]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(50);
      const b = await bar(page);
      heights.add(b.height);
      assert.ok(b.shown.includes('Help'), `${width}px: Help stays in the bar`);
      assert.equal(b.more, b.menu.length > 0, `${width}px: More shows when it holds a link`);
      assert.deepEqual(
        [...b.shown, ...b.menu].sort((x, y) => x.localeCompare(y)),
        [...b.all].sort((x, y) => x.localeCompare(y)),
        `${width}px: every section once, in the bar or the menu`
      );
      moved.add(b.menu.length);
    }
    assert.equal(heights.size, 1, `one height at every width: ${[...heights].join(', ')}`);
    assert.ok(moved.size > 1, 'the menu holds more links as the bar narrows');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('More is a menu button: arrows, Home, End and Escape, focus back on the button', async (t) => {
  if (skip || other) return t.skip(skip || other);
  const { page, errors } = await open(scenarioData('several-projects'));
  try {
    await page.setViewportSize({ width: 800, height: 900 });
    const more = page.getByRole('button', { name: 'More' });
    assert.equal(await more.getAttribute('aria-haspopup'), 'menu');
    assert.equal(await more.getAttribute('aria-expanded'), 'false');
    await more.focus();
    await page.keyboard.press('ArrowDown');
    const menu = page.getByRole('menu', { name: 'More' });
    await menu.waitFor();
    assert.equal(await more.getAttribute('aria-expanded'), 'true');
    const items = menu.getByRole('menuitem');
    const focused = () => page.evaluate(() => document.activeElement?.firstChild?.textContent);
    const names = await items.evaluateAll((all) => all.map((a) => a.firstChild?.textContent));
    // The menu focuses its first item on the frame after it opens.
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem');
    assert.equal(await focused(), names[0], 'ArrowDown opens it on the first item');
    await page.keyboard.press('End');
    assert.equal(await focused(), names.at(-1));
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(), names[0], 'the arrows wrap');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowUp');
    assert.equal(await focused(), names.at(-1));
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    assert.ok(await more.evaluate((b) => b === document.activeElement), 'focus returns to More');
    // Choosing an item goes to its section and closes the menu.
    await more.click();
    const last = items.filter({ hasText: names.at(-1) });
    const href = await last.getAttribute('href');
    await last.click();
    await menu.waitFor({ state: 'hidden' });
    assert.equal(await more.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => location.hash), href);
    // The current section is in the menu: More says so.
    await page.locator('.plain-more > button[data-current]').waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
