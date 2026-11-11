/**
 * masks.test.mjs — masks (lib/capture/masks.mjs): `capture.ignore` / `capture.addIgnore` across the
 * workspace and project layers, `pxsig config`'s list, the order and the pixel count; and in a real
 * Chromium on a stand-in Storybook: a `data-volatile` element masked inside its box only (the box
 * still compared), its record beside the PNG, its text left out of the text record, the a11y pass
 * still run on it, config masks with their layer, and nothing at all without a mask.
 *
 *   node --test packages/pxsig/test/masks.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderStories } from '../src/lib/capture.mjs';
import { configMasks, masksFile, masksFor, unionPx } from '../src/lib/capture/masks.mjs';
import { describeConfig } from '../src/lib/setup.mjs';
import { openProject } from '../src/lib/workspace.mjs';
import { tempDir } from './fixture.mjs';
import { needs } from './server-helpers.mjs';
import { standIn } from './text-helpers.mjs';
/** @import { RenderEntry } from '../src/types/t4.js' */

test('capture.ignore replaces the inherited list, capture.addIgnore adds to it', () => {
  const ws = { source: /** @type {const} */ ('workspace'), value: { capture: { ignore: ['.a'] } } };
  /** @param {unknown} capture */
  const project = (capture) => ({ source: /** @type {const} */ ('project'), value: { capture } });
  assert.deepEqual(configMasks([ws, project({ addIgnore: ['.b'] })]), [
    { selector: '.a', source: 'workspace' },
    { selector: '.b', source: 'project' },
  ]);
  assert.deepEqual(configMasks([ws, project({ ignore: ['.c'] })]), [
    { selector: '.c', source: 'project' },
  ]);
  assert.deepEqual(configMasks([ws, project({ ignore: [], addIgnore: ['.d'] })]), [
    { selector: '.d', source: 'project' },
  ]);
  assert.deepEqual(configMasks([{ source: 'project', value: {} }]), [], 'none by default');
  assert.throws(() => configMasks([project({ ignore: '.a' })]), /capture.ignore must be an array/);
  assert.throws(() => configMasks([project({ addIgnore: [''] })]), /capture.addIgnore/);
});

test('a project names each config selector with its layer (pxsig config)', () => {
  const root = tempDir('masks-ws');
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'packages', 'ui'), { recursive: true });
  writeFileSync(
    join(root, 'pxsig.workspace.json'),
    JSON.stringify({
      projects: { ui: 'packages/ui' },
      defaults: { capture: { ignore: ['[data-build]'] } },
    })
  );
  writeFileSync(
    join(root, 'packages', 'ui', 'pxsig.config.json'),
    JSON.stringify({ capture: { addIgnore: ['.clock'] } })
  );
  const P = openProject({ cwd: join(root, 'packages', 'ui'), env: {} });
  const want = [
    { selector: '[data-build]', source: 'workspace' },
    { selector: '.clock', source: 'project' },
  ];
  assert.deepEqual(P.masks, want);
  assert.deepEqual(describeConfig(P).masks, want);
  writeFileSync(
    join(root, 'packages', 'ui', 'pxsig.config.json'),
    JSON.stringify({ capture: { ignore: [1] } })
  );
  assert.throws(
    () => openProject({ cwd: join(root, 'packages', 'ui'), env: {} }),
    /project "ui": capture.ignore must be an array of selectors/
  );
});

test("an entry's masks: the attribute, the story's, the config's, each selector once", () => {
  const P = { masks: configMasks([{ source: 'project', value: { capture: { ignore: ['.x'] } } }]) };
  assert.deepEqual(masksFor(P, { ignore: ['.live', '.x'] }), [
    { selector: '[data-volatile]', source: 'attribute' },
    { selector: '.live', source: 'story' },
    { selector: '.x', source: 'story' },
  ]);
  assert.deepEqual(masksFor({ config: { capture: { addIgnore: ['.y'] } } }, {}), [
    { selector: '[data-volatile]', source: 'attribute' },
    { selector: '.y', source: 'project' },
  ]);
  assert.deepEqual(masksFor(null, {}), [{ selector: '[data-volatile]', source: 'attribute' }]);
});

