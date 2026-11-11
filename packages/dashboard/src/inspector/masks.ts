/**
 * An entry's masks (side/MasksSection.tsx, parts/MaskBadges.tsx): the render's and, when they
 * changed, the baseline's, as the engine records them (docs/spec.md "Masks"). A masks-only change
 * (the masks changed and no pixel differs by more than the tolerance) has nothing for the pixel
 * analysis to show: the inspector then says so and puts the masks, before and after, first.
 */
import type { MaskRecord, Row } from '../data';
import type { Analysis } from './analyse';

/** How a mask compares with the baseline's. */
export type MaskState = 'added' | 'removed' | 'grew' | 'count' | 'moved' | 'same';

/** One mask as the Masks section lists it: its area before (the baseline) and after (the render). */
export interface MaskLine {
  selector: string;
  source: MaskRecord['source'];
  reason?: string;
  state: MaskState;
  before: number | null;
  after: number | null;
  large: boolean;
}

/** The masks decided the verdict: a failed entry whose every reason is the masks' own. */
export const masksDecided = (row: Row) =>
  !row.pass &&
  !!row.masksChanged &&
  !!row.reasons?.length &&
  row.reasons.every((r) => r.startsWith('masks changed'));

/** A masks-only change at this tolerance: the masks failed the entry and no pixel differs. */
export const masksOnly = (row: Row, analysis: Analysis | null) =>
  !!analysis && analysis.changed === 0 && masksDecided(row);

/**
 * The render's masks, then those only the baseline had, each with its state, both areas (the
 * baseline's only when the masks changed: an unchanged mask's area is the same) and whether it is
 * over 25% of the capture.
 */
export function maskLines(row: Row): MaskLine[] {
  const ch = row.masksChanged;
  const base = row.masksBaseline ?? [];
  const large = new Set((row.masksLarge ?? []).map((m) => m.selector));
  const areaIn = (l: MaskRecord[], sel: string) => l.find((m) => m.selector === sel)?.area ?? null;
  const state = (sel: string): MaskState =>
    ch?.added.includes(sel)
      ? 'added'
      : ch?.removed.includes(sel)
        ? 'removed'
        : ch?.grew.includes(sel)
          ? 'grew'
          : ch?.count?.includes(sel)
            ? 'count'
            : ch?.moved?.includes(sel)
              ? 'moved'
              : 'same';
  const now = (row.masks ?? []).map((m) => ({
    selector: m.selector,
    source: m.source,
    reason: m.reason,
    state: state(m.selector),
    before: ch ? areaIn(base, m.selector) : m.area,
    after: m.area,
    large: large.has(m.selector),
  }));
  // A removed mask from the baseline's list; a report without that list names the selector only.
  const gone = (ch?.removed ?? [])
    .filter((sel) => !now.some((x) => x.selector === sel))
    .map((sel) => {
      const m = base.find((x) => x.selector === sel);
      return {
        selector: sel,
        source: m?.source ?? 'story',
        reason: m?.reason,
        state: 'removed' as const,
        before: m?.area ?? null,
        after: null,
        large: false,
      };
    });
  return [...now, ...gone];
}

/** Selectors that changed in any way since the baseline, each once. */
export const changedMasks = (row: Row) => {
  const ch = row.masksChanged;
  return ch
    ? new Set([...ch.added, ...ch.removed, ...ch.grew, ...(ch.count ?? []), ...(ch.moved ?? [])])
        .size
    : 0;
};

/** How the engine starts each reason no approval passes (crates/pxsig-cli/src/batch/masks.rs). */
const BLOCKED = [
  'masks cover ',
  'a mask covers the story root',
  'mask on a container',
  'mask needs a reason',
  'mask not measured',
];

/** Why no approval passes the entry: the row's reasons the masks gave it, as the engine wrote them. */
export const blockedReasons = (row: Row) =>
  row.masksBlocked ? (row.reasons ?? []).filter((r) => BLOCKED.some((b) => r.startsWith(b))) : [];
