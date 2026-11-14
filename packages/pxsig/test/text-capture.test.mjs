/**
 * text-capture.test.mjs — the text record (lib/capture/boxes.mjs) in a real Chromium: what is
 * recorded and what is left out (wrapped text, SVG text, shadow roots, an iframe, sr-only text, a
 * masked selector, form fields, a canvas, ::before content, a late font, clipped text, text under a
 * dialog), painted element boxes, unique keys; and in a render (lib/capture/render.mjs): the record
 * beside the PNG, the same PNG with text on and off, the off switches, and the same record on
 * every run.
 *
 *   node --test packages/pxsig/test/text-capture.test.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { collectBoxes, MAX_RECORDED } from '../src/lib/capture/boxes.mjs';
import { CHROMIUM_ARGS } from '../src/lib/capture/browser.mjs';
import { readText } from '../src/lib/text/config.mjs';
import { tempDir } from './fixture.mjs';
import { needs } from './server-helpers.mjs';
import { renderOn, standIn } from './text-helpers.mjs';
/** @import { Page } from 'playwright' */
/** @import { TextRecord } from '../src/types/text.js' */

/**
 * Collect the record of `html` (the body), with the capture root `root`.
 * @param {string} html
 * @param {{ root?: string | null, ignore?: string[], before?: (page: Page) => Promise<void> }} [o]
 * @returns {Promise<TextRecord>}
 */
