/**
 * cli/gate-report.mjs — `pxsig report <id> [--full] [--keep-id] [--no-image]`: a gate report for
 * one entry, for an issue on hydrotik/pxsig when the gate got it wrong. It runs pxsig_gate_report
 * in-process (tools/report.mjs, lib/gate-report.mjs): the text, the composite image (or the
 * image-free summary) and report.json go to the store's reports/gate-report/<id>/, and the issue
 * link is printed. It opens no network connection and posts nothing: the person opens the link.
 * Without an id, `pxsig report` is the static dashboard, as before (report.mjs).
 */
import { join } from 'node:path';
import { herePath } from '../lib/machine.mjs';
import { emit } from '../lib/term.mjs';
/** @import { Block } from '../types/t6.js' */
/** @import { CliContext } from './context.mjs' */

export const REPORT_USAGE = 'usage: pxsig report <id> [--full] [--keep-id] [--no-image]';

/** @param {CliContext} cli */
export async function gateReportCommand(cli) {
  const { flags, format, rest, run, ctx, fail } = cli;
  if (rest.length !== 1) fail(REPORT_USAGE);
  if (typeof flags.out === 'string') fail(`${REPORT_USAGE} (--out is the static dashboard's)`);
  const r = await run('gate_report', {
    id: rest[0],
    full: flags.full === true,
    keepId: flags['keep-id'] === true,
    noImage: flags['no-image'] === true,
  });
  if (format === 'json') return void process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  /** A store-relative path, relative to the current folder (never absolute). */
  const here = (/** @type {string} */ rel) => herePath(join(ctx().P.store.root, rel));
  /** @type {Block[]} */
  const blocks = [
    { h: `Gate report: ${r.id}`, sub: 'for an issue on hydrotik/pxsig: "The gate got it wrong"' },
    {
      kv: [
        ['Text', here(`${r.folder}report.md`)],
        ['Image', r.image ? here(r.image) : 'none: image-free (average colors in the text)'],
        ['Facts', here(`${r.folder}report.json`)],
      ],
    },
    { text: r.text },
    { h: 'Issue link' },
    { text: r.url },
    ...(r.trimmed.length
      ? [{ note: `Cut to fit the link: ${r.trimmed.join(', ')}. The text above has all of it.` }]
      : []),
    { note: r.note },
  ];
  emit(format, blocks);
}
