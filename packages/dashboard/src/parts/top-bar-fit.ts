/**
 * How much of the top bar shows at the bar's width: decided from measured widths, never from fixed
 * breakpoints (docs/ui/build-adapter.md, "Top bar"). As the bar narrows, in this order:
 *
 *   1. the end details go, one at a time: the last check, the modes tag, then the review status
 *      beside the review button (`shed` 1–3);
 *   2. the workspace label is capped at 24ch (`scope: 'cap'`; always below a 1024px bar);
 *   3. the section links move into More (the adapter's NavList does that: last first, never `keep`);
 *   4. the workspace label truncates further, down to a few characters (`scope`: a width in px);
 *   5. the end controls go compact, one at a time (`compact` 1–5): the project picker narrows (down
 *      to `picker`, its value truncated), the review button takes its short label, the connection
 *      and the status become their glyphs, and the end group's gaps tighten.
 *
 * Widening reverses it. Every state is a function of the widths (`decide`), so a wider bar never
 * shows fewer links or end items; once the links are all in More, the list keeps only the room it
 * needs (`spare`), so a compact control never brings a link back. Plain data and functions: Node's
 * tests import this file.
 */

/** The end details, in the order they go. */
export const DETAILS = ['last-check', 'modes', 'status-beside'] as const;
/** The end controls that go compact, in the order they do. */
export const COMPACT = ['picker', 'review', 'connection', 'status', 'tight'] as const;

/** What shows. */
export interface BarState {
  /** How many of DETAILS are shed. */
  shed: number;
  /** The workspace label: its own width, capped at 24ch, or a width in px. */
  scope: 'full' | 'cap' | number;
  /** How many of COMPACT are compact. */
  compact: number;
  /** The project picker's width in px while it is compact. */
  picker: number;
  /** Room left empty before the end group. */
  spare: number;
}

/** What the page measured (`measureBar`), in CSS px. */
export interface BarMeasure {
  /** The bar's own width (its border box). */
  width: number;
  /** The width the section list has now: its content box, less what the bar overflows by. */
  room: number;
  /** Each detail's width in the end group with its gap (0: not drawn), by DETAILS. */
  details: number[];
  /** Each compact control's [full, compact] width (0, 0: not drawn), by COMPACT; the picker's compact width is its narrowest. */
  compact: [number, number][];
  /** The workspace label: its natural width, capped (24ch, never wider than natural), shortest. */
  scope: { natural: number; cap: number; min: number };
  /** Every section link at its natural width, gaps included, while all show in the bar; else null. */
  links: number | null;
  /** The More trigger and the kept links, gaps included, while More shows; else null. */
  more: number | null;
  /** The margin an adapter's own measuring needs (its gap, rounding). */
  tol: number;
}

/** Below this bar width the label is capped whatever else fits. */
export const CAP_BELOW = 1024;

export const FULL: BarState = { shed: 0, scope: 'full', compact: 0, picker: 0, spare: 0 };

/** What a state's brand and end group take, beside the list. */
export function cost(m: BarMeasure, s: BarState) {
  const { natural, cap } = m.scope;
  let total =
    (s.scope === 'full' ? natural : s.scope === 'cap' ? cap : Math.min(s.scope, cap)) + s.spare;
  m.details.forEach((w, i) => {
    if (i >= s.shed) total += w;
  });
  m.compact.forEach(([full, short], i) => {
    // A picker that is drawn takes the width it is given, its narrowest at the least.
    const narrow = i === 0 && full ? Math.max(short, Math.min(full, s.picker)) : short;
    total += i < s.compact ? narrow : full;
  });
  return total;
}

export const same = (a: BarState, b: BarState) =>
  a.shed === b.shed &&
  a.scope === b.scope &&
  a.compact === b.compact &&
  a.picker === b.picker &&
  a.spare === b.spare;

/**
 * The state for these widths, measured in state `now`. `links` and `more` may come from an earlier
 * measure (the caller keeps the last ones): the links' width is only seen while they all show.
 */
export function decide(
  m: BarMeasure,
  now: BarState,
  known: { links: number | null; more: number | null }
): BarState {
  const base = m.room + cost(m, now);
  const roomAt = (s: BarState) => base - cost(m, s);
  const at = (shed: number, scope: BarState['scope'], compact = 0, picker = 0): BarState => ({
    shed,
    scope,
    compact,
    picker,
    spare: 0,
  });
  const { links, more } = known;
  if (links != null)
    for (let shed = 0; shed <= DETAILS.length; shed++) {
      // The label is capped once every detail is shed, and always on a narrow bar.
      const s = at(shed, shed === DETAILS.length || m.width < CAP_BELOW ? 'cap' : 'full');
      if (roomAt(s) >= links + m.tol) return s;
    }
  const shedAll = at(DETAILS.length, 'cap');
  // The links go into More (the adapter moves them); what is left must hold More and the kept links.
  if (more == null || roomAt(shedAll) >= more + m.tol) return shedAll;
  const need = more + m.tol;
  const short = Math.floor(m.scope.cap - (need - roomAt(shedAll)));
  if (m.scope.cap > m.scope.min && short >= m.scope.min) return at(DETAILS.length, short);
  const min = Math.min(m.scope.min, m.scope.cap);
  const [full, narrowest] = m.compact[0] ?? [0, 0];
  const wide = at(DETAILS.length, min, 1, full);
  const picker = Math.floor(full - (need - roomAt(wide)));
  if (full && picker >= narrowest) return at(DETAILS.length, min, 1, picker);
  for (let compact = 1; compact <= COMPACT.length; compact++) {
    const s = at(DETAILS.length, min, compact, narrowest);
    const left = roomAt(s) - need;
    if (left >= 0) return { ...s, spare: Math.floor(left) };
  }
  return at(DETAILS.length, min, COMPACT.length, narrowest);
}

/** Whether a state shows every section link in the bar, by the widths it was decided on. */
export const linksFit = (m: BarMeasure, now: BarState, s: BarState, links: number | null) =>
  links != null && s.compact === 0 && m.room + cost(m, now) - cost(m, s) >= links + m.tol;
