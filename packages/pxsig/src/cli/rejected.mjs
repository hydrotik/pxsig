/**
 * cli/rejected.mjs — `pxsig rejected [ids…] [--kind visual|a11y] [--closed] [--prompt] [--limit n]`:
 * the open rejections with their reasons, what changed and where, and the re-check command. It
 * runs pxsig_rejected in-process (tools/rejected.mjs), as every read command runs its tool. On a
 * TTY styled, piped Markdown (paste-ready), `--json` JSON; images are paths relative to the
 * current folder. `--prompt` prints only the paragraph for an assistant, one per rejection, and
 * nothing when there is none (a SessionStart hook's recipe, docs/agents.md). There is no reject in
 * the CLI: rejecting is done where a person sees the images.
 *
 * A reason is the reviewer's own text: in Markdown it appears only inside a fenced `text` block.
 */
import { join } from 'node:path';
import { herePath } from '../lib/machine.mjs';
import { emit, stateCell } from '../lib/term.mjs';
import { fenced } from '../lib/rejections/markdown.mjs';
import { NEVER_APPROVE, NO_REASON } from '../lib/rejections/prompt.mjs';

/** @import { Block } from '../types/t6.js' */
/** @import { ClosedRejection, RejectedEntry } from '../types/rejections.js' */
/** @import { CliContext } from './context.mjs' */

/** Rejections shown per project; `--json` and `--prompt` carry up to this many too. */
const LIMIT = 20;

/**
 * The reason as a block: a kv row on a terminal, a fenced `text` block in Markdown.
 * @param {string} format
 * @param {string | null} note
 * @param {string} from
 * @returns {Block[]}
 */
export function reasonBlocks(format, note, from) {
  if (format === 'pretty')
    return [
      {
        kv: [
          ['Reason', note ?? { text: NO_REASON, color: 'gray' }],
          ['From', from],
        ],
      },
    ];
  return [{ text: [`Reason, from ${from}:`, '', ...fenced(note ?? NO_REASON)].join('\n') }];
}

