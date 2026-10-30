/** Undoing a batch (approvals.mjs): from its local snapshot, else from git. */
import { createHash } from 'node:crypto';
import { spawnSync } from '../spawn.mjs';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { writeAtomic } from '../files.mjs';
import { gitShow, paths, readLog, sha256 } from './core.mjs';
/** @import { ApprovalLine, Project } from '../../types.js' */
/** @import { EntryPaths, UndoResult } from '../../types/t2.js' */

/** @param {Buffer} b */
const sha256Bytes = (b) => createHash('sha256').update(b).digest('hex');

/**
 * Revisions to look for the pre-approval bytes in: the recorded HEAD first, then the file's history.
 * @param {string} file
 * @param {string | null | undefined} gitHead
 */
function candidateRevs(file, gitHead) {
  const r = spawnSync(
    'git',
    ['-C', dirname(file), 'log', '--format=%H', '-n', '200', '--', basename(file)],
    { encoding: 'utf8' }
  );
  const log = r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
  return [...new Set([...(gitHead ? [gitHead] : []), ...log])];
}

/**
 * Restore every entry a batch approved (or only `ids` of them) to the baseline it replaced. Returns
 * `{ restored: [id], removed: [id], refused: [{ id, why }], source }`; `source` is `history` (the
 * local snapshot) or `git`. With neither available for an entry, it is refused, never guessed.
 * @param {Project} P
 * @param {{ stories: readonly EntryPaths[] }} manifest
 * @param {string} batch
 * @param {{ git?: boolean, ids?: string[] | null }} [options]
 * @returns {UndoResult}
 */
export function undo(P, manifest, batch, { git = true, ids: only = null } = {}) {
  /** @param {string} id */
  const keep = (id) => !only || only.includes(id);
  const log = readLog(P);
  const lines = log.filter((l) => l.batch === batch && keep(l.id));
  const dir = join(P.store.history, batch);
  const local = existsSync(dir);
  if (!local && !lines.length)
    throw new Error(`no snapshot and no approvals logged for batch ${batch}`);
  if (!local && !git) throw new Error(`no snapshot for batch ${batch} on this machine`);
  const byId = new Map(manifest.stories.map((s) => [s.id, s]));
  /** @type {UndoResult} */
  const out = { restored: [], removed: [], refused: [], source: local ? 'history' : 'git' };
  const trashDir = join(P.store.trash, `undo-${batch}`);
  /**
   * @param {string} file
   * @param {string} id
   */
  const toTrash = (file, id) => {
    const dest = join(trashDir, relative(P.workspaceRoot, file));
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(file, dest);
    out.removed.push(id);
  };
  // The first line per id is the one that holds the pre-batch state.
  /** @type {Map<string, ApprovalLine>} */
  const first = new Map();
  for (const l of lines) if (!first.has(l.id)) first.set(l.id, l);
  /**
   * The later batch that approved the baseline `file` holds now, when one did: undoing this batch
   * would silently revert that approval. An undo of this batch itself does not count.
   * @param {string} id
   * @param {string} file
   */
  const approvedLater = (id, file) => {
    const l = first.get(id);
    if (!l || !existsSync(file)) return null;
    const now = sha256(file);
    if (now === l.after) return null;
    const later = log.slice(log.indexOf(l) + 1);
    return later.find((x) => x.id === id && x.after === now && x.batch !== `${batch}-undo`) ?? null;
  };
  /** @type {Set<string>} */
  const snaps = local
    ? new Set(
        readdirSync(dir)
          .filter((n) => n.endsWith('.psig'))
          .map((n) => n.slice(0, -'.psig'.length))
          .filter(keep)
      )
    : new Set();
  const ids = new Set([...snaps, ...first.keys()]);
  for (const id of ids) {
    const entry = byId.get(id);
    if (!entry) {
      out.refused.push({ id, why: 'not in the manifest any more' });
      continue;
    }
    const file = paths(P, entry).sig;
    const l = first.get(id);
    const newer = approvedLater(id, file);
    if (newer) {
      out.refused.push({
        id,
        why: `approved again in batch ${newer.batch} after this one: undo that batch first`,
      });
      continue;
    }
    if (snaps.has(id)) {
      writeAtomic(file, readFileSync(join(dir, `${id}.psig`)));
      out.restored.push(id);
      continue;
    }
    if (!l) continue;
    if (l.before == null) {
      // A first baseline: undoing it removes the file, if it is still the one approved.
      if (!existsSync(file)) continue;
      if (l.after && sha256(file) !== l.after)
        out.refused.push({ id, why: 'the baseline changed after this batch: not removing it' });
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
      out.refused.push({
        id,
        why: `no commit holds the old baseline (sha256 ${l.before.slice(0, 12)}…): not restoring it`,
      });
      continue;
    }
    writeAtomic(file, bytes);
    out.restored.push(id);
  }
  return out;
}
