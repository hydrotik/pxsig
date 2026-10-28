/**
 * The panel on a Storybook that is not served from this computer (dev, UAT, pre-prod): no pxsig
 * server is reachable there, by design, so the panel makes no request to one. It reads the
 * read-only snapshot `storybook build` wrote beside the Storybook (`pxsig-snapshot.json`, from
 * `pxsig snapshot`) and shows it. Plain functions: no Storybook import here.
 */

export const SNAPSHOT_FILE = 'pxsig-snapshot.json';
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** True when the Storybook page itself is served from this computer. */
export const isLocalHost = (hostname) => LOCAL.has(String(hostname ?? '').toLowerCase());

/**
 * `live`: the panel talks to the pxsig server on this computer, as it always has. `snapshot`: it
 * reads the snapshot only. A `pxsig-server` override in localStorage always means `live`.
 */
export const panelMode = ({ hostname, override = null }) =>
  override || isLocalHost(hostname) ? 'live' : 'snapshot';

/** A usable snapshot, or null. */
export function parseSnapshot(json) {
  return json && json.format === 'pxsig-snapshot' && json.version === 1 && json.projects
    ? json
    : null;
}

const day = (iso) => (iso ? String(iso).slice(0, 10) : '');

/** The PR column: the PR, or why there is none. */
export function prText(approved, snap) {
  if (!approved) return '';
  if (approved.pr != null) return `#${approved.pr}`;
  if (snap?.shallow) return 'not known';
  return approved.commit ? 'no PR' : 'not committed';
}

/** The environment a baseline was rendered in, as one line. */
export function envText(env) {
  if (!env) return 'not recorded';
  return [env.browser, env.os, env.container].filter(Boolean).join(' · ') || 'not recorded';
}

/** The line above the tables: what the snapshot is and what it was made from. */
export function headerText(snap) {
  const parts = ['pxsig · read-only'];
  if (snap.commit) parts.push(`built from ${snap.commit}, ${day(snap.generatedAt)}`);
  else parts.push(`built ${day(snap.generatedAt)}`);
  if (snap.uncommitted) parts.push('the store had uncommitted changes');
  if (snap.shallow) parts.push('PRs not known (shallow clone)');
  return parts.join(' · ');
}

/** The story's rows, from whichever project holds it, or null when no entry covers it. */
export function storyView(snap, storyId) {
  for (const p of Object.values(snap?.projects ?? {})) {
    const s = p.stories?.[storyId];
    if (!s) continue;
    return {
      entries: s.entries.map((e) => ({
        mode: [e.mode, e.state].filter(Boolean).join(' · ') || e.id,
        baseline: e.baseline ? 'yes' : 'none',
        last: e.approved ? `${day(e.approved.at)} ${e.approved.event}` : 'not logged',
        pr: prText(e.approved, snap),
        change: e.approved?.kind ?? '',
        env: e.baseline ? envText(e.env) : '',
        a11y: e.a11y?.length ? e.a11y.join(', ') : 'none accepted',
      })),
      history: s.history.map((h) => ({
        at: day(h.at),
        event: h.event,
        pr: prText(h, snap),
        change: h.kind ?? '',
        reason: h.reason ?? '',
        entries: h.entries,
      })),
    };
  }
  return null;
}

/** What the panel says when this Storybook has no snapshot. */
export const noSnapshotText = (host) => ({
  title: 'pxsig: not connected on this Storybook',
  body: `pxsig runs on a developer's own computer, against a Storybook running there. This Storybook is served from ${host}, so the panel makes no connection. Baselines are reviewed in pull requests.`,
});