/** @param {CliContext} cli */
export function rejectedCommand(cli) {
  const { flags, format, rest, CMD, run, ctx, needValues, overProjects, readTargets, fail } = cli;
  needValues(['kind', 'limit']);
  const kind = /** @type {'visual' | 'a11y' | 'all'} */ (flags.kind ?? 'all');
  if (!['visual', 'a11y', 'all'].includes(kind)) fail('usage: --kind is visual, a11y or all');
  const limit = Number(flags.limit) || LIMIT;
  const ids = rest.length ? rest : undefined;
  /**
   * A store-relative path, relative to the current folder (never absolute).
   * @param {string | null | undefined} rel
   */
  const here = (rel) => (rel ? herePath(join(ctx().P.store.root, rel)) : null);

  /** @param {RejectedEntry} e */
  const withHere = (e) => ({
    ...e,
    packet: here(e.packet),
    files: Object.fromEntries(Object.entries(e.files).map(([k, v]) => [k, here(v)])),
    regions: e.regions.map((c) => ({
      ...c,
      crops: c.crops
        ? {
            baseline: here(c.crops.baseline),
            current: here(c.crops.current),
            diff: here(c.crops.diff),
          }
        : null,
    })),
  });

  /** @param {ReturnType<typeof withHere>} e */
  const entryBlocks = (e) => {
    /** @type {Block[]} */
    const out = [
      {
        h: `Rejected: ${e.id}`,
        sub: [e.kind === 'a11y' ? 'accessibility' : 'visual', `since ${e.at}`].join(' · '),
      },
      ...reasonBlocks(format, e.note, e.from),
      {
        kv: [
          ['State now', !e.state ? '—' : e.kind === 'visual' ? stateCell(e.state) : e.state],
          ['Goal', e.goal],
          [
            'Checks since',
            e.checks.length
              ? e.checks
                  .slice(-3)
                  .map((c) => `${c.pass ? 'pass' : 'still differs'} ${c.at}`)
                  .join(' · ')
              : 'none yet',
          ],
          ...(e.metrics
            ? [
                [
                  'Changed',
                  `${e.metrics.changedPx} px in ${e.metrics.regions} region${e.metrics.regions === 1 ? '' : 's'} · SSIM ${e.metrics.ssim ?? '—'}`,
                ],
              ]
            : []),
          ...(e.structure ? [['Structure', e.structure]] : []),
          ['Packet', e.files.rejection ?? e.packetError ?? 'not written yet'],
        ],
      },
    ];
    if (e.notes.length > 1)
      out.push(
        { h: 'Earlier reasons' },
        format === 'pretty'
          ? { list: e.notes.slice(1).map((n) => `${n.at} · ${n.from}: ${n.note ?? NO_REASON}`) }
          : {
              text: e.notes
                .slice(1)
                .flatMap((n) => [
                  `${n.at}, from ${n.from}:`,
                  '',
                  ...fenced(n.note ?? NO_REASON),
                  '',
                ])
                .join('\n'),
            }
      );
    if (e.regions.length)
      out.push({
        table: {
          cols: [
            { key: 'n', label: '#', right: true },
            { key: 'xy', label: 'x, y' },
            { key: 'wh', label: 'w × h' },
            { key: 'px', label: 'px', right: true },
            { key: 'crops', label: 'Crops' },
          ],
          rows: e.regions.map((c) => ({
            n: c.n,
            xy: `${c.x}, ${c.y}`,
            wh: `${c.w} × ${c.h}`,
            px: c.px,
            crops: c.crops
              ? `${c.crops.baseline} · ${c.crops.current} · ${c.crops.diff}`
              : `too large to crop: see ${e.files.current ?? 'current.png'}`,
          })),
        },
      });
    if (e.violations?.length)
      out.push({ list: e.violations.map((v) => `${v.id}${v.impact ? ` (${v.impact})` : ''}`) });
    return out;
  };

  /**
   * @param {ClosedRejection} c
   * @returns {Block[]}
   */
  const closedBlocks = (c) => [
    {
      h: `Closed: ${c.id}`,
      sub: [c.kind === 'a11y' ? 'accessibility' : 'visual', c.as, c.closedAt].join(' · '),
    },
    ...reasonBlocks(format, c.note, c.notes[0]?.from ?? '—'),
  ];

  if (flags.prompt) return prompts();
  return overProjects(async () => {
    if (flags.closed) {
      const s = /** @type {{ total: number, entries: ClosedRejection[] }} */ (
        await run('rejected', { ids, kind, closed: true, limit })
      );
      /** @type {Block[]} */
      const blocks = s.entries.length
        ? s.entries.flatMap(closedBlocks)
        : [{ h: 'Closed rejections' }, { note: 'None closed yet.', tone: 'ok' }];
      if (s.total > s.entries.length)
        blocks.push({ note: `${s.total - s.entries.length} more: --limit ${s.total}` });
      return { blocks, data: s };
    }
    const s = await openOf();
    const entries = s.entries.map(withHere);
    /** @type {Block[]} */
    const blocks = entries.length
      ? [
          ...entries.flatMap(entryBlocks),
          {
            next: [
              [
                `${CMD} check ${entries.map((e) => e.id).join(' ')}`,
                'after the fix: a pass closes the rejection',
              ],
            ],
          },
          { note: NEVER_APPROVE },
        ]
      : [{ h: 'Rejected' }, { note: 'No open rejections.', tone: 'ok' }];
    if (s.open > entries.length)
      blocks.push({ note: `${s.open - entries.length} more: --limit ${s.open}` });
    return { blocks, data: { ...s, entries } };
  });

  /** pxsig_rejected's answer, parsed (its first item is the JSON text). */
  async function openOf() {
    const res = /** @type {{ content: { type: string, text?: string }[] }} */ (
      await run('rejected', { ids, kind, limit })
    );
    return /** @type {{ open: number, entries: RejectedEntry[] }} */ (
      JSON.parse(/** @type {string} */ (res.content[0].text))
    );
  }

  /** `--prompt`: every project's prompts, one paragraph each; nothing when there are none. */
  async function prompts() {
    /** @type {string[]} */
    const out = [];
    for (const name of readTargets()) {
      cli.current = name;
      for (const e of (await openOf()).entries) out.push(e.prompt);
    }
    if (format === 'json') emit(format, [], { prompts: out });
    else if (out.length) process.stdout.write(`${out.join('\n\n')}\n`);
    process.exit(0);
  }
}
