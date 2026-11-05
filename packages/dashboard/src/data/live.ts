/**
 * A decision's `review` event applied to the page's data (serve/review.mjs, serve/a11y.mjs): the
 * event carries what the decision changed, so the page does not fetch all of `/__pxsig/data` again.
 */
import type { CheckReport, Data, ReviewEntry, Row } from './types';

/** A `review` event's data. `entry` or `a11y` is the decision (null: cleared). */
export interface ReviewEvent {
  project?: string;
  id?: string;
  entry?: ReviewEntry | null;
  a11y?: { state: 'accepted' | 'rejected'; at: string } | null;
  /** The entry's check row as rewritten, with the recounted summary (absent: check.json unchanged). */
  row?: Row | null;
  summary?: CheckReport['summary'];
  /** check.json changed more than this entry's row: the page fetches its data again. */
  refetch?: true;
}

/** Sets `key` in a decision map, or removes it for null. */
function put<T>(map: Record<string, T> | undefined, key: string, value: T | null) {
  const next = { ...map };
  if (value) next[key] = value;
  else delete next[key];
  return next;
}

/**
 * The data after a `review` event, or null when the page has to fetch it instead: the event is
 * one this page cannot apply (no id, `refetch`, a check.json the page does not have yet).
 */
export function applyReviewEvent(d: Data, ev: ReviewEvent): Data | null {
  const id = ev.id;
  if (!id || ev.refetch || !('entry' in ev || 'a11y' in ev)) return null;
  let next: Data = { ...d };
  if ('entry' in ev) next.review = put(d.review, id, ev.entry ?? null);
  if ('a11y' in ev) next.a11yReview = put(d.a11yReview, id, ev.a11y ?? null);
  if (ev.summary) {
    if (!d.check || !ev.row) return null;
    const row = ev.row;
    next = {
      ...next,
      check: {
        ...d.check,
        summary: ev.summary,
        rows: d.check.rows.map((r) => (r.id === id ? row : r)),
      },
    };
  }
  return next;
}