test('masked pixels count an overlap once', () => {
  assert.equal(unionPx([]), 0);
  assert.equal(unionPx([[0, 0, 10, 10]]), 100);
  assert.equal(
    unionPx([
      [0, 0, 10, 10],
      [5, 5, 15, 15],
    ]),
    175
  );
  assert.equal(
    unionPx([
      [0, 0, 10, 10],
      [2, 2, 4, 4],
    ]),
    100
  );
});

/** @param {string} text the volatile text */
const clock = (text, width = 80) =>
  `<p style="margin:0">Updated <span data-volatile="relative time" style="display:inline-block;width:${width}px;white-space:nowrap;overflow:hidden">${text}</span></p>
   <p style="margin:0" class="stamp">build 1234</p>`;

test(
  'data-volatile: masked inside its box, recorded, out of the text record, still checked by axe',
  { skip: needs },
  async (t) => {
    /** @type {Record<string, string>} */
    const stories = { 'clock--live': clock('3 minutes ago'), 'plain--x': '<p>Static</p>' };
    const sb = await standIn(stories);
    const pw = await import('playwright');
    const browser = await pw.chromium.launch();
    t.after(async () => {
      await browser.close();
      sb.close();
    });
    const base = tempDir('masks-render', t);
    /** @type {RenderEntry[]} */
    const entries = [{ id: 'clock--live' }, { id: 'plain--x' }];
    /**
     * @param {string} name
     * @param {Record<string, unknown>} [config]
     */
    const render = async (name, config = { text: true }) => {
      const dir = join(base, name);
      const { results } = await renderStories(browser, entries, dir, {
        baseUrl: sb.url,
        viewport: [400, 300],
        settleMs: 0,
        a11y: true,
        project: /** @type {never} */ ({ config }),
      });
      for (const r of results) assert.ok(!r.error, String(r.error));
      return {
        dir,
        results,
        png: (/** @type {string} */ id) => readFileSync(join(dir, `${id}.png`)),
      };
    };
    const a = await render('a');
    const rec = JSON.parse(readFileSync(masksFile(join(a.dir, 'clock--live.png')), 'utf8'));
    assert.equal(rec.v, 1);
    assert.equal(rec.masks.length, 1);
    const [m] = rec.masks;
    assert.equal(m.selector, '[data-volatile="relative time"]');
    assert.equal(m.source, 'attribute');
    assert.equal(m.reason, 'relative time');
    assert.equal(m.count, 1);
    assert.equal(m.px, 80 * 20, 'the box of the element, in whole pixels');
    assert.ok(!JSON.stringify(rec).includes(base), 'no path in the record');
    assert.ok(!existsSync(masksFile(join(a.dir, 'plain--x.png'))), 'no mask, no record');
    const text = JSON.parse(readFileSync(join(a.dir, 'clock--live.boxes.json'), 'utf8'));
    const strings = text.runs.map((/** @type {{ s: string }} */ r) => r.s).join(' ');
    assert.ok(strings.includes('Updated') && !strings.includes('minutes'), strings);
    assert.ok(a.results[0].a11y && !('error' in a.results[0].a11y), 'the a11y pass ran');

    // The volatile text changes: the same pixels. Its box grows: a change.
    stories['clock--live'] = clock('12 minutes ago');
    const b = await render('b');
    assert.ok(a.png('clock--live').equals(b.png('clock--live')), 'masked content is the same');
    stories['clock--live'] = clock('3 minutes ago', 120);
    const c = await render('c');
    assert.ok(!a.png('clock--live').equals(c.png('clock--live')), 'the box is still compared');

    // A config mask, with its layer; a render without one leaves no earlier record behind.
    const d = await render('a', { capture: { ignore: ['.stamp'] } });
    const recD = JSON.parse(readFileSync(masksFile(join(d.dir, 'clock--live.png')), 'utf8'));
    assert.deepEqual(
      recD.masks.map((/** @type {{ selector: string, source: string }} */ x) => [
        x.selector,
        x.source,
      ]),
      [
        ['[data-volatile="relative time"]', 'attribute'],
        ['.stamp', 'project'],
      ]
    );
    stories['clock--live'] = '<p>No longer volatile</p>';
    await render('a');
    assert.ok(!existsSync(masksFile(join(a.dir, 'clock--live.png'))), 'never an earlier record');
  }
);
