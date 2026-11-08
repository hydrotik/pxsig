/// <reference types="node" />
/**
 * text.mjs — the text-label scenarios (scenarios.mjs adds them): rows whose `textDiff` the
 * inspector's header badge and Text section show. A copy change with reflow, modelled on a tile
 * figure that gained a trailing space ("1" → "1 ", so "1new" reads "1 new") and pushed its unit
 * right; a restyle; a pixel change with a text change beside it; and each state that compares
 * nothing (no text record in the baseline, another environment, a record not read, no text
 * changed). Boxes sit inside the sample images (320×200). Fixed values, neutral names.
 */
// scenarios.mjs imports this file; its helpers are read only when a scenario is built.
import { changed, data, entry, row } from './scenarios.mjs';

const issue = [{ code: 'changed', severity: 'warn', reason: 'gate failed' }];
const counts = (/** @type {Record<string, number>} */ c) => ({
  runs: 61,
  copy: 0,
  moved: 0,
  rewrapped: 0,
  restyled: 0,
  added: 0,
  removed: 0,
  ...c,
});

/** Three tile figures, each gaining a trailing space, each pushing its unit 4.2px right. */
const copyReflow = () => ({
  v: 1,
  state: 'compared',
  kind: 'copy-reflow',
  kinds: ['copy', 'moved'],
  counts: counts({ copy: 3, moved: 3 }),
  outsidePx: 0,
  insidePx: 812,
  changes: [
    {
      kind: 'copy',
      was: '1',
      now: '1 ',
      whitespace: true,
      key: 'tile-findings',
      path: '0/2/0/0/#0',
      box: [32, 40, 11.27, 18],
    },
    {
      kind: 'copy',
      was: '12',
      now: '12 ',
      whitespace: true,
      key: 'tile-kept',
      path: '0/2/1/0/#0',
      box: [128, 40, 19.5, 18],
    },
    {
      kind: 'copy',
      was: '0',
      now: '0 ',
      whitespace: true,
      key: 'tile-edges',
      path: '0/2/2/0/#0',
      box: [224, 40, 11.27, 18],
    },
    {
      kind: 'moved',
      s: 'new · of 1',
      dx: 4.2,
      dy: 0,
      pushed: true,
      pushedBy: 0,
      path: '0/2/0/1/#0',
      box: [43.27, 40, 61, 18],
    },
    {
      kind: 'moved',
      s: 'kept',
      dx: 4.2,
      dy: 0,
      pushed: true,
      pushedBy: 1,
      path: '0/2/1/1/#0',
      box: [147.5, 40, 28, 18],
    },
    {
      kind: 'moved',
      s: 'new edges',
      dx: 4.2,
      dy: 0,
      pushed: true,
      pushedBy: 2,
      path: '0/2/2/1/#0',
      box: [235.27, 40, 58, 18],
    },
  ],
  changeCount: 6,
});

/** A title's weight and tracking changed; its count's colour too. */
const restyled = () => ({
  v: 1,
  state: 'compared',
  kind: 'restyled',
  kinds: ['restyled'],
  counts: counts({ runs: 24, restyled: 2 }),
  outsidePx: 0,
  insidePx: 1460,
  changes: [
    {
      kind: 'restyled',
      s: 'Open Items',
      facts: ['weight', 'letterSpacing'],
      key: 'title',
      path: '0/0/0/#0',
      box: [32, 32, 96, 20],
    },
    {
      kind: 'restyled',
      s: '3 entries',
      facts: ['color'],
      path: '0/0/1/#0',
      box: [136, 34, 52, 16],
    },
  ],
  changeCount: 2,
});

/** A pixel change outside text, with a copy edit beside it: no badge, the edit still listed. */
const pixel = () => ({
  v: 1,
  state: 'compared',
  kind: 'pixel',
  kinds: ['copy'],
  counts: counts({ runs: 12, copy: 1 }),
  outsidePx: 3840,
  insidePx: 96,
  changes: [
    {
      kind: 'copy',
      was: 'Save',
      now: 'Save changes',
      key: 'submit',
      path: '0/1/0/#0',
      box: [84, 128, 72, 16],
    },
  ],
  changeCount: 1,
});

/** No text changed: the records are the same, the pixels outside text are not. */
const none = () => ({
  v: 1,
  state: 'compared',
  kind: null,
  kinds: [],
  counts: counts({ runs: 8 }),
  outsidePx: 3840,
  insidePx: 0,
  changes: [],
  changeCount: 0,
});

/** The ids, in the order the inspector steps through them. */
export const TEXT_IDS = {
  copyReflow: 'ui-stat-tile--counts',
  restyled: 'ui-section-header--default',
  noBaseline: 'ui-card--default',
  envDiffers: 'ui-badge--default',
  error: 'ui-chip--default',
  pixel: 'ui-button--submit',
  none: 'ui-icon--default',
};

/** Each row's `textDiff`, by the key of TEXT_IDS. */
export const TEXT_DIFFS = {
  copyReflow,
  restyled,
  noBaseline: () => ({ v: 1, state: 'no-baseline' }),
  envDiffers: () => ({ v: 1, state: 'env-differs' }),
  error: () => ({ v: 1, state: 'error', error: 'boxes.json: unexpected end of JSON input' }),
  pixel,
  none,
};

export const TEXT_SCENARIOS = {
  text() {
    const keys = /** @type {(keyof typeof TEXT_IDS)[]} */ (Object.keys(TEXT_IDS));
    return data({
      rows: keys.map((k) => row(TEXT_IDS[k], { ...changed, textDiff: TEXT_DIFFS[k]() })),
      entries: keys.map((k) => entry(TEXT_IDS[k], issue)),
    });
  },
};
