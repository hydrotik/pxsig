/**
 * The layout findings `pxsig dashboard check` records (packages/pxsig/src/dashboard-check/layout.mjs),
 * each rule on a small page in Chromium: what it finds, and what it lets pass. Skips when no
 * Chromium is available (PXSIG_CHROMIUM names an executable).
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { noChromium } from './flows-helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../pxsig/package.json'));
const { inspectLayout, pageOverflow } = await import('../../pxsig/src/dashboard-check/layout.mjs');
const { measureLayout } = await import('../../pxsig/src/dashboard-check/capture.mjs');

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

/** The findings of `rule` on a page holding `html` (body margin 0), at 1280×900. */
async function findings(html, rule) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.setContent(`<style>body{margin:0;font:14px sans-serif}</style>${html}`);
    const all = await page.evaluate(inspectLayout, { max: 12 });
    return all.filter((f) => f.rule === rule).map((f) => f.text);
  } finally {
    await page.close();
  }
}

test('overflow: a page wider than the window, at 1280 and at 900', async (t) => {
  if (skip) return t.skip(skip);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.setContent(
      '<style>body{margin:0}</style><main><div style="width:1000px;height:10px">fits at 1280</div></main>'
    );
    assert.deepEqual(await page.evaluate(pageOverflow), [], 'fits at 1280');
    const found = await measureLayout(page);
    assert.equal(found.length, 1);
    assert.match(
      found[0].text,
      /scrolls sideways at 900px wide \(content is 1000px\): <div "fits at 1280">/
    );
    // Wide content inside its own scroller does not make the page scroll.
    await page.setContent(
      '<style>body{margin:0}</style><div style="overflow-x:auto"><div style="width:2000px;height:10px"></div></div>'
    );
    assert.deepEqual(await page.evaluate(pageOverflow), []);
  } finally {
    await page.close();
  }
});

test('clipped: content cut off by overflow hidden; truncation passes with its full text', async (t) => {
  if (skip) return t.skip(skip);
  const cut = await findings(
    '<div aria-label="box" style="width:100px;height:20px;overflow:hidden"><div style="width:300px">x</div></div>',
    'clipped'
  );
  assert.equal(cut.length, 1);
  assert.match(cut[0], /<div "box"> cuts off its content \(200px wide\)/);
  const ellipsis = 'width:60px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis';
  assert.match(
    (await findings(`<p style="${ellipsis}">a long title that does not fit</p>`, 'clipped'))[0],
    /truncated with no title/
  );
  assert.deepEqual(
    await findings(
      `<p title="a long title that does not fit" style="${ellipsis}">a long title that does not fit</p>`,
      'clipped'
    ),
    [],
    'a title holds the full text'
  );
  assert.deepEqual(
    await findings(
      '<div style="width:100px;height:100px;overflow:hidden"><img style="width:400px;height:400px" alt="stage"></div>',
      'clipped'
    ),
    [],
    'media panned inside a frame'
  );
  assert.deepEqual(
    await findings(
      '<div data-layout-allow="a marquee" style="width:100px;height:20px;overflow:hidden"><div style="width:300px">x</div></div>',
      'clipped'
    ),
    [],
    'opted out'
  );
});

test('controls: one height and one bottom edge per line of a toolbar', async (t) => {
  if (skip) return t.skip(skip);
  const row = (a, b) =>
    `<div role="toolbar" aria-label="Review" style="display:flex;align-items:flex-start;gap:8px"><button style="height:${a}px">Reject</button><button style="height:${b}px">Approve</button></div>`;
  assert.deepEqual(await findings(row(28, 28), 'controls'), []);
  const bad = await findings(row(28, 32), 'controls');
  assert.equal(bad.length, 2);
  assert.match(
    bad[0],
    /toolbar 1 "Review": controls differ in height: <button "Reject"> 28px, <button "Approve"> 32px/
  );
  assert.match(bad[1], /not on one line \(bottom edges 28px, 32px\)/);
  // Wrapped onto two lines: each line is checked on its own.
  assert.deepEqual(
    await findings(
      '<div role="toolbar" style="display:flex;flex-wrap:wrap;width:120px;gap:4px"><button style="height:28px;width:100px">a</button><button style="height:40px;width:100px">b</button></div>',
      'controls'
    ),
    []
  );
});

test('edge: text and controls keep 2px from a drawn border', async (t) => {
  if (skip) return t.skip(skip);
  const frame = (pad) =>
    `<section style="border:1px solid #888;width:300px;height:80px;padding:${pad}px"><p style="margin:0">Open items</p></section>`;
  assert.deepEqual(await findings(frame(8), 'edge'), []);
  const tight = await findings(frame(0), 'edge');
  assert.ok(
    tight.some((x) => /text "Open items" is 0px from the top border/.test(x)),
    tight.join('\n')
  );
  // A tab spanning its region is part of it.
  assert.deepEqual(
    await findings(
      '<nav style="border-bottom:1px solid #888;width:300px;height:40px;display:flex"><button role="tab" style="height:39px;flex:1;border:0">Overview</button></nav>',
      'edge'
    ),
    []
  );
});

test('overlap: controls drawn over each other, or covered by one', async (t) => {
  if (skip) return t.skip(skip);
  assert.deepEqual(
    await findings(
      '<div style="display:flex;gap:8px"><button>A</button><button>B</button></div>',
      'overlap'
    ),
    []
  );
  const over = await findings(
    '<div style="position:relative;height:40px"><button style="position:absolute;left:0;width:80px">Reject</button><button style="position:absolute;left:40px;width:80px">Approve</button></div>',
    'overlap'
  );
  assert.equal(over.length, 1);
  assert.match(over[0], /<button "Reject"> is covered by <button "Approve">/);
  // Under a dialog's backdrop: not reachable, not reported.
  assert.deepEqual(
    await findings(
      '<button>Behind</button><div style="position:fixed;inset:0;background:rgba(0,0,0,.5)"></div>',
      'overlap'
    ),
    []
  );
});

test('at most `max` findings per rule, and a count of the rest', async (t) => {
  if (skip) return t.skip(skip);
  const page = await browser.newPage();
  try {
    const box =
      '<div style="width:50px;height:20px;overflow:hidden"><div style="width:300px">x</div></div>';
    await page.setContent(box.repeat(5));
    const all = await page.evaluate(inspectLayout, { max: 2 });
    assert.deepEqual(
      all.map((f) => f.text.replace(/^<div "x"> cuts off.*/, 'cut')),
      ['cut', 'cut', '3 more']
    );
  } finally {
    await page.close();
  }
});
