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
import { sarifLog, sarifWrote } from '../src/lib/sarif.mjs';
import { blockedFixes, blockedReasons, maskChange } from '../src/lib/mask-words.mjs';
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
      'page--all: masks cover 88% of the capture, over 50%; a mask covers the story root: #root: no approval passes it; make the masks smaller; mask the value, not the story root',
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
    'masks cover 88% of the capture, over 50%: no approval passes this entry; make the masks smaller; flag it for a person',
    'a mask covers the story root: #root: no approval passes this entry; mask the value, not the story root; flag it for a person',
  ]);
  assert.deepEqual(maskDetail(card).maskWarnings, [
    'the masks cover 30% of the capture together, over 25%: changes under them are not compared',
  ]);
});

// Owner decision on masks together: the line counts entries as the log has them, not masks on
// their own (masksLarge), and the masks findings are never counted as a11y violations.
test('check --sarif: the line counts entries over 25% together, one per entry', () => {
  const two = /** @type {CheckRow} */ (
    /** @type {unknown} */ ({
      id: 'chart--pair',
      mode: null,
      pass: true,
      masksCoverage: 0.3,
      masks: [
        { selector: '.a', source: 'story', area: 0.15 },
        { selector: '.b', source: 'story', area: 0.15 },
      ],
    })
  );
  // Before: masksLarge counted, so 1 large mask and the other result read as an a11y violation.
  const one = /** @type {CheckRow} */ (
    /** @type {unknown} */ ({
      id: 'chart--one',
      mode: null,
      pass: true,
      masksCoverage: 0.45,
      masks: [
        { selector: '.big', source: 'story', area: 0.3 },
        { selector: '.small', source: 'story', area: 0.15 },
      ],
      masksLarge: [{ selector: '.big', source: 'story', area: 0.3 }],
    })
  );
  assert.equal(
    sarifWrote(sarifLog([two, one], { masks: true }), 'out.sarif'),
    '[check] wrote 0 new a11y violations, 2 entries with large masks to out.sarif (SARIF)'
  );
  assert.equal(
    sarifWrote(sarifLog(rows, { masks: true }), 'out.sarif'),
    '[check] wrote 0 new a11y violations, 1 entry over the mask limits, 1 entry with masks changed, 1 entry with large masks to out.sarif (SARIF)'
  );
});

// Try-store finding: every block ended "until the masks are smaller", which says nothing to do for
// a data-volatile with no reason or on a container. Each cause now says its own fix, once.
test('a block says what to do about its own cause, each fix once', () => {
  const problem = /** @type {CheckRow} */ (
    /** @type {unknown} */ ({
      id: 'row--x',
      mode: null,
      pass: false,
      reasons: [
        'mask needs a reason: span[data-volatile]',
        'mask on a container: div[data-volatile="a"]: element children div',
        'mask on a container: p[data-volatile="b"]: element children svg',
      ],
      masks: [],
      masksBlocked: {
        problems: [{ kind: 'reason' }, { kind: 'container' }, { kind: 'container' }],
      },
    })
  );
  assert.deepEqual(blockedFixes(problem), [
    'put data-volatile on the element that shows the value (a leaf)',
    'give data-volatile a reason, e.g. data-volatile="relative time"',
  ]);
  assert.deepEqual(maskDetail(problem).maskWarnings?.slice(0, 2), [
    'mask needs a reason: span[data-volatile]: no approval passes this entry; give data-volatile a reason, e.g. data-volatile="relative time"; flag it for a person',
    'mask on a container: div[data-volatile="a"]: element children div: no approval passes this entry; put data-volatile on the element that shows the value (a leaf); flag it for a person',
  ]);
});
