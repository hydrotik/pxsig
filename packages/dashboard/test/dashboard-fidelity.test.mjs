/**
 * The region rules `pxsig dashboard check` measures (packages/pxsig/src/dashboard-check/fidelity.mjs),
 * each on a small page in Chromium: what it finds, and what it lets pass. The adapter end to end is
 * dashboard-fidelity-adapter.test.mjs. Skips when no Chromium is available (PXSIG_CHROMIUM names an
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
const { copyStrings } = await import('../../pxsig/src/dashboard-check.mjs');

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
  ':root{--pxsig-color-accent:#1747c2;--pxsig-color-success:#17703a;--pxsig-color-warning:#8a5a00;--pxsig-color-danger:#b3261e}body{margin:0;font:14px sans-serif;background:#fff;color:#1a1a1a}button{block-size:28px;padding:0 8px;font:inherit}';

/** The findings of `rule` on a page holding `html`, at 1280×900. */
async function findings(html, rule, copy = []) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.setContent(`<style>${TOKENS}</style>${html}`);
    const all = await page.evaluate(inspectFidelity, { max: 12, copy });
    return all.filter((f) => f.rule === rule).map((f) => f.text);
  } finally {
    await page.close();
  }
}

test('copyStrings: every string of a copy file, plural forms included', () => {
  assert.deepEqual(
    copyStrings({
      a: 'A {x}',
      b: { c: 'C', d: { one: '{count} entry', other: '{count} entries' } },
    }),
    ['A {x}', 'C', '{count} entry', '{count} entries']
  );
});

test('one-line: a top bar that wraps names the first control of line 2', async (t) => {
  if (skip) return t.skip(skip);
  const links = ['Overview', 'Review Stories', 'Coverage', 'Help'].map(
    (l) => `<a href="#">${l}</a>`
  );
  const bar = (width) =>
    `<nav aria-label="Report sections" class="pxsig-ui-TopNav" style="display:flex;flex-wrap:wrap;gap:12px;width:${width}px">${links.join('')}<button style="block-size:44px">Review</button></nav>`;
  assert.deepEqual(await findings(bar(1000), 'one-line'), []);
  // A tall control beside two lines of links does not join them into one.
  assert.deepEqual(await findings(bar(260), 'one-line'), [
    'the top bar "Report sections" takes 2 lines: <a "Help"> starts line 2',
  ]);
});

test('one-line: a toolbar, and a row of actions, on two lines', async (t) => {
  if (skip) return t.skip(skip);
  const buttons = '<button>Approve all</button><button>Reject all</button><button>Open</button>';
  assert.deepEqual(
    await findings(
      `<div role="toolbar" aria-label="Filters" style="display:flex;flex-wrap:wrap;width:160px">${buttons}</div>`,
      'one-line'
    ),
    ['toolbar 1 "Filters" takes 2 lines: <button "Reject all"> starts line 2']
  );
  const [row] = await findings(
    `<section><span style="display:flex;flex-wrap:wrap;gap:8px;width:200px">${buttons}</span></section>`,
    'one-line'
  );
  assert.match(
    row,
    /^the actions <button "Approve all">.*takes 2 lines: <button "Open"> starts line 2$/
  );
  // Stat tiles that are buttons wrap as a grid of figures: not a row of actions.
  const tiles = '<button style="block-size:64px;width:200px">Changed 2</button>'.repeat(3);
  assert.deepEqual(
    await findings(
      `<div style="display:flex;flex-wrap:wrap;width:300px">${tiles}</div>`,
      'one-line'
    ),
    []
  );
});

test('size: controls on one line differ in height; a link drawn as text is not a control', async (t) => {
  if (skip) return t.skip(skip);
  assert.deepEqual(
    await findings(
      '<div role="toolbar" style="display:flex;align-items:center"><button>Find</button><button style="block-size:32px">Clear</button></div>',
      'size'
    ),
    ['toolbar 1: controls differ in height: <button "Find"> 28px, <button "Clear"> 32px']
  );
  assert.deepEqual(
    await findings(
      '<div style="display:flex;align-items:center;gap:8px"><a href="#">Baseline render</a><button>Copy path</button></div>',
      'size'
    ),
    []
  );
});

test("size: a table's actions are the page's small size, and one height", async (t) => {
  if (skip) return t.skip(skip);
  const toolbar =
    '<div role="toolbar" style="display:flex"><button>Find</button><button>Clear</button></div>';
  const table = (a, b) =>
    `<table><thead><tr><th>Item</th><th>Action</th></tr></thead><tbody><tr><td>Changed</td><td><button style="block-size:${a}px">Review</button></td></tr><tr><td>New</td><td><button style="block-size:${b}px">View</button></td></tr></tbody></table>`;
  assert.deepEqual(await findings(toolbar + table(28, 28), 'size'), []);
  assert.deepEqual(await findings(toolbar + table(32, 32), 'size'), [
    'table 1 "Item": <button "Review"> is 32px tall, above the page\'s small size (28px, its smallest control outside the tables): a table\'s actions are small',
  ]);
  // With no other control on the page, only the table's own heights are compared.
  assert.deepEqual(await findings(table(28, 32), 'size'), [
    'table 1 "Item": its controls differ in height: <button "Review"> 28px, <button "View"> 32px',
  ]);
});

