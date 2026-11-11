/**
 * masks-findings.test.mjs — a row's masks findings where they are reported outside the engine:
 * `check --sarif` (lib/sarif.mjs: the limit as an error, a change and masks over a quarter as
 * warnings), the words (lib/mask-words.mjs) and the tools' brief and sentences (tools/masks.mjs).
 * Mask audit 5 (the 25% warning over all masks together), 13 (a masks change reported) and the
 * SARIF gap (no result for "masks changed"); decision 2 (over 50% or the story root fails).
 *
 *   node --test packages/pxsig/test/masks-findings.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sarifLog } from '../src/lib/sarif.mjs';
import { blockedReasons, maskChange } from '../src/lib/mask-words.mjs';
import { maskBrief, maskDetail } from '../src/tools/masks.mjs';
/** @import { CheckRow } from '../src/types.js' */

const changed = { added: ['.a'], removed: [], grew: ['.b', '.c'], moved: [], count: ['.d'] };
/** check.json rows, as the engine writes their masks fields. */
const rows = /** @type {CheckRow[]} */ (
  /** @type {unknown} */ ([
    {
      id: 'page--all',
      mode: null,
      pass: false,
      reasons: ['masks cover 88% of the capture, over 50%', 'a mask covers the story root: #root'],
      masksCoverage: 0.88,
      masksBlocked: { coverage: 0.88, root: ['#root'] },
    },
    {
      id: 'card--x',
      mode: 'dark',
      pass: false,
      reasons: ['masks changed: 1 added, 2 grew, 1 changed count'],
      masksCoverage: 0.3,
      masksChanged: changed,
    },
    { id: 'clock--live', mode: null, pass: true, masksCoverage: 0.2 },
  ])
);

test('SARIF: the limit is an error, a masks change and masks over 25% together are warnings', () => {
  const log = sarifLog(rows, { masks: true });
  const results = log.runs[0].results.map((r) => [r.ruleId, r.level, r.message.text]);
  assert.deepEqual(results, [
    [
      'pxsig/mask-limit',
      'error',
      'page--all: masks cover 88% of the capture, over 50%; a mask covers the story root: #root: no approval passes it',
    ],
    [
      'pxsig/masks-changed',
      'warning',
      'card--x: masks changed: 1 added (.a); 2 grew (.b, .c); 1 changed count (.d)',
    ],
    [
      'pxsig/large-mask',
      'warning',
      'card--x: masks cover 30% of the capture, which hides most changes under them',
    ],
  ]);
  assert.deepEqual(
    log.runs[0].tool.driver.rules.map((r) => r.id),
    ['pxsig/mask-limit', 'pxsig/masks-changed', 'pxsig/large-mask']
  );
  // `pxsig a11y --sarif` stays a11y only.
  assert.equal(sarifLog(rows).runs[0].results.length, 0);
});

test('the words: a change with its selectors, and the reasons no approval passes', () => {
  assert.equal(maskChange({ moved: ['.x'] }), 'masks changed: 1 moved (.x)');
  assert.deepEqual(blockedReasons(rows[0]), [
    'masks cover 88% of the capture, over 50%',
    'a mask covers the story root: #root',
  ]);
  assert.deepEqual(blockedReasons(rows[1]), []);
});

test('the tools: the brief carries the limit and the share together; the detail says them', () => {
  const [all, card, clock] = /** @type {import('../src/types/t6.js').ReportRow[]} */ (
    /** @type {unknown} */ (rows)
  );
  assert.deepEqual(maskBrief(all), {
    masksBlocked: { coverage: 0.88, root: ['#root'] },
    masksCoverage: 0.88,
  });
  assert.deepEqual(maskBrief(card), { masksChanged: changed, masksCoverage: 0.3 });
  assert.deepEqual(maskBrief(clock), {});
  assert.deepEqual(maskDetail(all).maskWarnings, [
    'masks cover 88% of the capture, over 50%: no approval passes this entry until the masks are smaller; flag it for a person',
    'a mask covers the story root: #root: no approval passes this entry until the masks are smaller; flag it for a person',
  ]);
  assert.deepEqual(maskDetail(card).maskWarnings, [
    'the masks cover 30% of the capture together, over 25%: changes under them are not compared',
  ]);
});
