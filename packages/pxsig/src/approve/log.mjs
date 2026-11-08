/**
 * approve/log.mjs — `pxsig approve log` and `pxsig approve undo` (approve.mjs hands each its
 * context): the approvals by batch, and a batch's previous baselines put back.
 */
import { paths, readLog, record, sha256, traceLog, undo as undoBatch } from '../lib/approvals.mjs';
import { readReasons } from '../lib/decisions.mjs';
import { takeLock } from '../lib/lock.mjs';
import { ask, emit } from '../lib/term.mjs';
/** @import { LockHandle, ManifestEntry } from '../types.js' */
/** @import { UndoResult } from '../types/t2.js' */
/** @import { ApproveContext } from '../approve.mjs' */

/**
 * `pxsig approve log`: the approvals by batch; `--trace` adds the commit and the pull request.
 * @param {ApproveContext} cx
 */
export function logCommand(cx) {
  const { flags, format, P, fail } = cx;
  const log = readLog(P);
  // --trace (docs/cli.md): the commit that added a batch's lines and the PR that merged it, from
  // git. pxsig points at the trail; no log names a person (the commit and the PR say who).
  const trace = flags.trace ? traceLog(P) : null;
  if (flags.trace && !trace)
    fail('approve log --trace needs the approval log in a git repository', 2);
  /** @type {Map<string, { commits: Set<string>, prs: Set<string> }>} */
  const where = new Map();
  for (const t of trace ?? []) {
    const w = where.get(t.batch) ?? { commits: new Set(), prs: new Set() };
    w.commits.add(t.commit ?? 'not committed');
    if (t.pr) w.prs.add(`#${t.pr}`);
    where.set(t.batch, w);
  }
  // A reason stays on the machine where it was given (lib/decisions.mjs), found by any of the
  // batch's refs; a line written before 0.7.6 may still carry its own. A clean clone has none.
  const kept = readReasons(P);
  /** @type {Map<string, { batch: string, at: string, via: string, reason: string | null, n: number, commit?: string, pr?: string }>} */
  const batches = new Map();
  for (const l of log) {
    const b = batches.get(l.batch) ?? {
      batch: l.batch,
      at: l.at,
      via: l.via,
      reason: null,
      n: 0,
    };
    b.reason ??=
      (l.ref ? kept.get(l.ref) : undefined) ?? (typeof l.reason === 'string' ? l.reason : null);
    b.n++;
    batches.set(l.batch, b);
  }
  if (trace)
    for (const b of batches.values()) {
      const w = where.get(b.batch);
      b.commit = w ? [...w.commits].join(', ') : 'not committed';
      b.pr = w?.prs.size ? [...w.prs].join(', ') : '';
    }
  const rows = [...batches.values()].reverse().slice(0, Number(flags.limit) || 10);
  emit(
    format,
    [
      { h: 'Approvals', sub: `${log.length} entries in ${batches.size} batches` },
      rows.length
        ? {
            table: {
              cols: [
                { key: 'at', label: 'When' },
                { key: 'via', label: 'Via' },
                { key: 'n', label: 'Entries', right: true },
                ...(trace
                  ? [
                      { key: 'commit', label: 'Commit' },
                      { key: 'pr', label: 'PR' },
                    ]
                  : []),
                { key: 'reason', label: 'Reason' },
                { key: 'batch', label: 'Batch' },
              ],
              rows: rows.map((b) => ({
                ...b,
                at: b.at.replace('T', ' ').slice(0, 19),
                reason: b.reason ?? '',
              })),
            },
          }
        : { note: 'No approvals logged yet.' },
    ],
    rows
  );
  return;
}

/**
 * `pxsig approve undo <batch>`: restore the baselines a batch replaced (a person, typed confirm).
 * @param {ApproveContext} cx
 */
export async function undoCommand(cx) {
  const { args, format, P, fail, run, manifest, byId, needHuman } = cx;
  needHuman('approve undo');
  const batch = args[0] ?? fail('usage: approve undo <batch>  (see `approve log`)');
  const typed = await ask(
    `Restore the baselines batch ${batch} replaced? Type "UNDO" to continue: `
  );
  if (typed !== 'UNDO') fail('not confirmed: nothing was restored', 1);
  let lock;
  try {
    lock = await takeLock(P, { holder: 'approve undo' });
    lock.check();
  } catch (e) {
    // takeLock throws Errors: a LockError (with `exit` when it needs a person), or the fs error.
    fail(
      `${/** @type {Error} */ (e).message}. Undo writes baselines, so it needs the store to itself.`,
      /** @type {{ exit?: number }} */ (e).exit ?? 2
    );
  }
  const before = new Map(manifest.stories.map((e) => [e.id, sha256(paths(P, e).sig)]));
  let res;
  try {
    res = undoBatch(P, manifest, batch);
  } catch (e) {
    /** @type {LockHandle} */ (lock).release();
    // undo throws Errors (no snapshot, no log line, an fs error).
    fail(/** @type {Error} */ (e).message, 2);
  }
  // `fail` exits (it never returns), which TypeScript cannot see through a destructured
  // parameter: past the two `try`s, `lock` and `res` are set, and the casts say so.
  for (const id of [
    .../** @type {UndoResult} */ (res).restored,
    .../** @type {UndoResult} */ (res).removed,
  ])
    // Ids undo restored or removed come from the manifest (`undo` refuses any other).
    record(P, /** @type {ManifestEntry} */ (byId.get(id)), {
      batch: `${batch}-undo`,
      via: 'undo',
      undo: {
        in: 'terminal',
        from: /** @type {UndoResult} */ (res).source === 'git' ? 'git' : 'snapshot',
      },
      before: before.get(id) ?? null,
    });
  /** @type {LockHandle} */ (lock).release();
  if (/** @type {UndoResult} */ (res).restored.length)
    await run('check', { ids: /** @type {UndoResult} */ (res).restored }).catch(() => null);
  emit(
    format,
    [
      {
        h: 'Restored',
        sub: `${/** @type {UndoResult} */ (res).restored.length} baselines from ${batch} (${/** @type {UndoResult} */ (res).source === 'git' ? 'git history' : 'local snapshot'})${/** @type {UndoResult} */ (res).removed.length ? ` · ${/** @type {UndoResult} */ (res).removed.length} first baselines moved to trash/` : ''}`,
      },
      /** @type {UndoResult} */ (res).refused.length
        ? { h: 'Refused' }
        : {
            note: /** @type {UndoResult} */ (res).restored.length
              ? 'Re-checked against the restored baselines.'
              : 'Nothing to re-check.',
          },
      /** @type {UndoResult} */ (res).refused.length
        ? { list: /** @type {UndoResult} */ (res).refused.map((r) => `${r.id} — ${r.why}`) }
        : {},
    ],
    res
  );
  if (/** @type {UndoResult} */ (res).refused.length) process.exit(1);
  return;
}
