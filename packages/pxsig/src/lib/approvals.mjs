/**
 * approvals.mjs — every baseline write is backed up, logged and reversible.
 *
 *   <store>/approvals.ndjson          one line per approved entry: who, when, how, why, batch,
 *                                     the git HEAD, and the sha256 of the baseline before / after
 *   <store>/history/<batch>/<id>.psig the previous baseline (signature + image), for `undo`
 *
 * The server calls `snapshot()` + `record()` around every approve, whichever client asked
 * (dashboard, Storybook panel, MCP, CLI), so nothing reaches a baseline without a trail.
 *
 * `undo` restores a batch from `history/<batch>/` when this machine has it. The history folder is
 * not committed, so on another machine (a teammate, CI) it restores from git instead: each log
 * line names the git HEAD at approval time and the sha256 of the baseline it replaced, and a file
 * is restored from a commit only when its bytes hash to exactly that `before`. A first baseline
 * (`before: null`) is undone by moving the file to the store trash/.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

export const sha256 = (path) =>
  existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null;

export function paths(P, entry) {
  return {
    latestPng: join(P.store.latest, `${entry.id}.png`),
    sig: resolve(P.workspaceRoot, entry.sig),
    log: P.store.approvals,
    history: P.store.history,
  };
}

const git = (root, ...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }).stdout?.trim() ?? '';
export const who = (root) => git(root, 'config', 'user.email') || process.env.USER || 'unknown';
export const newBatch = (via) => `${new Date().toISOString().replace(/[:.]/g, '-')}-${via}`;

/** Copy the current baseline aside before it is overwritten. */
export function snapshot(P, entry, batch) {
  const p = paths(P, entry);
  const dir = join(p.history, batch);
  mkdirSync(dir, { recursive: true });
  if (existsSync(p.sig)) copyFileSync(p.sig, join(dir, `${entry.id}.psig`));
  return { before: sha256(p.sig) };
}

export function record(P, entry, { batch, via, reason = null, before, kind = null }) {
  const p = paths(P, entry);
  mkdirSync(dirname(p.log), { recursive: true });
  const line = {
    at: new Date().toISOString(),
    id: entry.id,
    by: who(P.workspaceRoot),
    via,
    batch,
    reason,
    kind,
    gitHead: git(P.workspaceRoot, 'rev-parse', '--short', 'HEAD'),
    before,
    after: sha256(p.sig),
  };
  appendFileSync(p.log, `${JSON.stringify(line)}\n`);
  return line;
}

export function readLog(P) {
  const p = P.store.approvals;
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const sha256Bytes = (b) => createHash('sha256').update(b).digest('hex');

/** A file's bytes at a git revision, or null. Works from the file's own folder (any repo root). */
function gitShow(file, rev) {
  const r = spawnSync('git', ['-C', dirname(file), 'show', `${rev}:./${basename(file)}`], { maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

/** Revisions to look for the pre-approval bytes in: the recorded HEAD first, then the file's history. */
function candidateRevs(file, gitHead) {
  const r = spawnSync('git', ['-C', dirname(file), 'log', '--format=%H', '-n', '200', '--', basename(file)], { encoding: 'utf8' });
  const log = r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
  return [...new Set([...(gitHead ? [gitHead] : []), ...log])];
}

/**
 * Restore every entry a batch approved (or only `ids` of them) to the baseline it replaced. Returns
 * `{ restored: [id], removed: [id], refused: [{ id, why }], source }`; `source` is `history` (the
 * local snapshot) or `git`. With neither available for an entry, it is refused, never guessed.
 */
export function undo(P, manifest, batch, { git = true, ids: only = null } = {}) {
  const keep = (id) => !only || only.includes(id);
  const lines = readLog(P).filter((l) => l.batch === batch && keep(l.id));
  const dir = join(P.store.history, batch);
  const local = existsSync(dir);
  if (!local && !lines.length) throw new Error(`no snapshot and no approvals logged for batch ${batch}`);
  if (!local && !git) throw new Error(`no snapshot for batch ${batch} on this machine`);
  const byId = new Map(manifest.stories.map((s) => [s.id, s]));
  const out = { restored: [], removed: [], refused: [], source: local ? 'history' : 'git' };
  const trashDir = join(P.store.trash, `undo-${batch}`);
  const toTrash = (file, id) => {
    const dest = join(trashDir, relative(P.workspaceRoot, file));
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(file, dest);
    out.removed.push(id);
  };
  // The first line per id is the one that holds the pre-batch state.
  const first = new Map();
  for (const l of lines) if (!first.has(l.id)) first.set(l.id, l);
  const snaps = local ? new Set(readdirSync(dir).filter((n) => n.endsWith('.psig')).map((n) => n.slice(0, -'.psig'.length)).filter(keep)) : new Set();
  const ids = new Set([...snaps, ...first.keys()]);
  for (const id of ids) {
    const entry = byId.get(id);
    if (!entry) {
      out.refused.push({ id, why: 'not in the manifest any more' });
      continue;
    }
    const file = paths(P, entry).sig;
    const l = first.get(id);
    if (snaps.has(id)) {
      copyFileSync(join(dir, `${id}.psig`), file);
      out.restored.push(id);
      continue;
    }
    if (!l) continue;
    if (l.before == null) {
      // A first baseline: undoing it removes the file, if it is still the one approved.
      if (!existsSync(file)) continue;
      if (l.after && sha256(file) !== l.after) out.refused.push({ id, why: 'the baseline changed after this batch: not removing it' });
      else toTrash(file, id);
      continue;
    }
    if (local) {
      out.refused.push({ id, why: 'no snapshot of the old baseline in this batch' });
      continue;
    }
    let bytes = null;
    for (const rev of candidateRevs(file, l.gitHead)) {
      const b = gitShow(file, rev);
      if (b && sha256Bytes(b) === l.before) {
        bytes = b;
        break;
      }
    }
    if (!bytes) {
      out.refused.push({ id, why: `no commit holds the old baseline (sha256 ${l.before.slice(0, 12)}…): not restoring it` });
      continue;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    out.restored.push(id);
  }
  return out;
}

/** Baselines whose bytes differ from the last approval logged for them: written outside the trail. */
export function verify(P, manifest) {
  const last = new Map();
  for (const l of readLog(P)) last.set(l.id, l);
  const untracked = [];
  const mismatched = [];
  for (const e of manifest.stories) {
    const l = last.get(e.id);
    if (!l) {
      untracked.push(e.id);
      continue;
    }
    const now = sha256(paths(P, e).sig);
    if (now !== l.after) mismatched.push({ id: e.id, logged: l.after?.slice(0, 12), now: now?.slice(0, 12) });
  }
  return {
    logged: last.size,
    untracked: untracked.length,
    untrackedSample: untracked.slice(0, 10),
    mismatched,
  };
}
