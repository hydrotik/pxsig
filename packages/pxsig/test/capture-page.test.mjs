// In-page helpers of lib/capture.mjs, in a real Chromium: no code is evaluated from data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyTokenOverrides, injectAxe } from '../src/lib/capture.mjs';

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
const axeSrc = readFileSync(join(dirname(require.resolve('axe-core/package.json')), 'axe.min.js'), 'utf8');
const capture = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'capture.mjs'), 'utf8');

test('capture.mjs evaluates no code from strings', () => {
  assert.doesNotMatch(capture, /new Function\(|\beval\(/);
});

async function withPage(html, fn) {
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    return await fn(page);
  } finally {
    await browser.close();
  }
}

test('token overrides: a literal, a scale and a mix; nothing runs as code', { skip: !pw && 'Playwright\'s Chromium is not installed' }, async () => {
  const html = '<style>:root{--space-md__a1:12px;--color-primary__b2:rgb(0, 0, 255);--radius__c3:4px}</style><div data-theme></div>';
  const out = await withPage(html, async (page) => {
    const n = await page.evaluate(applyTokenOverrides, {
      'space-md': { scale: 2 },
      'color-primary': { mix: 'rgb(255, 0, 0)', amount: 25 },
      radius: '0px',
      unknown: 'x',
    });
    const get = (v) => page.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), v);
    return { n, space: await get('--space-md__a1'), color: await get('--color-primary__b2'), radius: await get('--radius__c3') };
  });
  assert.equal(out.n, 3);
  assert.equal(out.space, '24px');
  assert.equal(out.color, 'color-mix(in srgb, rgb(0, 0, 255) 75%, rgb(255, 0, 0))');
  assert.equal(out.radius, '0px');
});

test('a string value is a literal, even one that looks like code', { skip: !pw && 'Playwright\'s Chromium is not installed' }, async () => {
  const html = '<style>:root{--x__a:1px}</style>';
  const out = await withPage(html, async (page) => {
    await page.evaluate(applyTokenOverrides, { x: 'fn:window.ran = true; return "9px"' });
    return page.evaluate(() => window.ran === true);
  });
  assert.equal(out, false);
});

test('axe is added once per page and runs', { skip: !pw && 'Playwright\'s Chromium is not installed' }, async () => {
  const html = '<main><img src="x.png"></main>';
  const out = await withPage(html, async (page) => {
    await injectAxe(page, axeSrc);
    await injectAxe(page, axeSrc);
    const scripts = await page.evaluate(() => document.querySelectorAll('script').length);
    const ids = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map((v) => v.id));
    return { scripts, ids };
  });
  assert.equal(out.scripts, 1, 'the second call adds nothing');
  assert.ok(out.ids.includes('image-alt'), out.ids.join(', '));
});