async function record(html, { root = '#root', ignore = [], before } = {}) {
  const pw = await import('playwright');
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    if (before) await before(page);
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:16px/20px sans-serif}</style></head><body>${html}</body></html>`,
      { waitUntil: before ? 'domcontentloaded' : 'load' }
    );
    const r = await page.evaluate(collectBoxes, { root, ignore, max: MAX_RECORDED });
    if ('error' in r) throw new Error(r.error);
    return r;
  } finally {
    await browser.close();
  }
}

const strings = (/** @type {TextRecord} */ r) => r.runs.map((x) => x.s);

test(
  'plain and wrapped text: one box per line, in the frame, with its font facts',
  { skip: needs },
  async () => {
    const r = await record(
      '<div id="root" style="width:120px;padding:4px"><p style="margin:0">Hello</p><p style="margin:0;font-weight:700">one two three four five six</p></div>'
    );
    assert.deepEqual(strings(r), ['Hello', 'one two three four five six']);
    assert.equal(r.v, 1);
    assert.deepEqual(r.frame, { w: 128, h: r.frame.h });
    const [hello, long] = r.runs;
    assert.equal(hello.boxes.length, 1);
    assert.equal(hello.boxes[0][0], 4, 'relative to the frame');
    assert.ok(long.boxes.length >= 2, 'a wrapped run has a box per line');
    assert.ok(long.boxes[1][1] > long.boxes[0][1]);
    assert.equal(hello.path, '0/#0');
    assert.equal(r.styles[hello.st].size, 16);
    assert.equal(r.styles[long.st].weight, 700);
    assert.equal(r.styles[hello.st].loaded, true);
    assert.equal(r.truncated, false);
  }
);

test(
  'SVG text and open shadow roots are recorded; closed ones and iframes are counted',
  { skip: needs },
  async () => {
    const r = await record(
      `<div id="root"><svg width="100" height="30"><text x="2" y="20">chart</text></svg>
     <x-open></x-open><x-closed></x-closed><iframe srcdoc="<p>inside</p>"></iframe></div>
     <script>
       customElements.define('x-open', class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: 'open' }).innerHTML = '<span>shadow</span>'; } });
       customElements.define('x-closed', class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: 'closed' }).innerHTML = '<span>hidden away</span>'; } });
     </script>`
    );
    assert.deepEqual(strings(r), ['chart', 'shadow']);
    assert.ok(r.runs[1].path.includes('/^/'), r.runs[1].path);
    assert.equal(r.skipped.closedShadow, 1);
    assert.equal(r.skipped.iframes, 1);
    assert.ok(
      r.elements.some((e) => e.tag === 'svg'),
      'an svg is a painted box'
    );
  }
);

test(
  'never recorded: form fields, sr-only, hidden, masked, ::before and canvas text',
  { skip: needs },
  async () => {
    const r = await record(
      `<style>.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
      .mark::before{content:'before'}</style>
     <div id="root">
       <input value="secret-value"><textarea>typed-secret</textarea>
       <select><option>chosen</option></select><div contenteditable>edited-secret</div>
       <span class="sr">screen reader only</span><span style="visibility:hidden">invisible</span>
       <span style="opacity:0">transparent</span><span class="live">masked</span>
       <span class="mark">kept</span><canvas width="20" height="20">fallback</canvas>
     </div>`,
      { ignore: ['.live'] }
    );
    assert.deepEqual(strings(r), ['kept']);
    const json = JSON.stringify(r);
    for (const secret of ['secret-value', 'typed-secret', 'chosen', 'edited-secret'])
      assert.ok(!json.includes(secret), secret);
    assert.ok(r.skipped.fields >= 3, JSON.stringify(r.skipped));
    assert.equal(r.skipped.ignored, 1);
    assert.ok(r.skipped.hidden >= 2, JSON.stringify(r.skipped));
    assert.ok(r.elements.some((e) => e.tag === 'canvas'));
  }
);

test(
  'clipped text is clipped or dropped; an absolute box escapes a static ancestor',
  { skip: needs },
  async () => {
    const r = await record(
      `<div id="root" style="width:300px;height:200px">
       <div style="width:60px;height:20px;overflow:hidden;white-space:nowrap">a long clipped line of text</div>
       <div style="height:20px;overflow:hidden"><div style="height:20px"></div><span>below the fold</span></div>
       <div style="position:relative"><div style="overflow:hidden;height:10px"><span style="position:absolute;top:30px">escapes</span></div></div>
     </div>`
    );
    assert.deepEqual(strings(r), ['a long clipped line of text', 'escapes']);
    assert.equal(r.runs[0].boxes[0][2], 60, 'clipped to its overflow ancestor');
    assert.equal(r.skipped.clipped, 1);
  }
);

test('text under an open dialog it is not part of is not recorded', { skip: needs }, async () => {
  const r = await record(
    `<div id="root" style="width:400px;height:300px;position:relative">
       <p style="margin:0;position:absolute;top:100px;left:100px">behind</p>
       <p style="margin:0">beside</p>
       <div role="dialog" style="position:absolute;top:80px;left:80px;width:200px;height:100px;background:#fff">
         <p style="margin:0">in the dialog</p></div>
     </div>`
  );
  assert.deepEqual(strings(r), ['beside', 'in the dialog']);
  assert.equal(r.skipped.covered, 1);
});

test('painted element boxes and unique keys', { skip: needs }, async () => {
  const r = await record(
    `<div id="root"><div id="app">
       <div data-testid="tile" style="border:1px solid #888;width:80px"><span>1 </span><span>new</span></div>
       <div data-testid="pill" style="background:#eee;width:60px">Pill</div>
       <div style="background:transparent;border:0 solid red">plain</div><p>more</p>
     </div></div>`
  );
  const byS = Object.fromEntries(r.runs.map((x) => [x.s, x]));
  assert.equal(byS['1 '].key, undefined, 'a key two runs share is dropped');
  assert.equal(byS.new.key, undefined);
  assert.equal(byS.Pill.key, 'pill');
  assert.equal(byS.plain.key, undefined, 'the app id is shared by two runs');
  assert.equal(byS.more.key, undefined);
  assert.deepEqual(
    r.elements.map((e) => e.tag),
    ['div', 'div'],
    'the bordered tile and the filled pill; a transparent box is not painted'
  );
  assert.equal(r.elements[0].box[2], 82, 'the border box');
});

test('a late font reads loaded: false', { skip: needs }, async () => {
  const r = await record(
    `<style>@font-face{font-family:Late;src:url(http://late.invalid/late.woff2)}</style><div id="root"><span style="font-family:Late, sans-serif">late</span></div>`,
    {
      // The font's request is never answered: it is still loading at capture.
      before: async (page) => {
        await page.route('http://late.invalid/**', () => {});
      },
    }
  );
  assert.deepEqual(strings(r), ['late']);
  assert.equal(r.styles[r.runs[0].st].loaded, false);
});

