/**
 * text-say-helpers.mjs — text labels (`textDiff`) as the engine writes them, for the tests of
 * lib/text/say.mjs and the outputs that use it. No IO.
 */

/** @import { TextDiff } from '../src/types/text.js' */
/** @typedef {Extract<TextDiff, { state: 'compared' }>} Compared */

const counts = { runs: 61, copy: 0, moved: 0, rewrapped: 0, restyled: 0, added: 0, removed: 0 };

/**
 * The #256 case: "1" became "1 " in three tiles, and the unit beside each moved right by the
 * space's advance.
 * @type {Compared}
 */
export const REFLOW = {
  v: 1,
  state: 'compared',
  kind: 'copy-reflow',
  kinds: ['copy', 'moved'],
  counts: { ...counts, copy: 3, moved: 3 },
  outsidePx: 0,
  insidePx: 812,
  elementPx: 0,
  changes: [
    {
      kind: 'copy',
      was: '1',
      now: '1 ',
      whitespace: true,
      key: 'tile-findings',
      path: '0/2/1/#0',
      box: [12, 40, 12.27, 18],
    },
    {
      kind: 'moved',
      s: 'new · of 1',
      dx: 4.2,
      dy: 0,
      pushed: true,
      pushedBy: 0,
      same: 2,
      path: '0/2/1/1/#0',
      box: [28.2, 40, 61, 18],
    },
    {
      kind: 'copy',
      was: '1',
      now: '1 ',
      whitespace: true,
      key: 'tile-edges',
      path: '0/3/1/#0',
      box: [112, 40, 12.27, 18],
    },
    {
      kind: 'copy',
      was: '1',
      now: '1 ',
      whitespace: true,
      key: 'tile-kept',
      path: '0/4/1/#0',
      box: [212, 40, 12.27, 18],
    },
  ],
  changeCount: 4,
};

/**
 * A word changed, a heading restyled, a run added and one removed, with pixels outside text.
 * @type {Compared}
 */
export const MIXED = {
  v: 1,
  state: 'compared',
  kind: 'pixel',
  kinds: ['copy', 'restyled', 'added', 'removed'],
  counts: { ...counts, copy: 1, restyled: 1, added: 1, removed: 1 },
  outsidePx: 1340,
  insidePx: 200,
  elementPx: 40,
  changes: [
    {
      kind: 'copy',
      was: 'Total',
      now: 'Sum',
      facts: ['weight'],
      path: '0/#0',
      box: [0, 0, 30, 18],
    },
    {
      kind: 'restyled',
      s: 'Overview',
      facts: ['size', 'lineHeight'],
      dx: 0,
      dy: 2,
      path: '1/#0',
      box: [0, 20, 80, 24],
    },
    { kind: 'added', s: 'Beta', path: '2/#0', box: [0, 50, 30, 18] },
    { kind: 'removed', s: 'Legacy', path: '3/#0', box: [0, 70, 40, 18] },
  ],
  changeCount: 25,
  truncated: true,
};

/**
 * A compared row whose text did not change.
 * @type {Compared}
 */
export const SAME = {
  v: 1,
  state: 'compared',
  kind: null,
  kinds: [],
  counts,
  outsidePx: 0,
  insidePx: 0,
  elementPx: 0,
  changes: [],
  changeCount: 0,
};

/** @type {TextDiff} */
export const ENV_DIFFERS = { v: 1, state: 'env-differs' };
/** @type {TextDiff} */
export const NO_BASELINE = { v: 1, state: 'no-baseline' };
/** @type {TextDiff} */
export const ERROR = {
  v: 1,
  state: 'error',
  error: "the baseline's text record: not a text record",
};
