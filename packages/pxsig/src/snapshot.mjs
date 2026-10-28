/**
 * snapshot.mjs — `pxsig snapshot`: a read-only summary of the committed store, for a Storybook
 * that is deployed (dev, UAT, pre-prod) where no pxsig server can be reached. The Storybook addon
 * writes it into `storybook build` output; its panel shows it on any Storybook not served from
 * this computer.
 *
 * Reads only the committed store (manifests, baseline headers, the approval log, the a11y
 * baseline) and git. No browser, no engine, no network, no store lock; writes nothing in the store.
 *
 * It never carries who approved (`by`), how (`via`), tokens, machine data, file paths or images:
 * the commit and the pull request say who, in the forge, for people who can open it.
 */
import { spawnSync } from './lib/spawn.mjs';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readLog, traceLog } from './lib/approvals.mjs';
import { readHeader } from './lib/psig.mjs';
import { PXSIG_VERSION } from './lib/workspace.mjs';
/** @import { ApprovalLine, Manifest, ManifestEntry, Project } from './types.js' */
/** @import { PartialEnv, ProjectSnapshot, Snapshot, SnapshotHistoryRow, SnapshotStory, TraceRow } from './types/t4.js' */

export const SNAPSHOT_FORMAT = 'pxsig-snapshot';
export const SNAPSHOT_VERSION = 1;

const git = (/** @type {string} */ dir, /** @type {string[]} */ ...args) => {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};

/** What a log line records, without who or how: an approval, an undo, a starting point. */
/** @type {Record<string, string>} */
const EVENT = { undo: 'undone', adopt: 'adopted', migrate: 'migrated' };
const eventOf = (/** @type {ApprovalLine} */ l) =>
  EVENT[l.via] ?? (l.before == null ? 'first baseline' : 'approved');
/** The reason a person gave; a migration's is the old file path pxsig wrote, not a reason. */
const reasonOf = (/** @type {ApprovalLine} */ l) =>
  l.via === 'migrate' ? null : (l.reason ?? null);

/** @returns {unknown} */
const readJson = (/** @type {string} */ p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * Every committed manifest of a project: `manifest.json` and each suite's `manifest.<suite>.json`.
 * @param {Project} P
 * @returns {ManifestEntry[]}
 */
function manifestEntries(P) {
  /** @type {string[]} */
  let files = [];
  try {
    files = readdirSync(P.store.root).filter((f) => /^manifest(\.[^.]+)?\.json$/.test(f));
  } catch {
    return [];
  }
  /** @type {Map<string, ManifestEntry>} */
  const seen = new Map();
  for (const f of files.sort())
    // A manifest pxsig wrote (docs/spec.md section 6).
    for (const e of /** @type {Manifest | null} */ (readJson(join(P.store.root, f)))?.stories ?? [])
      if (e?.id && !seen.has(e.id)) seen.set(e.id, e);
  return [...seen.values()];
}

/**
 * The environment a baseline was rendered in, reduced to what a reader recognises.
 * @param {PartialEnv | null | undefined} env an env record (lib/env.mjs), or as much of one as an
 *   older header has
 */
export function envSummary(env) {
  if (!env) return null;
  const major = String(env.browser?.version ?? '').split('.')[0];
  // `split` returns at least one element, so `at(-1)` is a string.
  const image = env.container?.image
    ? /** @type {string} */ (String(env.container.image).split('/').at(-1))
    : null;
  return {
    browser: [env.browser?.name, major].filter(Boolean).join(' ') || null,
    os: [env.os?.platform, env.os?.arch].filter(Boolean).join(' ') || null,
    container: image,
  };
}

/**
 * Accepted axe rules per entry id (`a11y.json` maps an id to rule ids, or to `{ id }`).
 * @param {Project} P
 */
function a11yRules(P) {
  // a11y.json, as pxsig writes it: an object.
  const a = /** @type {Record<string, unknown>} */ (readJson(P.store.a11y) ?? {});
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const [id, list] of Object.entries(a))
    if (Array.isArray(list))
      out[id] = [
        ...new Set(
          // Rule ids or `{ id }`; filter(Boolean) drops the ones without an id.
          /** @type {string[]} */ (
            /** @type {(string | { id?: string } | null)[]} */ (list)
              .map((x) => (typeof x === 'string' ? x : x?.id))
              .filter(Boolean)
          )
        ),
      ].sort();
  return out;
}

/**
 * Whether the store's committed files have changes git does not have yet.
 * @param {Project} P
 */
function storeUncommitted(P) {
  const paths = [relative(P.workspaceRoot, P.store.root) || '.'];
  if (P.store.layout === 'colocated')
    paths.push(`:(glob)${relative(P.workspaceRoot, P.srcRoot) || '.'}/**/__pxsig__/**`);
  const out = git(P.workspaceRoot, 'status', '--porcelain', '--', ...paths);
  return out == null ? false : out.length > 0;
}