test('the text settings: off switches, the default, a bad value', () => {
  assert.equal(readText(true, {}).on, true);
  assert.deepEqual(readText({ ignore: ['.x'] }, {}), {
    on: true,
    off: null,
    ignore: ['.x'],
    problems: [],
    movePx: 0.5,
    edgePx: 2,
    noisePx: 0,
  });
  assert.equal(readText(false, {}).off, 'text: false');
  assert.equal(readText('off', {}).off, 'text: false');
  assert.equal(readText(true, { PXSIG_TEXT: 'off' }).off, 'PXSIG_TEXT=off');
  assert.equal(readText(true, { PXSIG_TEXT: 'FALSE' }).off, 'PXSIG_TEXT=off');
  assert.equal(readText(true, { PXSIG_TEXT: 'on' }).on, true);
  assert.equal(readText(3, {}).on, false);
  assert.equal(readText({ ignore: '.x' }, {}).on, false, 'an ignore list it cannot read');
  const later = readText({ fontPx: 1 }, {});
  assert.equal(later.on, true);
  assert.match(later.problems[0], /text\.fontPx is not a text setting/);
});

/** sha256 of a file. */
const sha = (/** @type {string} */ f) => createHash('sha256').update(readFileSync(f)).digest('hex');

test(
  'a render writes its text record beside the PNG; the PNG is the same with text off',
  { skip: needs },
  async (t) => {
    const pw = await import('playwright');
    const sb = await standIn({
      'text--story':
        '<p>1 <b>new</b> · of 9 analysed</p><div style="border:1px solid #888">Card</div>',
    });
    // Two renders are compared byte for byte, so both must take one raster path: pxsig's own text
    // switches, and no GPU process. On a macOS runner Chromium can rasterise through the GPU
    // process and fall back to software when that process is lost, which redraws text with other
    // antialiasing bytes between one render and the next; with the GPU off there is nothing to
    // fall back from. Text capture never touches the raster path, so this hides nothing it does.
    const browser = await pw.chromium.launch({ args: [...CHROMIUM_ARGS, '--disable-gpu'] });
    t.after(async () => {
      await browser.close();
      sb.close();
    });
    const entries = [{ id: 'text--story' }];
    const on = tempDir('text-on', t);
    const off = tempDir('text-off', t);
    const [r] = await renderOn(browser, sb.url, entries, on, { text: true });
    await renderOn(browser, sb.url, entries, off, { text: false });
    assert.deepEqual(readdirSync(on).sort(), ['text--story.boxes.json', 'text--story.png']);
    assert.deepEqual(readdirSync(off), ['text--story.png']);
    assert.equal(
      sha(join(on, 'text--story.png')),
      sha(join(off, 'text--story.png')),
      'reading changes no pixel'
    );
    const rec = JSON.parse(readFileSync(join(on, 'text--story.boxes.json'), 'utf8'));
    assert.deepEqual(
      rec.runs.map((/** @type {{ s: string }} */ x) => x.s),
      ['1 ', 'new', ' · of 9 analysed', 'Card']
    );
    assert.ok(r.text && 'runs' in r.text && r.text.runs === 4, JSON.stringify(r.text));
    // Three renders, one record: byte for byte.
    const again = tempDir('text-again', t);
    const third = tempDir('text-third', t);
    await renderOn(browser, sb.url, entries, again, { text: true });
    await renderOn(browser, sb.url, entries, third, { text: true });
    const want = sha(join(on, 'text--story.boxes.json'));
    assert.equal(sha(join(again, 'text--story.boxes.json')), want);
    assert.equal(sha(join(third, 'text--story.boxes.json')), want);
    // An earlier record never stays beside a render made with text off, or with the entry's off.
    writeFileSync(join(on, 'text--story.boxes.json'), '{}');
    await renderOn(browser, sb.url, [{ id: 'text--story', text: false }], on, { text: true });
    assert.equal(existsSync(join(on, 'text--story.boxes.json')), false);
  }
);
