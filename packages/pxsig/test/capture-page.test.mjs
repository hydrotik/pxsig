// In-page helpers of lib/capture.mjs, in a real Chromium: no code is evaluated from data.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyTokenOverrides, injectAxe } from '../src/lib/capture.mjs';
import { skipUnless } from './strict.mjs';
/** @import { Page } from 'playwright' */

const require = createRequire(import.meta.url);
// Playwright and a Chromium it can launch (CI installs the browser after this suite runs).
const pw = await (async () => {
  try {
    const lib = require('playwright');
    const b = await lib.chromium.launch();
    await b.close();
    return lib;
  } catch {
    return null;
  }
})();
const axeSrc = readFileSync(
  join(dirname(require.resolve('axe-core/package.json')), 'axe.min.js'),
  'utf8'
);
const lib = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib');
const capture = ['capture.mjs', ...readdirSync(join(lib, 'capture')).map((f) => `capture/${f}`)]
  .map((f) => readFileSync(join(lib, f), 'utf8'))
  .join('\n');

test('capture.mjs evaluates no code from strings', () => {
  assert.doesNotMatch(capture, /new Function\(|\beval\(/);
});

/**
 * @template T
 * @param {string} html
 * @param {(page: Page) => Promise<T>} fn
 */
async function withPage(html, fn) {
  // Every test that calls this is skipped when Playwright is missing (`pw` null).
  const browser = await /** @type {NonNullable<typeof pw>} */ (pw).chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    return await fn(page);
  } finally {
    await browser.close();
  }
}

test(
  'token overrides: a literal, a scale and a mix; nothing runs as code',
  { skip: skipUnless(pw, "Playwright's Chromium is not installed") },
  async () => {
    const html =
      '<style>:root{--space-md__a1:12px;--color-primary__b2:rgb(0, 0, 255);--radius__c3:4px}</style><div data-theme></div>';
    const out = await withPage(html, async (page) => {
      const n = await page.evaluate(applyTokenOverrides, {
        'space-md': { scale: 2 },
        'color-primary': { mix: 'rgb(255, 0, 0)', amount: 25 },
        radius: '0px',
        unknown: 'x',
      });
      /** @param {string} v */
      const get = (v) =>
        page.evaluate(
          (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
          v
        );
      return {
        n,
        space: await get('--space-md__a1'),
        color: await get('--color-primary__b2'),
        radius: await get('--radius__c3'),
      };
    });
    assert.equal(out.n, 3);
    assert.equal(out.space, '24px');
    assert.equal(out.color, 'color-mix(in srgb, rgb(0, 0, 255) 75%, rgb(255, 0, 0))');
    assert.equal(out.radius, '0px');
  }
);

test(
  'a string value is a literal, even one that looks like code',
  { skip: skipUnless(pw, "Playwright's Chromium is not installed") },
  async () => {
    const html = '<style>:root{--x__a:1px}</style>';
    const out = await withPage(html, async (page) => {
      await page.evaluate(applyTokenOverrides, { x: 'fn:window.ran = true; return "9px"' });
      // What the string would have set, had it run.
      return page.evaluate(() => /** @type {Window & { ran?: boolean }} */ (window).ran === true);
    });
    assert.equal(out, false);
  }
);

test(
  'axe is added once per page and runs',
  { skip: skipUnless(pw, "Playwright's Chromium is not installed") },
  async () => {
    const html = '<main><img src="x.png"></main>';
    const out = await withPage(html, async (page) => {
      await injectAxe(page, axeSrc);
      await injectAxe(page, axeSrc);
      const scripts = await page.evaluate(() => document.querySelectorAll('script').length);
      // injectAxe added axe-core just above.
      const ids = await page.evaluate(async () =>
        (
          await /** @type {NonNullable<Window['axe']>} */ (window.axe).run(document, {
            resultTypes: ['violations'],
          })
        ).violations.map((v) => v.id)
      );
      return { scripts, ids };
    });
    assert.equal(out.scripts, 1, 'the second call adds nothing');
    assert.ok(out.ids.includes('image-alt'), out.ids.join(', '));
  }
);
