/**
 * cli/check.mjs — `check`, `affected`, `a11y`, `history`.
 */
import { spawnSync } from '../lib/spawn.mjs';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { doctor } from '../tools/index.mjs';
import { emit, progress, stateCell } from '../lib/term.mjs';
import { relPath } from '../lib/paths.mjs';
import { writeSarif } from '../lib/sarif.mjs';
import { doctorParts } from './doctor.mjs';
import { a11yPruneParts } from './a11y-prune.mjs';

/** @import { Manifest } from '../types.js' */
/** @import { Block, CheckReport, ServerStatusReply, ToolOutput } from '../types/t6.js' */
/** @import { CliContext } from './context.mjs' */

/** @param {CliContext} cli */
export function checkCommands(cli) {
  const {
    flags,
    format,
    rest,
    CMD,
    here,
    project,
    run,
    ctx,
    list,
    idCell,
    needValues,
    overProjects,
    oneProject,
  } = cli;
  /** @type {CliContext['fail']} */
  const fail = cli.fail;
  const { gate, entryTable } = doctorParts(cli);
  const { a11yPrune } = a11yPruneParts(cli);

  return {
    async check() {
      // The full check (render everything selected, suites, --update) runs check.mjs itself.
      if (flags.full || flags.update || flags.suite || flags.modes) {
        const pass = process.argv
          .slice(3)
          .filter(
            (a) => a !== '--full' && !['--json', '--plain', '--pretty', '--markdown'].includes(a)
          );
        if (!project) pass.push('--project', oneProject());
        const r = spawnSync(process.execPath, [join(here, 'check.mjs'), ...pass], {
          stdio: 'inherit',
        });
        process.exit(r.status ?? 2);
      }
      cli.current = oneProject();
      const args = {
        ids: rest,
        changed_files: list(flags.changed),
        since: typeof flags.since === 'string' ? flags.since : undefined,
        all: !!flags.all,
      };
      if (!args.ids.length && !args.changed_files.length && !args.since && !args.all)
        fail(`usage: check <ids…> | --changed a,b | --since <ref> | --all`);
      const spin = progress(format, 'checking');
      // The server queue is the only progress signal; poll it for the spinner's text.
      const poll = setInterval(async () => {
        try {
          // the server's status answer
          const s = /** @type {ServerStatusReply} */ (
            await (
              await fetch(`${ctx().serverUrl}/__pxsig/status`, {
                signal: AbortSignal.timeout(1000),
              })
            ).json()
          );
          spin.update(s.running ? `checking · ${s.queued ?? 0} queued` : 'checking');
        } catch {}
      }, 700);
      let r;
      try {
        r = await run('check', args);
      } catch (e) {
        clearInterval(poll);
        spin.done(/** @type {Error} */ (e).message, false);
        process.exit(2);
      }
      clearInterval(poll);
      // a timed-out answer carries its note
      if (r.timedOut)
        return (spin.done('still running', false), fail(/** @type {string} */ (r.note), 2));
      const problems = r.problems ?? [];
      const errs = problems.filter((p) => p.state === 'error');
      spin.done(`checked ${r.checked ?? 0} entries via ${r.via ?? '—'}`, !errs.length);
      const counts = Object.entries(r.counts ?? {}).map(([k, n]) => ({
        ...stateCell(k),
        text: `${stateCell(k).text} ${n}`,
      }));
      /** @type {Block[]} */
      const blocks = [
        { h: 'Check', sub: `${r.checked ?? 0} entries · ${r.seconds ?? '?'} s · ${r.via ?? ''}` },
        { kv: [['States', counts.length ? counts : 'nothing selected']] },
      ];
      if (errs.length && errs.every((p) => /ERR_CONNECTION_REFUSED/.test(p.error ?? '')))
        blocks.push({
          note: 'Storybook is not running, so nothing rendered: start the project Storybook (storybook.url in pxsig.config.json)',
          tone: 'bad',
        });
      if (problems.length)
        blocks.push(entryTable(problems.slice(0, 40), { more: Math.max(0, problems.length - 40) }));
      if (r.registered?.length)
        blocks.push({
          note: `registered ${r.registered.length} NEW entries (no signature: approve their first render in the dashboard)`,
          tone: 'warn',
        });
      for (const x of r.skipped ?? [])
        blocks.push({ note: `not checked: ${x.name}: ${x.why}`, tone: 'bad' });
      // Integrity: what this run could not cover, in one line.
      let ledger = null;
      try {
        ledger = await doctor({ limit: 0 });
        blocks.push({
          note: `integrity: ${ledger.summary.headline}`,
          tone: ledger.summary.status === 'attention' ? 'bad' : 'ok',
        });
      } catch {}
      /** @type {[string, string][]} */
      const next = [];
      if (problems.length) next.push([`${CMD} entry ${problems[0].id}`, 'see what changed']);
      if (ledger?.summary.status === 'attention')
        next.push([`${CMD} doctor`, 'per-component integrity']);
      blocks.push({ next });
      // Warn mode: the visual gate on the problems, the a11y gate on the entries with new violations.
      const a11yNew = r.a11yNew ?? 0;
      const g = gate(
        [
          ...(!r.checked && r.skipped?.length
            ? [{ gate: null, exit: 2, count: r.skipped.length, what: 'names not checked' }]
            : []),
          {
            gate: 'visual',
            exit: problems.length ? 1 : 0,
            count: problems.length,
            what: 'not passing',
          },
          {
            gate: 'a11y',
            exit: a11yNew ? 1 : 0,
            count: a11yNew,
            what:
              a11yNew === 1 ? 'entry with new a11y violations' : 'entries with new a11y violations',
          },
        ],
        'check',
        { changed: problems.length, a11yNew }
      );
      emit(format, [...g.lead, ...blocks, ...g.last], {
        ...r,
        integrity: ledger?.summary ?? null,
        ...g.data,
      });
      // Nothing checked because every name was skipped: a selection error, like an empty one.
      process.exit(g.exit);
    },

    async affected() {
      cli.current = oneProject();
      const since = typeof flags.since === 'string' ? flags.since : undefined;
      if (!rest.length && !since) fail('usage: affected <files…> | --since <ref>');
      const files = rest.map((f) => relPath(ctx().root, resolve(f)));
      const r = await run('affected', since ? { since } : { files });
      /** @type {Block[]} */
      const blocks = [{ h: 'Affected', sub: `${r.entries} entries · ${r.reason}` }];
      // The fail-safe: what the selection cannot trace selects every entry. Each `outside` path is a
      // candidate for affects.ignore (docs/ci.md, "How selection decides").
      if (r.failSafe?.length)
        blocks.push(
          { h: 'Every entry selected because of', sub: `${r.failSafe.length} paths` },
          { list: r.failSafe.slice(0, 10).map((f) => `${f.why} (${f.class})`) },
          ...(r.failSafe.length > 10
            ? [{ note: `…${r.failSafe.length - 10} more in --json` }]
            : []),
          { note: 'A path that never changes a render can go in affects.ignore.' }
        );
      else
        blocks.push(
          { list: r.ids.slice(0, 40).map(idCell) },
          ...(r.ids.length > 40 ? [{ note: `…${r.ids.length - 40} more` }] : [])
        );
      for (const [s, n] of Object.entries(r.otherSuites ?? {}))
        blocks.push({ note: `${n} changed entries are in suite ${s}: pxsig check --suite ${s}` });
      // Unresolved imports add the entries that reach them to every run (decision 6.1d).
      const costly = (r.unresolved ?? []).filter((u) => !u.accepted && u.selects !== 'none');
      if (costly.length)
        blocks.push(
          { h: 'Checked on every run: unresolved imports', sub: `${costly.length} imports` },
          {
            list: costly
              .slice(0, 10)
              .map(
                (u) =>
                  `${u.file}:${u.line} \`${u.spec}\` (${u.why}) → ${u.selects === 'all' ? 'every entry' : `${u.n} entries`}`
              ),
          },
          ...(costly.length > 10 ? [{ note: `…${costly.length - 10} more in --json` }] : []),
          {
            note: 'Map a bundler alias with affects.aliases, or accept the file with affects.unresolved.',
          }
        );
      // pxsig_affected answers `remote` as a count.
      if (r.remote > 0)
        blocks.push({
          note: `${r.remote} remote URLs are not followed (a full check covers them).`,
        });
      if (r.entries)
        blocks.push({
          next: [
            [
              `${CMD} check ${since ? `--since ${since}` : `--changed ${files.join(',')}`}`,
              're-check them',
            ],
          ],
        });
      emit(format, blocks, r);
    },

    a11y: () => {
      if (flags.prune) return a11yPrune();
      needValues(['component']);
      return overProjects(async () => {
        // Without prune_plan the tool lists violations.
        const r = /** @type {Extract<ToolOutput<'a11y'>, { byRule: unknown }>} */ (
          await run('a11y', {
            component: /** @type {string | undefined} */ (flags.component),
            only_new: !!flags.new,
            limit: Number(flags.limit) || 50,
          })
        );
        const rules = Object.entries(r.byRule ?? {}).sort((a, b) => b[1] - a[1]);
        /** @type {Block[]} */
        const blocks = [
          { h: flags.new ? 'New a11y violations' : 'a11y', sub: `${r.entries} entries` },
        ];
        // --sarif: the new violations of the last report, for SARIF viewers (decision 96).
        if (typeof flags.sarif === 'string') {
          const C = ctx();
          // the report and the manifest pxsig wrote
          const report = /** @type {CheckReport} */ (
            JSON.parse(readFileSync(join(C.P.store.reports, 'check.json'), 'utf8'))
          );
          const manifest = /** @type {Manifest} */ (
            JSON.parse(readFileSync(C.P.manifestPath(), 'utf8'))
          );
          const n = writeSarif(
            resolve(flags.sarif),
            report.rows.filter(
              (x) => !flags.component || x.id.includes(String(flags.component).toLowerCase())
            ),
            { entries: new Map(manifest.stories.map((e) => [e.id, e])) }
          );
          blocks.push({ note: `${n} new violations written to ${flags.sarif} (SARIF 2.1.0)` });
        }
        if (!r.entries) blocks.push({ note: 'No violations.', tone: 'ok' });
        else {
          blocks.push({
            table: {
              cols: [
                { key: 'rule', label: 'Rule' },
                { key: 'n', label: 'Entries', right: true },
              ],
              rows: rules.map(([rule, n]) => ({ rule, n })),
            },
          });
          blocks.push({
            list: r.list.map((e) => ({
              text: `${e.id} — ${(e.violations ?? []).map((v) => v.id ?? v).join(', ')}`,
            })),
          });
        }
        return { blocks, data: r };
      });
    },

    history: () =>
      overProjects(async () => {
        const r = await run('history', { limit: Number(flags.limit) || 10 });
        /** @type {Block[]} */
        const blocks = [
          { h: 'History', sub: `last ${r.runs.length} runs` },
          {
            table: {
              cols: [
                { key: 'at', label: 'When' },
                { key: 'n', label: 'Entries', right: true },
                { key: 'f', label: 'Changed', right: true },
                { key: 'ids', label: 'First changed' },
              ],
              rows: r.runs.reverse().map((h) => ({
                at: h.at?.replace('T', ' ').slice(0, 19),
                n: h.entries,
                f: h.failed ?? 0,
                ids: h.failedIds.slice(0, 2).join(', '),
              })),
            },
          },
        ];
        return { blocks, data: r };
      }),
  };
}
