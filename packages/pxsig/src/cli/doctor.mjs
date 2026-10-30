/**
 * cli/doctor.mjs — `pxsig doctor`'s report for one project (`doctorOne`), and the two parts other
 * commands share: warn mode for a gated command (`gate`) and the entries table (`entryTable`).
 */
import { doctor } from '../tools/index.mjs';
import { CODES } from '../lib/integrity.mjs';
import { describeLock, readLock, takeLock } from '../lib/lock.mjs';
import { ask, progress, stateCell } from '../lib/term.mjs';
import { describeAgent } from '../lib/agents.mjs';
import { preflightReport } from './preflight.mjs';
import {
  appendReadiness,
  describeEnforcement,
  lastLine,
  leadLine,
  outcome,
  readinessTally,
  reportBlock,
  resolveEnforcement,
  resolveOrExit,
} from '../lib/enforcement.mjs';

/** @import { LockHandle } from '../types.js' */
/** @import { BriefEntry, Block, Cell, CliError, DoctorResult, Finding, Rendered, StyledCell } from '../types/t6.js' */
/** @import { CliContext } from './context.mjs' */
/** @import { Preflight } from '../tools/preflight.mjs' */

/** @param {CliContext} cli */
export function doctorParts(cli) {
  const { flags, format, CMD, ctx, idCell, pct } = cli;
  /** @type {CliContext['fail']} */
  const fail = cli.fail;

  /**
   * Warn mode for a gated command (lib/enforcement.mjs): `found` is what each gate would fail on.
   * Returns the exit, the ADVISORY lead and last lines as blocks to put around the output, and the
   * `enforcement` data, and appends the readiness line when a gate is on warn by config.
   * @param {Finding[]} found
   * @param {string} source
   * @param {Record<string, number>} [counts]
   * @returns {{ exit: number, advisory: boolean, lead: Block[], last: Block[], data: object }}
   */
  function gate(found, source, counts = {}) {
    const P = ctx().P;
    const enf = resolveOrExit(P, { flags }, (m, code) => fail(m, code));
    const out = outcome(enf, found);
    appendReadiness(P, enf, out, { source, counts });
    const lead = leadLine(enf);
    const last = lastLine(enf, out, enf.configured.length ? readinessTally(P) : null);
    const block = reportBlock(enf, out);
    return {
      exit: out.exit,
      advisory: out.advisory,
      lead: lead ? [{ note: lead, tone: 'warn' }] : [],
      last: last ? [{ note: last, tone: out.advisory ? 'warn' : undefined }] : [],
      data: block ? { enforcement: block } : {},
    };
  }

  /**
   * The entries table every listing shares.
   * @param {BriefEntry[]} entries
   * @param {{ more?: number }} [opts]
   * @returns {Block}
   */
  function entryTable(entries, { more = 0 } = {}) {
    return {
      table: {
        cols: [
          { key: 'state', label: 'State' },
          { key: 'id', label: 'Entry' },
          { key: 'ssim', label: 'SSIM', right: true },
          { key: 'cells', label: 'Cells', right: true },
          { key: 'why', label: 'Why' },
        ],
        moreHint: 'raise --limit',
        rows: entries.map((e) => ({
          state: stateCell(e.state),
          id: idCell(e.id),
          ssim: e.ssim ?? '',
          cells: pct(e.changedCellsPct),
          why: e.error ?? (e.reasons ?? [])[0] ?? '',
        })),
        more,
      },
    };
  }

  /**
   * One project's doctor: reconcile (and plan or apply repairs), as blocks.
   * @param {{ repair: 'none' | 'plan' | 'apply', only: string[], failOn: string }} opts
   * @returns {Promise<Rendered>}
   */
  async function doctorOne({ repair, only, failOn }) {
    const spin = progress(format, repair === 'apply' ? 'repairing' : 'reconciling');
    /** @type {Awaited<ReturnType<typeof doctor>> | undefined} */
    let r;
    /** @type {LockHandle | null} */
    let lock = null;
    /** @type {string | null} */
    let viaServer = null;
    if (repair === 'apply') {
      const P = ctx().P;
      const held = readLock(P);
      if (held && !held.stale && held.holder === 'serve' && !held.foreign) {
        if (flags.prune)
          fail(
            `${describeLock(P, held)}: --prune moves files, so it cannot run beside the server; stop it first`
          );
        if (only.includes('log-torn'))
          fail(
            `${describeLock(P, held)}: the server appends to the approval log, so --only log-torn cannot run beside it; stop it first`
          );
        viaServer = held.url ?? ctx().serverUrl;
      } else
        try {
          lock = await takeLock(P, { holder: 'doctor --repair' });
          lock.check();
        } catch (e) {
          spin.done(/** @type {Error} */ (e).message, false);
          fail(/** @type {Error} */ (e).message, /** @type {CliError} */ (e).exit ?? 2);
        }
    }
    try {
      if (viaServer) {
        // The server holds the store: its queue runs the repairs; then reconcile here to report.
        const res = await fetch(`${viaServer}/__pxsig/repair`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            project: cli.current,
            apply: true,
            only: only.length ? only : undefined,
            stale: !!flags.stale,
          }),
        });
        // `POST /__pxsig/repair`'s answer (docs/server.md): the plan and the result, or `error`.
        const body =
          /** @type {{ plan?: DoctorResult['plan'], applied?: DoctorResult['applied'], error?: string }} */ (
            await res.json().catch(() => ({}))
          );
        if (!res.ok)
          throw new Error(body.error ?? `the server refused the repair (HTTP ${res.status})`);
        r = {
          ...(await doctor({
            project: cli.current,
            component: typeof flags.component === 'string' ? flags.component : undefined,
            status: typeof flags.status === 'string' ? flags.status : undefined,
            limit: Number(flags.limit) || 40,
            offline: !!flags.offline,
          })),
          plan: body.plan,
          applied: body.applied,
        };
      } else
        r = await doctor({
          project: cli.current,
          component: typeof flags.component === 'string' ? flags.component : undefined,
          status: typeof flags.status === 'string' ? flags.status : undefined,
          limit: Number(flags.limit) || 40,
          repair,
          only: only.length ? only : undefined,
          offline: !!flags.offline,
          stale: !!flags.stale,
          via: 'cli',
          prune: !!flags.prune,
          confirmPrune: flags.prune
            ? async (n) => {
                const phrase = `PRUNE ${n} ORPHANS`;
                return (
                  (await ask(
                    `Move ${n} orphaned entries' files to the store trash// (nothing is deleted). Type "${phrase}" to continue: `
                  )) === phrase
                );
              }
            : null,
          confirmTorn: only.includes('log-torn')
            ? async (n) => {
                const phrase = `REMOVE ${n} TORN LINES`;
                return (
                  (await ask(
                    `Remove ${n} approval-log line(s) a crash cut short (every complete line is kept). Type "${phrase}" to continue: `
                  )) === phrase
                );
              }
            : null,
        });
    } catch (e) {
      const pf = /** @type {{ detail?: { preflight?: Preflight } }} */ (e).detail?.preflight;
      // No manifest yet: the setup preflight, the error once, the next step (exit 2).
      if (pf) {
        spin.done('no manifest yet', false);
        return preflightReport(/** @type {Error} */ (e).message, pf, CMD);
      }
      spin.done(/** @type {Error} */ (e).message, false);
      fail(/** @type {Error} */ (e).message, 2);
    } finally {
      lock?.release();
    }
    const sm = r.summary;
    spin.done(sm.headline, sm.status !== 'attention');
    const ix = r.sources.storyIndex;
    /**
     * @param {string} code
     * @param {string} severity
     * @returns {StyledCell}
     */
    const sevCell = (code, severity) => ({
      text: `${severity === 'error' ? '✗' : severity === 'warn' ? '◆' : code === 'ok' ? '✓' : '·'} ${code}`,
      color:
        severity === 'error'
          ? 'red'
          : severity === 'warn'
            ? 'yellow'
            : code === 'ok'
              ? 'green'
              : 'gray',
    });
    /** @param {Record<string, number>} counts every key is a status code */
    const issueText = (counts) =>
      Object.entries(counts)
        .sort(
          (a, b) =>
            /** @type {Record<string, { rank: number }>} */ (CODES)[a[0]].rank -
            /** @type {Record<string, { rank: number }>} */ (CODES)[b[0]].rank
        )
        .map(([c, n]) => `${n} ${c}`)
        .join(', ');
    /** @type {Block[]} */
    const blocks = [
      {
        h: 'pxsig doctor',
        sub: `${sm.components} components · ${sm.entries} entries · index: ${ix.source === 'storybook' ? 'Storybook (live)' : `static scan (${ix.reachable ? 'Storybook index broken' : 'Storybook not reachable'})`} · ${ix.inScope} stories in scope`,
      },
      {
        note: sm.headline,
        tone: sm.status === 'attention' ? 'bad' : sm.status === 'warnings' ? 'warn' : 'ok',
      },
      ...r.setup.map(
        /** @returns {Block} */ (x) => ({
          note: `setup: ${x.code} — ${x.reason}`,
          tone: x.severity === 'error' ? 'bad' : 'warn',
        })
      ),
      {
        kv: [
          [
            'Entries',
            [
              { text: `${sm.bySeverity.error} error`, color: sm.bySeverity.error ? 'red' : 'gray' },
              { text: `${sm.bySeverity.warn} warn`, color: sm.bySeverity.warn ? 'yellow' : 'gray' },
              { text: `${sm.bySeverity.info} info`, color: 'gray' },
            ],
          ],
          ['Codes', issueText(sm.byCode) || 'none'],
          [
            'Report',
            r.sources.report.missing
              ? { text: 'missing', color: 'red' }
              : `${r.sources.report.rows} rows · full check ${r.sources.report.generatedAt}`,
          ],
          [
            'Freshness',
            `${r.sources.staleness.method} · ${r.sources.staleness.filesTraced} edited files traced`,
          ],
          ['Ledger', r.ledgerPath],
          ...(r.machine
            ? /** @type {[string, Cell][]} */ ([
                [
                  'Settings',
                  r.machine.setUp
                    ? r.machine.settings
                    : { text: `${r.machine.settings} (not set up)`, color: 'gray' },
                ],
                ['Token files', r.machine.tokens],
              ])
            : []),
          [
            'Running under',
            r.agent ? describeAgent(r.agent) : { text: 'no agent marker', color: 'gray' },
          ],
          // Warn mode, only when the config (or this run's --warn / --enforce) sets it.
          ...(() => {
            try {
              const P = ctx().P;
              const enf = resolveEnforcement(P, { flags });
              return P.config.enforcement != null || enf.configured.length || flags.enforce
                ? [['Enforcement', describeEnforcement(enf)]]
                : [];
            } catch (e) {
              return [['Enforcement', { text: /** @type {Error} */ (e).message, color: 'red' }]];
            }
          })(),
        ],
      },
    ];
    if (r.components.total) {
      blocks.push({
        h: flags.component || flags.status ? 'Components' : 'Components needing attention',
      });
      blocks.push({
        table: {
          cols: [
            { key: 'st', label: 'Status' },
            { key: 'c', label: 'Component' },
            { key: 'n', label: 'Entries', right: true },
            { key: 'why', label: 'Issues' },
          ],
          rows: r.components.list.map(
            (/** @type {DoctorResult['components']['list'][number]} */ c) => ({
              st: sevCell(c.status, c.severity),
              c: c.component,
              n: c.entries,
              why: issueText(c.counts),
            })
          ),
          more: r.components.total - r.components.shown,
          moreHint: 'raise --limit',
        },
      });
    } else blocks.push({ note: 'Every component is clean.', tone: 'ok' });
    if (
      r.entries.total &&
      (flags.component ||
        flags.status ||
        r.entries.list.some(
          (/** @type {DoctorResult['entries']['list'][number]} */ x) => x.severity === 'error'
        ))
    ) {
      const list =
        flags.component || flags.status
          ? r.entries.list
          : r.entries.list.filter(
              (/** @type {DoctorResult['entries']['list'][number]} */ x) => x.severity === 'error'
            );
      blocks.push({ h: 'Entries' });
      blocks.push({
        table: {
          cols: [
            { key: 'st', label: 'Status' },
            { key: 'id', label: 'Entry' },
            { key: 'why', label: 'Why' },
          ],
          rows: list.map((/** @type {DoctorResult['entries']['list'][number]} */ x) => ({
            st: sevCell(x.status, x.severity),
            id: x.id,
            why:
              x.issues.find(
                (/** @type {DoctorResult['entries']['list'][number]['issues'][number]} */ i) =>
                  i.code === x.status
              )?.reason ?? '',
          })),
          more: (flags.component || flags.status ? r.entries.total : list.length) - list.length,
          moreHint: 'filter with --component / --status, or raise --limit',
        },
      });
    }
    if (r.plan) {
      blocks.push({
        h: repair === 'apply' ? 'Repairs' : 'Repair plan (dry run)',
        sub: 'never writes signatures, never approves',
      });
      if (!r.plan.steps.length)
        blocks.push({ note: 'Nothing to repair automatically.', tone: 'ok' });
      else
        blocks.push({
          table: {
            cols: [
              { key: 'a', label: 'Step' },
              { key: 'n', label: 'Entries', right: true },
              { key: 'r', label: repair === 'apply' ? 'Result' : 'What it does' },
            ],
            rows: r.plan.steps.map((st, i) => ({
              a: st.action,
              n: st.ids.length,
              r:
                repair === 'apply'
                  ? (r.applied?.[i]?.result ?? '')
                  : st.blocked
                    ? { text: `blocked: ${st.blocked}`, color: 'yellow' }
                    : st.why,
            })),
          },
        });
      if (r.plan.manual.length) {
        blocks.push({ h: 'Needs a person' });
        blocks.push({ list: r.plan.manual.map((m) => `${m.count} ${m.code} — ${m.what}`) });
      }
    }
    /** @type {[string, string][]} */
    const next = [];
    if (repair === 'none' && sm.status !== 'clean')
      next.push([`${CMD} doctor --repair`, 'the safe repairs, as a dry-run plan']);
    if (repair === 'plan' && r.plan?.steps.some((x) => !x.blocked))
      next.push([
        `${CMD} doctor --repair --apply`,
        'run them (add --only register to sync the manifest only)',
      ]);
    if (!flags.component && r.components.list[0])
      next.push([
        `${CMD} doctor --component ${r.components.list[0].component.split('/').pop()}`,
        'every entry of one component',
      ]);
    blocks.push({ next });
    // --fail-on: error → errors; warn → errors + warnings; info → also info findings, never ok / excluded / drift.
    const findings = {
      error: sm.bySeverity.error,
      warn: sm.bySeverity.warn,
      info: sm.infoFindings ?? 0,
    };
    /** @type {Record<string, number>} */
    const rank = { error: 0, warn: 1, info: 2 };
    const over = Object.entries(findings)
      .filter(([k]) => rank[k] <= rank[failOn])
      .reduce((n, [, c]) => n + c, 0);
    // A setup error is never warned (exit 2 in every mode); findings at or above --fail-on are the doctor gate.
    const g = gate(
      [
        ...(r.setup.some((x) => x.severity === 'error')
          ? [
              {
                gate: null,
                exit: 2,
                count: r.setup.filter((x) => x.severity === 'error').length,
                what: 'setup errors',
              },
            ]
          : []),
        {
          gate: 'doctor',
          exit: over ? 1 : 0,
          count: over,
          what: `findings at or above --fail-on ${failOn}`,
        },
      ],
      'doctor',
      { doctor: over }
    );
    return {
      blocks: [...g.lead, ...blocks, ...g.last],
      data: { ...r, ...g.data },
      exit: g.exit,
      advisory: g.advisory,
    };
  }
  return { gate, entryTable, doctorOne };
}
