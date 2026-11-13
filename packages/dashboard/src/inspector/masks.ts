/**
 * An entry's masks (side/MasksSection.tsx, parts/MaskBadges.tsx): the render's and, when they
 * changed, the baseline's, as the engine records them (docs/spec.md "Masks"). A masks-only change
 * (the masks changed and no pixel differs by more than the tolerance) has nothing for the pixel
 * analysis to show: the inspector then says so and puts the masks, before and after, first.
 */
import { t } from '../copy';
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

/** All of an entry's masks together over this share of the capture are a warning (Large mask). */
export const LARGE_SHARE = 0.25;

/**
 * Large mask: all of the entry's masks together cover over 25% of the capture (`masksCoverage`,
 * as the engine, summary.md and SARIF weigh it), a warning, never a verdict.
 */
export const masksLarge = (row: Row) => (row.masksCoverage ?? 0) > LARGE_SHARE;

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

/**
 * How the engine starts each reason no approval passes (crates/pxsig-cli/src/batch/masks.rs), and
 * what to do about it (`inspector.masks.fix.*`, the engine's `blocked_fixes` in words).
 */
const BLOCKED = [
  ['mask on a container', 'container'],
  ['mask needs a reason', 'reason'],
  ['mask not measured', 'unmeasured'],
  ['masks cover ', 'coverage'],
  ['a mask covers the story root', 'root'],
] as const;

const causeOf = (r: string) => BLOCKED.find(([b]) => r.startsWith(b))?.[1];

/** Why no approval passes the entry: the row's reasons the masks gave it, as the engine wrote them. */
export const blockedReasons = (row: Row) =>
  row.masksBlocked ? (row.reasons ?? []).filter((r) => causeOf(r)) : [];

/** The causes of the entry's block, each once, in the engine's order (`blocked_fixes`). */
export const blockedCauses = (row: Row) => {
  const reasons = blockedReasons(row);
  return BLOCKED.filter(([b]) => reasons.some((r) => r.startsWith(b))).map(([, c]) => c);
};
/**
 * The line that says why no approval passes the entry and what to do about each cause, the same
 * words as the CLI and the tools; null for an entry no mask blocks. The Masks section shows it,
 * and the disabled Approve button describes itself with it.
 */
export function blockedLine(row: Row): string | null {
  const reasons = blockedReasons(row);
  if (!reasons.length) return null;
  const fixes = blockedCauses(row).map((c) => t(`inspector.masks.fix.${c}`));
  return t('inspector.masks.blocked', { reasons: reasons.join('; '), fixes: fixes.join('; ') });
}
