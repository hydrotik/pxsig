/**
 * The alignment findings `pxsig dashboard check` records (packages/pxsig/src/dashboard-check/alignment.mjs),
 * measured from a screenshot of a small page in Chromium, launched as pxsig captures (grayscale text,
 * no hinting): a dot centred on its label's capitals, a small component on whole pixels, and the
 * cause each finding names. Skips when no Chromium is available (PXSIG_CHROMIUM names an executable).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { noChromium } from './flows-helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../pxsig/package.json'));
const { measureAlignment, inkBand, ALIGN_TOLERANCE } =
  await import('../../pxsig/src/dashboard-check/alignment.mjs');
const { CHROMIUM_ARGS } = await import('../../pxsig/src/lib/capture/browser.mjs');

let browser = null;
let skip = false;
const out = mkdtempSync(path.join(tmpdir(), 'pxsig-alignment-'));
before(async () => {
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({
      args: [...CHROMIUM_ARGS],
      ...(process.env.PXSIG_CHROMIUM ? { executablePath: process.env.PXSIG_CHROMIUM } : {}),
    });
  } catch (e) {
    skip = noChromium(e);
  }
});
after(async () => {
  await browser?.close();
  rmSync(out, { recursive: true, force: true });
});

let n = 0;
/** The alignment findings on a page holding `html` (body margin 0), at 1280×900. */
async function findings(html) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.setContent(
      `<style>body{margin:0;font:12px sans-serif;background:#fff;color:#111}*{box-sizing:border-box}</style>${html}`
    );
    const shot = path.join(out, `${n++}.png`);
    await page.screenshot({ path: shot });
    return await measureAlignment(page, shot, { max: 12 });
  } finally {
    await page.close();
  }
}

/** A pill: a 4px dot and a label, centred in a bar `bar` px tall. */
const pill = (bar, { dot = '', label = 'LIVE' } = {}) =>
  `<div style="display:flex;align-items:center;height:${bar}px;padding:0 8px">` +
  `<span style="display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;border:1px solid #888;border-radius:10px;font-size:9px;line-height:1">` +
  `<span style="width:4px;height:4px;border-radius:2px;background:#111;${dot}"></span>${label}</span></div>`;

test('whole-pixel: a pill centred in an odd space is off whole pixels, and says why', async (t) => {
  if (skip) return t.skip(skip);
  assert.deepEqual(
    (await findings(pill(44))).filter((f) => f.rule === 'whole-pixel'),
    [],
    'even space: on whole pixels'
  );
  const odd = (await findings(pill(43))).filter((f) => f.rule === 'whole-pixel');
  assert.equal(odd.length, 1, JSON.stringify(odd));
  assert.match(odd[0].text, /<span "LIVE"> \(top 11\.5, bottom 31\.5\) is off whole pixels/);
  assert.match(odd[0].text, /centred in an odd space, \(43 − 20\) \/ 2 = 11\.5/);
});

test('whole-pixel: the cause up the tree (an earlier sibling of fractional height), one finding per cause', async (t) => {
  if (skip) return t.skip(skip);
  const found = (
    await findings(
      '<p style="margin:0;font-size:13px;line-height:1.25">Heading</p>' +
        '<div><button style="height:28px;border:1px solid #888">One</button><button style="height:28px;border:1px solid #888">Two</button></div>'
    )
  ).filter((f) => f.rule === 'whole-pixel');
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.match(found[0].text, /<button "One"> \(top 16\.25, bottom 44\.25\), <button "Two">/);
  assert.match(found[0].text, /after <p "Heading">, 16\.25px/);
});

test('whole-pixel: the inline axis is not measured; data-layout-allow opts out', async (t) => {
  if (skip) return t.skip(skip);
  assert.deepEqual(
    await findings(
      '<div style="display:flex;height:20px"><span style="font-size:13px">text of some width</span><span style="width:20px;height:20px;background:#888"></span></div>'
    ),
    []
  );
  assert.deepEqual(
    (await findings(`<div data-layout-allow="test">${pill(43)}</div>`)).filter(
      (f) => f.rule === 'whole-pixel'
    ),
    []
  );
});

test('aligned: a dot on the capitals passes; a dot pushed down names its margin', async (t) => {
  if (skip) return t.skip(skip);
  assert.deepEqual(
    (await findings(pill(44))).filter((f) => f.rule === 'aligned'),
    [],
    'centred'
  );
  const low = (await findings(pill(44, { dot: 'margin-top:4px' }))).filter(
    (f) => f.rule === 'aligned'
  );
  assert.equal(low.length, 1, JSON.stringify(low));
  assert.match(low[0].text, /<span "LIVE">: its dot is 2(\.\d+)?px below the capitals' centre/);
  assert.match(
    low[0].text,
    /the dot's box is centred 2px off the line box: its margin or alignment/
  );
});

test('aligned: mixed case is measured on its capitals only; a label with none is not measured', async (t) => {
  if (skip) return t.skip(skip);
  assert.deepEqual(
    (await findings(pill(44, { label: 'Live' }))).filter((f) => f.rule === 'aligned'),
    []
  );
  assert.deepEqual(
    (await findings(pill(44, { label: 'reflow', dot: 'margin-top:4px' }))).filter(
      (f) => f.rule === 'aligned'
    ),
    []
  );
});

test('aligned: a dot under another layer is not measured', async (t) => {
  if (skip) return t.skip(skip);
  assert.deepEqual(
    await findings(
      `${pill(44, { dot: 'margin-top:4px' })}<div style="position:fixed;inset:0;background:#fff"></div>`
    ),
    []
  );
});

test('inkBand: sub-pixel edges from coverage', () => {
  // One column, rows 0–5: backdrop, half-covered, full, full, quarter-covered, backdrop.
  const shades = [255, 128, 0, 0, 191, 255];
  const data = Buffer.alloc(shades.length * 4);
  shades.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  const band = inkBand({ width: 1, height: shades.length, data }, [[0, 1]], 0, 6, [255, 255, 255]);
  assert.ok(band);
  assert.ok(Math.abs(band.top - 1.5) < 0.01, `top ${band.top}`);
  assert.ok(Math.abs(band.bottom - 4.25) < 0.01, `bottom ${band.bottom}`);
  assert.equal(ALIGN_TOLERANCE, 0.5);
});
