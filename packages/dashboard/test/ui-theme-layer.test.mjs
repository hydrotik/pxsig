/**
 * The theme layer and its declarations agree (ui-tools/theme-layer.mjs, rule L): the committed
 * layer passes, and each way the two can drift apart is found: an export without an entry or an
 * entry without an export, a rule that sets other properties than its entry says, a missing
 * comment, a baseline or crop that is not one, a `where` file that does not use the export. The
 * layer's own rules pass ds-reach.mjs's R, G and F.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readContract } from '../ui-tools/contract.mjs';
import { dsReachFindings } from '../ui-tools/ds-reach.mjs';
import { flatKeys, themeLayerProblems } from '../ui-tools/theme-layer.mjs';

const dashboard = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const contract = new Set(Object.keys(readContract()));

const SHEET = [
  "import { globalStyle, style } from '@vanilla-extract/css';",
  '// L1 title-focus',
  '// Focused by script.',
  "export const titleFocus = style({ outline: 'none' });",
  '// L2 card (an exception)',
  'export const card = style({',
  "  border: '1px solid red',",
  "  selectors: { '&:focus-visible': { boxShadow: '0 0 0 3px red', outline: 'none' } },",
  '});',
  '// L3 menu-current',
  'export const menuCurrent = \'[role="menuitem"][aria-current="page"]\';',
  "globalStyle(menuCurrent, { fontWeight: 600, color: 'red' });",
].join('\n');

/** @param {Partial<Record<string, unknown>>} over */
const entry = (over) => ({
  id: 'L1',
  name: 'title-focus',
  export: 'titleFocus',
  target: { component: 'DialogTitle', where: ['views/V.tsx'] },
  properties: ['outline'],
  changes: 'No focus line.',
  reason: 'A script focus target.',
  decision: 91,
  crops: ['set/N1'],
  baselines: ['shell/a@dark'],
  a11y: 'Not a control.',
  ...over,
});

const ENTRIES = [
  entry({}),
  entry({
    id: 'L2',
    name: 'card',
    export: 'card',
    target: { component: 'story card', where: ['views/V.tsx'] },
    properties: ['border', '&:focus-visible.boxShadow', '&:focus-visible.outline'],
    seeAlso: [94],
  }),
  entry({
    id: 'L3',
    name: 'menu-current',
    export: 'menuCurrent',
    target: { component: 'NavList', where: ['styles/theme-layer.css.ts'] },
    properties: ['fontWeight', 'color'],
    baselines: [],
    noBaseline: 'No screen shows it.',
  }),
];

const VIEW = [
  "import { DialogTitle } from '@ui';",
  "import * as s from '../styles/theme-layer.css';",
  'export const V = () => (',
  '  <>',
  '    <DialogTitle className={s.titleFocus}>x</DialogTitle>',
  '    <button className={s.card} />',
  '  </>',
  ');',
].join('\n');

/** Run `fn` on a source folder holding the layer, `entries` as its JSON and the view. */
function withLayer(
  /** @type {unknown[]} */ entries,
  /** @type {(src: string, baselines: string) => void} */ fn,
  sheet = SHEET
) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pxsig-theme-layer-'));
  try {
    const src = path.join(dir, 'src');
    const baselines = path.join(dir, 'baselines');
    for (const [name, text] of Object.entries({
      'src/styles/theme-layer.css.ts': sheet,
      'src/styles/theme-layer.json': JSON.stringify({ version: 1, entries }),
      'src/views/V.tsx': VIEW,
      'src/views/W.tsx': 'export const W = 1;',
      'baselines/shell/a@dark.psig': '',
    })) {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), text);
    }
    fn(src, baselines);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the committed theme layer agrees with its declarations', () => {
  assert.deepEqual(
    themeLayerProblems(path.join(dashboard, 'src'), path.join(dashboard, '.pxsig', 'baselines')),
    []
  );
});

test('selectors flatten to <selector>.<key>; a fragment is named as it is', () => {
  assert.deepEqual(
    flatKeys("a: 1, 'b-c': x, selectors: { '&:hover': { color: y }, '&:focus': focusOutline }"),
    ['a', 'b-c', '&:hover.color', '&:focus.focusOutline']
  );
});

test('a layer that agrees passes, and its rules pass R, G and F', () =>
  withLayer(ENTRIES, (src, baselines) => {
    assert.deepEqual(themeLayerProblems(src, baselines), []);
    assert.deepEqual(dsReachFindings(src, contract), []);
  }));

test('an export without an entry and an entry without an export are found', () =>
  withLayer([...ENTRIES.slice(1), entry({ id: 'L9', export: 'gone' })], (src, baselines) => {
    const p = themeLayerProblems(src, baselines);
    assert.ok(p.some((x) => /has no export gone/.test(x)));
    assert.ok(p.some((x) => /titleFocus has no entry/.test(x)));
  }));

test('a rule that sets more than its entry says is found', () =>
  withLayer(
    [entry({ properties: ['outline', 'color'] }), ...ENTRIES.slice(1)],
    (src, baselines) => {
      assert.deepEqual(themeLayerProblems(src, baselines), [
        'styles/theme-layer.json L1: "properties" are [outline, color], titleFocus sets [outline]',
      ]);
    }
  ));

test("an export without its entry's comment is found", () =>
  withLayer(
    ENTRIES,
    (src, baselines) => {
      assert.deepEqual(themeLayerProblems(src, baselines), [
        'styles/theme-layer.json L1: titleFocus is not under the comment // L1 title-focus',
      ]);
    },
    SHEET.replace('// L1 title-focus\n', '')
  ));

test('a missing baseline, a bad crop, an empty list without a reason and an unused export', () =>
  withLayer(
    [
      entry({
        baselines: ['shell/missing@dark'],
        crops: ['N1'],
        decision: '91',
        target: { component: 'DialogTitle', where: ['views/W.tsx', 'views/Gone.tsx'] },
      }),
      entry({ ...ENTRIES[1], crops: [] }),
      entry({ ...ENTRIES[2], noBaseline: undefined }),
    ],
    (src, baselines) => {
      const p = themeLayerProblems(src, baselines).join('\n');
      assert.match(p, /L1: "decision" is an integer/);
      assert.match(p, /L1: crop N1 is not <set>\/<item>/);
      assert.match(p, /L1: baseline shell\/missing@dark is not a committed baseline/);
      assert.match(p, /L1: views\/W.tsx does not use titleFocus/);
      assert.match(p, /L1: views\/Gone.tsx does not exist/);
      assert.match(p, /L2: "crops" is empty without "noCrop" saying why/);
      assert.match(p, /L3: "baselines" is empty without "noBaseline" saying why/);
    }
  ));