test("casing: a header drawn in another case, or the copy's text re-cased", async (t) => {
  if (skip) return t.skip(skip);
  // A string that is only a placeholder matches any text: it does not hide a re-cased one.
  const copy = ['Open Items', 'Changed', 'Last check {date}', '{name}'];
  assert.deepEqual(
    await findings(
      '<table><tr><th style="text-transform:uppercase">Changed</th><th>Count</th></tr></table>',
      'casing',
      copy
    ),
    [
      '<th "Changed"> is drawn uppercase (text-transform on <th "Changed">): its case is the copy\'s',
    ]
  );
  assert.deepEqual(await findings('<h3>OPEN ITEMS</h3><h3>Last check today</h3>', 'casing', copy), [
    '<h3 "OPEN ITEMS"> has the copy\'s text in another case',
  ]);
  // A stat label is the contract's micro label.
  assert.deepEqual(
    await findings(
      '<section class="pxsig-ui-StatGroup"><div><span style="text-transform:uppercase">Changed</span> 2</div></section>',
      'casing',
      copy
    ),
    []
  );
});

test("casing: a badge may be micro caps; its text is still the copy's", async (t) => {
  if (skip) return t.skip(skip);
  const copy = ['Live', 'Pass', 'Story'];
  // Capitals drawn by `text-transform: uppercase` on a badge or a status badge, or inside one.
  assert.deepEqual(
    await findings(
      '<span class="pxsig-ui-Badge" style="text-transform:uppercase">Live</span><span class="pxsig-ui-StatusBadge"><i>✓</i><span style="text-transform:uppercase">Pass</span></span>',
      'casing',
      copy
    ),
    []
  );
  // A badge inside a button is measured on its own: its caps do not count against the button.
  assert.deepEqual(
    await findings(
      '<button>Story <span class="pxsig-ui-Badge" style="text-transform:uppercase">dark</span></button>',
      'casing',
      copy
    ),
    []
  );
  // Any other transform on a badge, the copy re-cased in its text, and caps on its button still fail.
  assert.deepEqual(
    await findings(
      '<span class="pxsig-ui-Badge" style="text-transform:lowercase">Live</span><span class="pxsig-ui-StatusBadge">PASS</span><button style="text-transform:uppercase">Story <span class="pxsig-ui-Badge">dark</span></button>',
      'casing',
      copy
    ),
    [
      '<span "Live"> is drawn lowercase (text-transform on <span "Live">): its case is the copy\'s',
      '<span "PASS"> has the copy\'s text in another case',
      '<button "Story dark"> is drawn uppercase (text-transform on <button "Story dark">): its case is the copy\'s',
    ]
  );
});

test('tone: shown as a border, an edge or a wash fails; as the text colour passes', async (t) => {
  if (skip) return t.skip(skip);
  const badge = (style) =>
    `<span class="pxsig-ui-Badge" style="padding:0 6px;border:1px solid #c8c8c8;${style}">Live</span>`;
  // The plain adapter's badge: the tone in the text, a neutral wash and border.
  assert.deepEqual(await findings(badge('color:#17703a;background:#ececec'), 'tone'), []);
  assert.deepEqual(
    await findings(
      badge(
        'color:#17703a;background:color-mix(in srgb,#17703a 14%,transparent);border-color:color-mix(in srgb,#17703a 40%,transparent)'
      ),
      'tone'
    ),
    [
      'badge <span "Live"> shows its tone as a success background, a success top border, a success right border, a success bottom border, a success left border: the contract shows a tone as the colour of its text',
    ]
  );
  const tile = (style, attrs = '') =>
    `<section class="pxsig-ui-StatGroup" style="display:flex"><div ${attrs} style="padding:12px;border:1px solid #c8c8c8;${style}">Changed <b style="color:#b3261e">2</b></div></section>`;
  assert.deepEqual(await findings(tile(''), 'tone'), []);
  assert.deepEqual(await findings(tile('border-top:2px solid #b3261e'), 'tone'), [
    'stat card <div "Changed 2"> shows its tone as a danger top border: the contract shows a tone as the colour of its value',
  ]);
  const [edge] = await findings(
    `<style>.edge::before{content:"";display:block;block-size:2px;background:#8a5a00}</style>${tile('', 'class="edge"')}`,
    'tone'
  );
  assert.match(edge, /shows its tone as a warning background::before/);
  // A selected filter tile shows that it is selected, not a tone.
  assert.deepEqual(
    await findings(tile('border-color:#1747c2', 'role="button" aria-pressed="true"'), 'tone'),
    []
  );
});

test('opting out, and a modal dialog', async (t) => {
  if (skip) return t.skip(skip);
  assert.deepEqual(
    await findings(
      '<table data-layout-allow="a demo"><tr><th style="text-transform:uppercase">Changed</th></tr></table>',
      'casing',
      ['Changed']
    ),
    []
  );
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.setContent(
      `<style>${TOKENS}</style><h3 style="text-transform:uppercase">Behind</h3><dialog><h2>Inside</h2></dialog>`
    );
    await page.evaluate(() => document.querySelector('dialog')?.showModal());
    assert.deepEqual(await page.evaluate(inspectFidelity, { max: 12, copy: [] }), []);
  } finally {
    await page.close();
  }
});