/**
 * One project's stories: each entry's baseline, last log line, environment and a11y, and the history.
 * @param {Project} P
 * @param {{ shallow?: boolean }} [opts]
 * @returns {ProjectSnapshot}
 */
export function projectSnapshot(P, { shallow = false } = {}) {
  const log = readLog(P);
  // Where each line came in (commit, PR), matched by batch, id and time. In a shallow clone, blame credits every
  // line to the one commit there is: no PR is better than a wrong one.
  const key = (/** @type {{ batch: string, id: string, at: string }} */ l) =>
    `${l.batch}\n${l.id}\n${l.at}`;
  /** @type {Map<string, TraceRow>} */
  const trace = new Map((shallow ? null : traceLog(P))?.map((t) => [key(t), t]) ?? []);
  const where = (/** @type {ApprovalLine} */ l) => {
    const t = trace.get(key(l));
    return t ? { pr: t.pr ?? null, commit: t.commit } : null;
  };
  /** @type {Map<string, { l: ApprovalLine }>} */
  const lastById = new Map();
  for (const l of log) lastById.set(l.id, { l });
  const a11y = a11yRules(P);
  /** @type {Record<string, SnapshotStory>} */
  const stories = {};
  /** @type {Map<string, string>} */
  const storyOf = new Map();
  for (const e of manifestEntries(P)) {
    const story = e.story ?? e.id.split(/__|@/)[0];
    storyOf.set(e.id, story);
    const sig = e.sig ? join(P.workspaceRoot, e.sig) : null;
    const baseline = !!sig && existsSync(sig);
    const last = lastById.get(e.id);
    (stories[story] ??= { entries: [], history: [] }).entries.push({
      id: e.id,
      mode: e.mode ?? null,
      state: e.state ?? null,
      baseline,
      approved: last
        ? {
            at: last.l.at ?? null,
            event: eventOf(last.l),
            pr: where(last.l)?.pr ?? null,
            commit: where(last.l)?.commit ?? null,
            kind: last.l.kind ?? null,
            reason: reasonOf(last.l),
          }
        : null,
      env: baseline ? envSummary(readHeader(sig)?.env) : null,
      a11y: a11y[e.id] ?? [],
    });
  }
  // History: one row per batch per story, newest first.
  /** @type {Map<string, { story: string, row: SnapshotHistoryRow }>} */
  const rows = new Map();
  for (const l of log) {
    const story = storyOf.get(l.id);
    if (!story) continue;
    const key = `${story}\n${l.batch}\n${eventOf(l)}`;
    const row = rows.get(key);
    if (row) {
      // This counts on the wrapper, not on `row.row`: the history row keeps `entries: 1` (reported,
      // left as it ships; the wrapper's `entries` becomes NaN and is never read).
      /** @type {{ entries: number }} */ (/** @type {unknown} */ (row)).entries++;
      continue;
    }
    rows.set(key, {
      story,
      row: {
        at: l.at ?? null,
        event: eventOf(l),
        pr: where(l)?.pr ?? null,
        commit: where(l)?.commit ?? null,
        kind: l.kind ?? null,
        reason: reasonOf(l),
        entries: 1,
      },
    });
  }
  for (const { story, row } of rows.values()) stories[story].history.push(row);
  for (const s of Object.values(stories))
    s.history.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { label: P.label ?? null, stories, uncommitted: storeUncommitted(P) };
}

/**
 * The snapshot of several projects (already opened), with the commit it was made from.
 * @param {Project[]} projects
 * @param {{ now?: Date }} [opts]
 * @returns {Snapshot}
 */
export function buildSnapshot(projects, { now = new Date() } = {}) {
  const root = projects[0]?.workspaceRoot ?? process.cwd();
  const inGit = git(root, 'rev-parse', '--is-inside-work-tree') === 'true';
  const shallow = inGit && git(root, 'rev-parse', '--is-shallow-repository') === 'true';
  /** @type {Snapshot} */
  const out = {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    pxsig: PXSIG_VERSION,
    generatedAt: now.toISOString(),
    commit: inGit ? git(root, 'rev-parse', '--short=12', 'HEAD') : null,
    shallow,
    uncommitted: false,
    projects: {},
  };
  for (const P of projects) {
    const { uncommitted, ...p } = projectSnapshot(P, { shallow });
    out.projects[P.name] = p;
    out.uncommitted ||= uncommitted;
  }
  return out;
}

/**
 * Counts for the command's summary line.
 * @param {Snapshot} s
 */
export function snapshotCounts(s) {
  let stories = 0;
  let entries = 0;
  for (const p of Object.values(s.projects)) {
    stories += Object.keys(p.stories).length;
    for (const st of Object.values(p.stories)) entries += st.entries.length;
  }
  return { projects: Object.keys(s.projects).length, stories, entries };
}
