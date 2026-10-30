/**
 * cli/a11y-prune.mjs — `pxsig a11y --prune [--dry-run]`.
 */
import { dirname, join } from 'node:path';
import { prunePlan } from '../mcp.mjs';
import { readLock, takeLock } from '../lib/lock.mjs';
import { readToken, TOKEN_HEADER } from '../lib/guard.mjs';
import { ask, emit, humanAtTerminal, progress, whyNotPerson } from '../lib/term.mjs';
import { relPath } from '../lib/paths.mjs';
import { applyPrune, confirmPrune } from '../lib/prune.mjs';
import { newBatch } from '../lib/approvals.mjs';

/** @import { LockHandle } from '../types.js' */
/** @import { Block } from '../types/t6.js' */
/** @import { CliContext } from './context.mjs' */

/** @param {CliContext} cli */
export function a11yPruneParts(cli) {
  const { flags, format, CMD, ctx, list, oneProject } = cli;
  /** @type {CliContext['fail']} */
  const fail = cli.fail;

  /**
   * `pxsig a11y --prune [--dry-run]` (lib/prune.mjs, PHASE-1 §5): the dry run is for anyone, agents
   * included, and always exits 0; removing rules is a person's, at a terminal, after typing the
   * count. Through the server when it holds the store, so the dashboard updates; else under the lock.
   */
  async function a11yPrune() {
    cli.current = oneProject();
    const dry = !!flags['dry-run'];
    if (!dry && !humanAtTerminal())
      fail(
        `a11y --prune changes the accepted lists: run it yourself in a terminal (${whyNotPerson()}); \`${CMD} a11y --prune --dry-run\` lists what it would remove`,
        3
      );
    const spin = progress(format, 'classifying accepted rules');
    let plan;
    try {
      plan = await prunePlan({
        project: cli.current,
        component: typeof flags.component === 'string' ? flags.component : undefined,
        mode: typeof flags.mode === 'string' ? flags.mode : undefined,
        only: list(flags.only),
        cmd: CMD,
      });
    } catch (e) {
      spin.done(/** @type {Error} */ (e).message, false);
      fail(/** @type {Error} */ (e).message, 2);
    }
    const c = plan.counts;
    const n = c.prunable;
    spin.done(`${n} prunable of ${plan.items.length} accepted rules`);
    /** @type {Block[]} */
    const blocks = [
      {
        h: dry ? 'Accessibility prune (dry run)' : 'Accessibility prune',
        sub: `${plan.items.length} accepted rules on ${plan.entries} entries`,
      },
      {
        kv: [
          [
            'Prunable',
            { text: `${n} rules on ${plan.prune.length} entries`, color: n ? 'green' : 'gray' },
          ],
          ['Still fires', String(c['still-fires'])],
          ['Stale', { text: String(c.stale), color: c.stale ? 'yellow' : 'gray' }],
          [
            'Not covered',
            { text: String(c['not-covered']), color: c['not-covered'] ? 'yellow' : 'gray' },
          ],
          ['Reports', plan.reports.map((r) => `${r.file} (${r.rows} rows)`).join(', ') || 'none'],
        ],
      },
    ];
    if (plan.prune.length)
      blocks.push({
        table: {
          cols: [
            { key: 'id', label: 'Entry' },
            { key: 'rules', label: 'Rules no longer firing' },
            { key: 'at', label: 'Checked' },
          ],
          rows: plan.prune.slice(0, 60).map((p) => ({
            id: p.id,
            rules: p.rules.join(', '),
            at: p.evidence.checkedAt?.replace('T', ' ').slice(0, 19) ?? '',
          })),
          more: Math.max(0, plan.prune.length - 60),
          moreHint: 'every rule, with why, in --json',
        },
      });
    /** @type {[string, string][]} */
    const next = plan.cover.map((x) => [
      x.command,
      `${x.entries} entries ${x.class === 'stale' ? 'checked before a later edit or decision' : 'with no row where axe ran'}: check them, then prune again`,
    ]);
    if (dry || !n) {
      if (!n) blocks.push({ note: 'Nothing to prune.', tone: 'ok' });
      if (dry && n)
        next.unshift([
          `${CMD} a11y --prune`,
          `a person, in a terminal: remove the ${n} prunable rules`,
        ]);
      blocks.push({ next });
      emit(format, blocks, plan);
      process.exit(0);
    }
    emit(format, blocks, plan);
    if (!(await confirmPrune(plan, ask))) fail('not confirmed: nothing was written', 1);
    const reason =
      typeof flags.reason === 'string' ? flags.reason.trim().slice(0, 500) || null : null;
    const batch = newBatch('prune');
    const P = ctx().P;
    const held = readLock(P);
    /** @type {{ rules: number, entries: number } | undefined} */
    let r;
    if (held && !held.stale && held.holder === 'serve' && !held.foreign) {
      // The server holds the store: it writes, and the dashboard hears of it.
      const url = held.url ?? ctx().serverUrl;
      const token = readToken(P.workspaceRoot, url);
      if (!token)
        fail(
          `no token from the pxsig server at ${url} (it writes one when it starts): restart \`${CMD} serve\` with this version`
        );
      const res = await fetch(`${url}/__pxsig/a11y-prune`, {
        method: 'POST',
        // Checked above: `fail` exits when there is none.
        headers: {
          'content-type': 'application/json',
          [TOKEN_HEADER]: token,
        },
        body: JSON.stringify({
          project: P.name,
          plan: { a11ySha: plan.a11ySha, prune: plan.prune },
          batch,
          reason,
        }),
      }).catch((e) => ({
        ok: false,
        status: 0,
        json: async () => ({ error: /** @type {Error} */ (e).message }),
      }));
      // The server's answer: the prune's counts, or `error`.
      const body = /** @type {{ rules: number, entries: number, error?: string }} */ (
        await res.json().catch(() => ({}))
      );
      if (!res.ok)
        fail(
          `the server refused the prune: ${body.error ?? `HTTP ${res.status}`}`,
          res.status === 409 ? 1 : 2
        );
      r = body;
    } else {
      /** @type {LockHandle | undefined} */
      let lock;
      /** @type {(Error & { exit?: number, status?: number }) | null} */
      let err = null;
      try {
        lock = await takeLock(P, { holder: 'a11y --prune' });
        // `lock` is set on the line above, before the prune can call this.
        r = applyPrune(P, plan, {
          batch,
          reason,
          via: 'cli',
          lockCheck: () => /** @type {LockHandle} */ (lock).check(),
        });
      } catch (e) {
        // what takeLock and applyPrune throw: an Error, some with an exit code or an HTTP status
        err = /** @type {Error & { exit?: number, status?: number }} */ (e);
      } finally {
        lock?.release();
      }
      // A plan made stale by a decision since is refused whole: plan again (exit 1, as a wrong phrase).
      if (err) fail(err.message, err.exit ?? (err.status === 409 ? 1 : 2));
    }
    // `r` is set in both branches above; a failure has exited.
    emit(
      format,
      [
        {
          h: 'Pruned',
          sub: `${/** @type {{ rules: number }} */ (r).rules} rules from ${/** @type {{ entries: number }} */ (r).entries} entries`,
        },
        {
          kv: [
            ['Batch', batch],
            ['Log', relPath(process.cwd(), join(dirname(P.store.a11y), 'a11y-decisions.ndjson'))],
          ],
        },
        { next: [[`${CMD} a11y`, 'the violations, against the shorter lists'], ...next] },
      ],
      {
        batch,
        entries: /** @type {{ entries: number }} */ (r).entries,
        rules: /** @type {{ rules: number }} */ (r).rules,
      }
    );
  }
  return { a11yPrune };
}
