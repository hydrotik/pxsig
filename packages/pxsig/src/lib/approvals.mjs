/**
 * approvals.mjs — every baseline write is backed up, logged and reversible.
 *
 *   <store>/approvals.ndjson          one line per approved entry: when, how, why, batch, the git
 *                                     HEAD, the sha256 of the baseline before / after, and the
 *                                     assistant marker when there is one
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
 *
 * Order of an approval: snapshot, then the new `.psig`, then the log line (appended in one write,
 * lib/files.mjs). A crash between the last two leaves a baseline the log does not know yet:
 * `verify` calls it `interrupted` (not `mismatch`) when the batch's snapshot still holds the logged
 * bytes, and `approve undo <batch>` puts it back.
 */
import { spawnSync } from './spawn.mjs';
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readLines } from './files.mjs';
import { PXSIG_VERSION } from './workspace.mjs';
import { paths, sha256 } from './approvals/core.mjs';
/** @import { ApprovalLine, TornLine } from '../types.js' */
/** @import { ApprovalProject, EntryPaths, Interrupted, Mismatch, VerifyResult } from '../types/t2.js' */

export {
  newBatch,
  paths,
  PERSON_VIA,
  readLog,
  record,
  sha256,
  snapshot,
  stamp,
  tornLines,
  who,
} from './approvals/core.mjs';
export { undo } from './approvals/undo.mjs';
export { appendedSince, changedByRoute, mergeBase, route, traceLog } from './approvals/history.mjs';

/**
 * When a batch started, from its name (`newBatch`: an ISO time with `-` for `:` and `.`); else null.
 * @param {string} batch
 */
function batchTime(batch) {
  const m = /^(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)-(\d{3})Z/.exec(batch);
  return m ? Date.parse(`${m[1]}:${m[2]}:${m[3]}.${m[4]}Z`) : null;
}

/**
 * The batch whose approval of `id` was cut short: it started after the entry's last log line, its
 * snapshot holds the bytes that line logged, and it logged no line for the entry. Null when no
 * snapshot on this machine says so.
 * @param {ApprovalProject} P
 * @param {string} id
 * @param {ApprovalLine} last
 * @param {Set<string>} batchesWithLine
 */
function interruptedBatch(P, id, last, batchesWithLine) {
  const logged = last?.after;
  if (!logged || !existsSync(P.store.history)) return null;
  for (const batch of readdirSync(P.store.history).sort().reverse()) {
    if (batchesWithLine.has(`${batch}\0${id}`)) continue;
    const t = batchTime(batch);
    if (t == null || !(t >= Date.parse(last.at))) continue;
    const snap = join(P.store.history, batch, `${id}.psig`);
    if (existsSync(snap) && sha256(snap) === logged) return batch;
  }
  return null;
}

/**
 * Baselines whose bytes differ from the last approval logged for them: written outside the trail
 * (`mismatched`), or by an approval a crash cut short before its log line (`interrupted`).
 */
/** A log line's pxsig older than this one (major.minor), or written before lines named theirs. */
/** @param {string | null | undefined} v */
export const olderThanThis = (v) => {
  if (!v) return true;
  const [a, b] = String(v).split('.').map(Number);
  const [x, y] = PXSIG_VERSION.split('.').map(Number);
  return a < x || (a === x && b < y);
};

/**
 * @param {ApprovalProject} P
 * @param {{ stories: readonly EntryPaths[] }} manifest
 * @returns {VerifyResult}
 */
export function verify(P, manifest) {
  // The approval log is pxsig's own: every complete line is an ApprovalLine.
  const { lines, torn } = /** @type {{ lines: ApprovalLine[], torn: TornLine[] }} */ (
    readLines(P.store.approvals)
  );
  /** @type {Map<string, ApprovalLine>} */
  const last = new Map();
  /** @type {Set<string>} */
  const batchesWithLine = new Set();
  for (const l of lines) {
    last.set(l.id, l);
    batchesWithLine.add(`${l.batch}\0${l.id}`);
  }
  /** @type {string[]} */
  const untracked = [];
  /** @type {Mismatch[]} */
  const mismatched = [];
  /** @type {Interrupted[]} */
  const interrupted = [];
  for (const e of manifest.stories) {
    const l = last.get(e.id);
    if (!l) {
      // A baseline with no log line. An entry with no baseline yet has nothing to verify.
      if (existsSync(paths(P, e).sig)) untracked.push(e.id);
      continue;
    }
    const now = sha256(paths(P, e).sig);
    if (now === l.after) continue;
    const batch = interruptedBatch(P, e.id, l, batchesWithLine);
    // The pxsig that wrote the line (lines before 0.4.0 carry none): an older one beside this one
    // (a teammate who has not upgraded) explains a difference better than "outside the trail".
    const writtenBy = l.pxsig ?? null;
    if (batch)
      interrupted.push({
        id: e.id,
        batch,
        logged: l.after?.slice(0, 12),
        now: now?.slice(0, 12),
        writtenBy,
      });
    else
      mismatched.push({
        id: e.id,
        logged: l.after?.slice(0, 12),
        now: now?.slice(0, 12),
        writtenBy,
        older: olderThanThis(writtenBy),
      });
  }
  return {
    logged: last.size,
    untracked: untracked.length,
    untrackedSample: untracked.slice(0, 10),
    untrackedIds: untracked,
    mismatched,
    interrupted,
    torn: torn.length,
  };
}

/**
 * Store files and baselines (any `.psig`, for the colocated layout) git lists as conflicted
 * (`git ls-files -u`): a merge or rebase left them half-done. Workspace-relative.
 * @param {ApprovalProject} P
 */
export function conflictedStoreFiles(P) {
  // Run from the workspace root without --full-name: git prints paths relative to it.
  const store = relative(P.workspaceRoot, P.store.root).split('\\').join('/') || '.';
  const r = spawnSync(
    'git',
    ['-C', P.workspaceRoot, 'ls-files', '-u', '-z', '--', store, '*.psig'],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) return [];
  /** @type {Set<string>} */
  const files = new Set();
  for (const rec of r.stdout.split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab > 0) files.add(rec.slice(tab + 1));
  }
  return [...files].sort();
}
