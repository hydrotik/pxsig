/**
 * mask-words.mjs — a row's masks in words, the same everywhere they are said (the check's output,
 * `check --update`, SARIF, the tools): what changed from the baseline's masks, and why no approval
 * passes the entry (crates/pxsig-cli/src/batch/masks.rs decides both). Selectors and shares only.
 */

/** @import { MasksChanged } from '../types/run.js' */

/** The kinds of mask change, and how each is said. */
const KINDS = /** @type {const} */ ([
  ['added', 'added'],
  ['removed', 'removed'],
  ['grew', 'grew'],
  ['moved', 'moved'],
  ['count', 'changed count'],
]);

/**
 * A mask change with its selectors: `masks changed: 1 added (.a); 2 grew (.b, .c)`.
 * @param {Partial<MasksChanged>} ch
 */
export function maskChange(ch) {
  const parts = KINDS.flatMap(([k, word]) => {
    const s = ch[k] ?? [];
    return s.length ? [`${s.length} ${word} (${s.join(', ')})`] : [];
  });
  return `masks changed: ${parts.join('; ')}`;
}

/** How the engine starts each reason no approval passes. */
const BLOCKED = [
  'masks cover ',
  'a mask covers the story root',
  'mask on a container',
  'mask needs a reason',
  'mask not measured',
];

/**
 * Why no approval passes a row (`masksBlocked`): its reasons as the engine wrote them.
 * @param {{ reasons?: string[] }} row
 */
export const blockedReasons = (row) =>
  (row.reasons ?? []).filter((r) => BLOCKED.some((b) => r.startsWith(b)));

/** All of an entry's masks together over this share of the capture: a warning. */
export const LARGE_SHARE = 0.25;
