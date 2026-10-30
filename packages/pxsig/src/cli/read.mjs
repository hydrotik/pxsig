/**
 * cli/read.mjs — the read commands: `status`, `stale`, `list`, `entry`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { imageOf } from '../mcp.mjs';
import { emit, stateCell } from '../lib/term.mjs';
import { doctorParts } from './doctor.mjs';

/** @import { Block, EngineMetrics, EntryDetail, ToolOutput } from '../types/t6.js' */
/** @import { CliContext } from './context.mjs' */

/** @param {CliContext} cli */
export function readCommands(cli) {
  const {
    flags,
    format,
    rest,
    CMD,
    project,
    run,
    ctx,
    list,
    inspectUrl,
    pct,
    needValues,
    overProjects,
    oneProject,
  } = cli;
  /** @type {CliContext['fail']} */
  const fail = cli.fail;
  const { gate, entryTable } = doctorParts(cli);

  return {
    status: () =>
      overProjects(async () => {
        const s = await run('status');
        const order = [
          'changed',
          'error',
          'flaky',
          'rejected',
          'approved',
          'drift',
          'pass',
          'skipped',
        ];
        const counts = order
          .filter((k) => s.counts[k])
          .map((k) => ({ ...stateCell(k), text: `${stateCell(k).text} ${s.counts[k]}` }));
        // A Date subtracts as its time value.
        const age = Math.round(
          (Date.now() -
            /** @type {number} */ (/** @type {unknown} */ (new Date(s.reportUpdated)))) /
            60000
        );
        /** @type {Block[]} */
        const blocks = [
          {
            h: 'pxsig',
            sub: `${s.entries} entries · ${s.modes?.join(' + ') ?? ''} · report ${age < 1 ? 'just now' : `${age} min ago`}`,
          },
          {
            kv: [
              ['States', counts],
              [
                'a11y',
                s.a11y.new
                  ? { text: `${s.a11y.violations} violations, ${s.a11y.new} new`, color: 'red' }
                  : `${s.a11y.violations} violations, none new`,
              ],
              [
                'Server',
                s.server.up
                  ? {
                      text: `up${s.server.running ? ', checking' : ''}${s.server.queued ? `, ${s.server.queued} queued` : ''} · ${s.server.dashboard}`,
                      color: 'green',
                    }
                  : { text: `down — ${s.server.hint ?? `start it: ${CMD} serve`}`, color: 'red' },
              ],
              [
                'Integrity',
                (() => {
                  const L = (() => {
                    try {
                      // the ledger pxsig doctor wrote (docs/integrity.md)
                      return /** @type {{ summary: { headline: string, status: string } }} */ (
                        JSON.parse(
                          readFileSync(join(ctx().P.store.reports, 'integrity.json'), 'utf8')
                        )
                      );
                    } catch {
                      return null;
                    }
                  })();
                  if (!L) return { text: `not computed — ${CMD} doctor`, color: 'yellow' };
                  return {
                    text: L.summary.headline,
                    color:
                      L.summary.status === 'attention'
                        ? 'red'
                        : L.summary.status === 'warnings'
                          ? 'yellow'
                          : 'green',
                  };
                })(),
              ],
              // Warn mode, only when the config chose it: the gates, the date, the readiness tally.
              ...(s.enforcement?.warned?.length
                ? [
                    [
                      'Warn mode',
                      {
                        text: `${s.enforcement.warned.join(', ')}${s.enforcement.warnUntil ? ` until ${s.enforcement.warnUntil}` : ''}${s.enforcement.readiness ? ` · would-fail runs ${s.enforcement.readiness.wouldFail} of ${s.enforcement.readiness.runs}${s.enforcement.readiness.main ? ` (${String(s.enforcement.readiness.main.branch)} ${s.enforcement.readiness.main.wouldFail} of ${s.enforcement.readiness.main.runs})` : ''}` : ''}`,
                        color: 'yellow',
                      },
                    ],
                  ]
                : []),
              [
                'Fresh',
                s.stale
                  ? {
                      text: `${s.stale.editedFiles.length} files edited since the report → ${s.stale.affectedEntries ?? '?'} entries not re-checked`,
                      color: 'yellow',
                    }
                  : { text: 'no edits since the report', color: 'green' },
              ],
            ],
          },
        ];
        if (s.mostChanged.length) {
          blocks.push({ h: 'Most changed' });
          blocks.push({
            table: {
              cols: [
                { key: 'c', label: 'Component' },
                { key: 'n', label: 'Entries', right: true },
              ],
              rows: s.mostChanged.slice(0, 8).map((m) => ({ c: m.component, n: m.n })),
              more: Math.max(0, s.mostChanged.length - 8),
            },
          });
        }
        /** @type {[string, string][]} */
        const next = [];
        if (s.stale)
          next.push([
            `${CMD} check --changed ${s.stale.editedFiles.slice(0, 3).join(',')}${s.stale.editedFiles.length > 3 ? ',…' : ''}`,
            're-check what the edits affect',
          ]);
        if (s.problems) next.push([`${CMD} list`, `the ${s.problems} entries needing review`]);
        if (s.a11y.new) next.push([`${CMD} a11y --new`, 'new accessibility violations']);
        blocks.push({ next });
        return { blocks, data: s };
      }),

    stale: () =>
      overProjects(async () => {
        const answer = await run('stale', { limit: Number(flags.limit) || 200 });
        // Too many edits to trace one by one: freshness is unknown, so not clean.
        if ('tooMany' in answer && answer.tooMany) {
          const g = gate(
            [
              {
                gate: 'stale',
                exit: 1,
                count: answer.tooMany,
                what: 'source files edited since the oldest verdict, too many to trace',
              },
            ],
            'stale',
            { tooMany: answer.tooMany }
          );
          return {
            blocks: [
              ...g.lead,
              { h: 'Freshness', sub: 'not traced' },
              {
                note: `${answer.tooMany} source files edited since the oldest verdict (${answer.oldestVerdict ?? 'unknown'}): too many to trace one by one`,
                tone: 'warn',
              },
              { next: [[`${CMD} check --all`, 're-check every entry']] },
              ...g.last,
            ],
            data: { ...answer, ...g.data },
            exit: g.exit,
            advisory: g.advisory,
          };
        }
        const s = /** @type {Extract<ToolOutput<'stale'>, { of: number }>} */ (answer);
        const bad = s.stale + s.inconsistent;
        /** @type {Block[]} */
        const blocks = [
          { h: 'Freshness', sub: `${s.of} entries` },
          {
            note: bad
              ? `${s.stale} stale · ${s.inconsistent} inconsistent — these verdicts predate edits that can change them`
              : 'Every result is newer than the edits that can change it.',
            tone: bad ? 'warn' : 'ok',
          },
        ];
        if (Object.keys(s.byFile ?? {}).length)
          blocks.push({
            table: {
              cols: [
                { key: 'f', label: 'Edited file' },
                { key: 'n', label: 'Entries', right: true },
              ],
              rows: Object.entries(s.byFile).map(([f, n]) => ({
                f,
                n: Array.isArray(n) ? n.length : n,
              })),
            },
          });
        if (bad)
          blocks.push({
            next: [
              [
                `${CMD} check ${s.ids.slice(0, 3).join(' ')}${s.ids.length > 3 ? ' …' : ''}`,
                `re-check the ${s.ids.length} stale entries`,
              ],
            ],
          });
        const g = gate(
          [
            {
              gate: 'stale',
              exit: bad ? 1 : 0,
              count: bad,
              what: 'stale or inconsistent verdicts',
            },
          ],
          'stale',
          { stale: bad }
        );
        return {
          blocks: [...g.lead, ...blocks, ...g.last],
          data: { ...s, ...g.data },
          exit: g.exit,
          advisory: g.advisory,
        };
      }),

    list: () => {
      needValues(['component', 'mode', 'state']);
      return overProjects(async () => {
        const state = rest[0] ?? flags.state ?? 'problems';
        const limit = Number(flags.limit) || 30;
        const s = await run('list', {
          state,
          component: /** @type {string | undefined} */ (flags.component),
          mode: /** @type {string | undefined} */ (flags.mode),
          limit,
        });
        /** @type {Block[]} */
        const blocks = [
          {
            h: `Entries: ${state}`,
            sub: `${s.total} match${flags.component ? ` · component ~ ${flags.component}` : ''}${flags.mode ? ` · ${flags.mode}` : ''}`,
          },
          s.total
            ? entryTable(s.entries, { more: s.total - s.shown })
            : { note: 'Nothing matches.', tone: 'ok' },
        ];
        if (s.total)
          blocks.push({
            next: [
              [
                `${CMD} entry ${s.entries[0].id}${cli.current && !project ? ` --project ${cli.current}` : ''}`,
                'verdict and images for one entry',
              ],
            ],
          });
        return { blocks, data: s };
      });
    },

    async entry() {
      cli.current = oneProject();
      const id = rest[0] ?? fail('usage: entry <id>');
      const kinds = list(flags.images).length
        ? list(flags.images)
        : ['baseline', 'current', 'diff'];
      // Ask the tool for no images: the CLI shows paths (or inlines files) itself.
      const res = await run('entry', { id, images: [] }).catch((e) =>
        fail(/** @type {Error} */ (e).message)
      );
      // pxsig_entry's first item is the entry's JSON text
      const e = /** @type {EntryDetail} */ (
        JSON.parse(/** @type {{ text: string }} */ (res.content[0]).text)
      );
      const m = /** @type {Partial<EngineMetrics>} */ (e.metrics ?? {});
      const regions = e.pixels?.regions ?? [];
      const images = kinds.map((k) => {
        const { bytes, where } = imageOf(ctx(), k, id);
        return {
          label: k,
          path: where,
          missing: !bytes,
          data: bytes && format === 'pretty' ? bytes : null,
        };
      });
      /** @type {Block[]} */
      const blocks = [
        { h: id, sub: [e.mode, e.interaction].filter(Boolean).join(' · ') },
        {
          kv: [
            ['State', stateCell(e.state)],
            ['SSIM', `${m.ssim ?? '—'}  (gate ${e.reasons?.length ? 'tripped' : 'held'})`],
            [
              'Changed',
              `${e.changedPx ?? 0} px in ${regions.length} region${regions.length === 1 ? '' : 's'} · ${pct(m.changedCellsPct ?? 0)} of cells`,
            ],
            [
              'a11y',
              e.a11y?.violations?.length
                ? { text: e.a11y.violations.map((v) => v.id ?? v).join(', '), color: 'red' }
                : 'clean',
            ],
            ['Review', e.review?.state ?? 'none'],
            ['Checked', e.checkedAt ?? '—'],
            ['Dashboard', { text: inspectUrl(id), url: inspectUrl(id) }],
          ],
        },
      ];
      if (e.reasons?.length) blocks.push({ h: 'Why' }, { list: e.reasons });
      if (regions.length)
        blocks.push(
          { h: 'Regions' },
          {
            table: {
              cols: [
                { key: 'xy', label: 'x, y' },
                { key: 'wh', label: 'w × h' },
                { key: 'px', label: 'px', right: true },
              ],
              rows: regions
                .slice(0, 8)
                .map((r) => ({ xy: `${r.x}, ${r.y}`, wh: `${r.w} × ${r.h}`, px: r.px })),
              more: Math.max(0, regions.length - 8),
            },
          }
        );
      blocks.push({ h: 'Images' }, { images });
      if (format === 'plain')
        blocks.push({ note: 'Open the PNG paths above to compare baseline and current.' });
      emit(format, blocks, {
        ...e,
        images: Object.fromEntries(images.map((i) => [i.label, i.missing ? null : i.path])),
      });
    },
  };
}
