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

/**
 * How the engine starts each reason no approval passes, and what to do about it (the engine's
 * `blocked_fixes` says the same, crates/pxsig-cli/src/batch/masks.rs).
 */
const BLOCKED = /** @type {const} */ ([
  ['mask on a container', 'put data-volatile on the element that shows the value (a leaf)'],
  ['mask needs a reason', 'give data-volatile a reason, e.g. data-volatile="relative time"'],
  ['mask not measured', 'mask at most 500 elements, all there when the story is ready'],
  ['masks cover ', 'make the masks smaller'],
  ['a mask covers the story root', 'mask the value, not the story root'],
]);

/**
 * What to do about one reason no approval passes; null for any other reason.
 * @param {string} reason
 */
export const fixFor = (reason) => BLOCKED.find(([b]) => reason.startsWith(b))?.[1] ?? null;

/**
 * Why no approval passes a row (`masksBlocked`): its reasons as the engine wrote them.
 * @param {{ reasons?: string[] }} row
 */
export const blockedReasons = (row) => (row.reasons ?? []).filter((r) => fixFor(r));

/**
 * What to do about a blocked row, each once, in the engine's order (`blocked_fixes`): the
 * `data-volatile` problems, then the share, then the story root.
 * @param {{ reasons?: string[] }} row
 */
export const blockedFixes = (row) => {
  const reasons = blockedReasons(row);
  return BLOCKED.filter(([b]) => reasons.some((r) => r.startsWith(b))).map(([, fix]) => fix);
};
/** All of an entry's masks together over this share of the capture: a warning. */
export const LARGE_SHARE = 0.25;

/**
 * Why no decision is recorded on a blocked row (the server's refusal of approve, reject and the
 * a11y decisions; `pxsig approve plan`): the masks block it, the author fixes it, and how.
 * @param {{ reasons?: string[] }} row
 */
export const blockedSay = (row) =>
  `the masks block this entry, and the author fixes it (no decision is needed): ${blockedReasons(row).join('; ')}; ${blockedFixes(row).join('; ')}`;
