/**
 * The `tone` region rule (packages/pxsig/src/dashboard-check/fidelity.mjs) on a stat card's start
 * edge, since contract 1.8.0: an edge in the tone its value is drawn in passes; an edge in another
 * tone, an edge with a neutral value, another side's border or a wash fails. The rest of the rule is
 * dashboard-fidelity.test.mjs. Skips when no Chromium is available (PXSIG_CHROMIUM names an
 * executable).
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { noChromium } from './flows-helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../pxsig/package.json'));
const { inspectFidelity } = await import('../../pxsig/src/dashboard-check/fidelity.mjs');

let browser = null;
let skip = false;
before(async () => {
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch(
      process.env.PXSIG_CHROMIUM ? { executablePath: process.env.PXSIG_CHROMIUM } : {}
    );
  } catch (e) {
    skip = noChromium(e);
  }
});
after(async () => {
  await browser?.close();
});

/** The tone colours as the runtime declares them, and a light page. */
const TOKENS =
  ':root{--pxsig-color-accent:#1747c2;--pxsig-color-success:#17703a;--pxsig-color-warning:#8a5a00;--pxsig-color-danger:#b3261e}body{margin:0;font:14px sans-serif;background:#fff;color:#1a1a1a}';

/** The `tone` findings on a page holding `html`, at 1280×900. */
async function tone(html) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.setContent(`<style>${TOKENS}</style>${html}`);
    const all = await page.evaluate(inspectFidelity, { max: 12, copy: [] });
    return all.filter((f) => f.rule === 'tone').map((f) => f.text);
  } finally {
    await page.close();
  }
}

/** A stat group of one tile, its value in `value`, the tile styled `style`. */
const tile = (style, value = '#17703a', dir = 'ltr') =>
  `<style>.t::before{content:none}</style><section class="pxsig-ui-StatGroup" dir="${dir}" style="display:flex"><div class="t" style="padding:12px;border:1px solid #c8c8c8;${style}"><span style="color:#5f5f5f">PASSED</span> <b style="color:${value}">12</b></div></section>`;

test('tone: a stat card may have a start edge in its value tone', async (t) => {
  if (skip) return t.skip(skip);
  // As the reference adapter draws it: the StatPanel's 2px accent edge, the value in the tone.
  assert.deepEqual(await tone(tile('border-inline-start:2px solid #17703a')), []);
  assert.deepEqual(await tone(tile('border-left:2px solid #b3261e', '#b3261e')), []);
  // The start side follows the direction: on the right, right to left.
  assert.deepEqual(await tone(tile('border-inline-start:2px solid #8a5a00', '#8a5a00', 'rtl')), []);
  // An edge drawn as a thin ::before, in the value's tone.
  assert.deepEqual(
    await tone(
      `<style>.e::before{content:"";position:absolute;inset-block:0;inset-inline-start:0;inline-size:3px;background:#17703a}</style>${tile('position:relative').replace('class="t"', 'class="e"')}`
    ),
    []
  );
});

test('tone: a stat card edge in another tone, beside a neutral value, on another side, or a wash fails', async (t) => {
  if (skip) return t.skip(skip);
  assert.deepEqual(await tone(tile('border-left:2px solid #b3261e')), [
    'stat card <div "PASSED 12"> shows its tone as a danger left border: the contract shows a tone as the colour of its value (and a start edge)',
  ]);
  assert.deepEqual(await tone(tile('border-left:2px solid #17703a', '#1a1a1a')), [
    'stat card <div "PASSED 12"> shows its tone as a success left border: the contract shows a tone as the colour of its value (and a start edge)',
  ]);
  assert.deepEqual(await tone(tile('border-right:2px solid #17703a')), [
    'stat card <div "PASSED 12"> shows its tone as a success right border: the contract shows a tone as the colour of its value (and a start edge)',
  ]);
  assert.deepEqual(
    await tone(
      tile('border-left:2px solid #17703a;background:color-mix(in srgb,#17703a 12%,#fff)')
    ),
    [
      'stat card <div "PASSED 12"> shows its tone as a success background: the contract shows a tone as the colour of its value (and a start edge)',
    ]
  );
  // A ::before wider than an edge is a wash.
  const [wide] = await tone(
    `<style>.e::before{content:"";position:absolute;inset:0;background:color-mix(in srgb,#17703a 12%,transparent)}</style>${tile('position:relative').replace('class="t"', 'class="e"')}`
  );
  assert.match(wide, /shows its tone as a success background::before/);
});
