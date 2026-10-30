/** Reading the report data (data.ts re-exports each one): rows, queues, files and formatting. */
import { t } from '../copy';
import type { Row, ReviewEntry, IntegrityEntry, IntegrityLedger, Data } from './types';

/** Integrity entries by id (memoised per ledger). */
const byIdCache = new WeakMap<IntegrityLedger, Map<string, IntegrityEntry>>();
export function integrityOf(d: Data, id: string): IntegrityEntry | null {
  const L = d.integrity;
  if (!L) return null;
  let m = byIdCache.get(L);
  if (!m) byIdCache.set(L, (m = new Map(L.entries.map((x) => [x.id, x]))));
  return m.get(id) ?? null;
}

/**
 * Report rows plus a placeholder for every NEW manifest entry (no signature) the report has not
 * seen, so a registered story shows up in the approval list before its first render.
 */
export function rowsWithPending(d: Data): Row[] {
  const rows = d.check?.rows ?? [];
  if (!d.integrity) return rows;
  const have = new Set(rows.map((r) => r.id));
  const pending = d.integrity.entries
    .filter((x) => x.files && !have.has(x.id) && x.issues.some((i) => i.code === 'unbaselined'))
    .map((x): Row => ({
      id: x.id,
      story: x.story,
      mode: x.mode ?? '',
      state: x.state,
      pass: false,
      new: true,
      pending: true,
      metrics: null,
      reasons: [t('review.pendingReason')],
    }));
  return pending.length ? [...rows, ...pending] : rows;
}

/** Files behind one verdict. `scenario` = { tag, name } for scenario renders. */
export function pathsFor(d: Data, id: string, scenario?: { tag: string; name: string } | null) {
  const P = d.paths;
  if (scenario)
    return {
      before: `${P.renders}${scenario.tag}/control/${id}.png`,
      after: `${P.renders}${scenario.tag}/${scenario.name}/${id}.png`,
      baseSig: `${P.diffRoot}${scenario.tag}/${scenario.name}/${id}.baseline.png`,
      curSig: `${P.diffRoot}${scenario.tag}/${scenario.name}/${id}.current.png`,
      heat: `${P.diffRoot}${scenario.tag}/${scenario.name}/${id}.diff.png`,
      page: `${P.diffRoot}${scenario.tag}/${scenario.name}/${id}.diff.html`,
      record: null as string | null,
      beforeLabel: t('inspector.renders.control'),
      afterLabel: t('inspector.renders.scenario', { name: scenario.name }),
    };
  return {
    before: `${P.renders}base/${id}.png`,
    after: `${P.renders}latest/${id}.png`,
    baseSig: `${P.diffRoot}latest/${id}.baseline.png`,
    curSig: `${P.diffRoot}latest/${id}.current.png`,
    heat: `${P.diffRoot}latest/${id}.diff.png`,
    page: `${P.diffRoot}latest/${id}.diff.html`,
    record: d.sigs[id] ?? null,
    beforeLabel: t('inspector.renders.baseline'),
    afterLabel: t('inspector.renders.latest'),
  };
}

export const fmt = {
  // A report without a timing (written by an older server) shows a dash, not NaN.
  ms: (v: number | null | undefined) =>
    typeof v !== 'number' || !Number.isFinite(v)
      ? '—'
      : v >= 1000
        ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} s`
        : `${Math.round(v)} ms`,
  pct: (v: number, d = 0) => `${(v * 100).toFixed(d)}%`,
  num: (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v)),
  kb: (b: number) => `${(b / 1024).toFixed(1)} KB`,
  x: (v: number) => `${v >= 10 ? Math.round(v) : v.toFixed(1)}×`,
};

export type Queue = 'changed' | 'new' | 'a11y';

/** An entry with new axe violations whose visual verdict needs no review: the accessibility queue. */
const a11yOnly = (r: Row) =>
  (r.a11y?.new ?? 0) > 0 && !['changed', 'new'].includes(statusOf(r, {}));

/**
 * The entries a review session walks: every changed (or new, rendered, or a11y-only) entry of the
 * last check, decided or not, largest change first. Progress is how many of them have a decision.
 */
export function reviewQueue(d: Data, kind: Queue): Row[] {
  const size = (r: Row) =>
    (r.metrics?.ssim ?? 2) -
    (r.detail ? (r.detail.changedTiles + r.detail.newEdgeTiles) / 1000 : 0);
  return rowsWithPending(d)
    .filter((r) => !r.pending && (kind === 'a11y' ? a11yOnly(r) : statusOf(r, {}) === kind))
    .sort((a, b) => size(a) - size(b) || a.id.localeCompare(b.id));
}

/** The decision on an entry within a queue: the visual review, or the accessibility one. */
export function decisionOf(
  d: Data,
  kind: Queue | null | undefined,
  id: string
): { state: string } | undefined {
  return kind === 'a11y' ? d.a11yReview?.[id] : d.review[id];
}

/** The component an entry belongs to: the integrity ledger's, else the story title's first part. */
export function componentOf(d: Data, r: Row): string {
  return integrityOf(d, r.id)?.component ?? (r.story ?? r.id).split('--')[0];
}

/** A review decision (made on this run's results; a new check clears them) wins over the verdict. */
export function statusOf(
  r: Row,
  review: Record<string, ReviewEntry>
): 'approved' | 'rejected' | 'changed' | 'new' | 'flaky' | 'skipped' | 'error' | 'pass' {
  const rv = review[r.id];
  if (rv) return rv.state;
  if (r.skipped) return 'skipped';
  if (r.new) return 'new';
  if (r.error) return 'error';
  if (r.flaky) return 'flaky';
  return r.pass ? 'pass' : 'changed';
}
