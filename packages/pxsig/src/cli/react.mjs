/**
 * cli/react.mjs — `pxsig react`: the React Compiler's verdict on the changed files, compared with
 * the merge base. Selection and compilation only: no Storybook, no browser, fast enough for a
 * pre-commit hook or an assistant. Alerts only: exit 0 whatever it finds, 2 for a usage or setup
 * error. When another process holds the store, it reads the cache and writes nothing.
 */
import { resolve } from 'node:path';
import { emit } from '../lib/term.mjs';
import { relPath } from '../lib/paths.mjs';
import { analyse } from '../lib/react/index.mjs';
import { writeReactSarif } from '../lib/sarif-react.mjs';
import { PXSIG_VERSION } from '../lib/workspace.mjs';

/** @import { Block } from '../types/t6.js' */
/** @import { ReactReport } from '../types/react.js' */
/** @import { CliContext } from './context.mjs' */

/** Alerts printed before "… n more". */
const SHOWN = 10;

/**
 * The one-line summary of a run.
 * @param {ReactReport} r
 * @param {number} cached
 */
export function summaryLine(r, cached) {
  const s = r.summary;
  const head = `react: ${s.files} files, ${s.functions} functions`;
  const secs = `${((s.ms ?? 0) / 1000).toFixed(1)} s${cached ? ` (${cached} cached)` : ''}`;
  /** @type {string[]} */
  const parts = [];
  if (!r.base) {
    parts.push(`${s.compiled} compiled`, `${s.bailouts} skipped by the React Compiler`);
    if (s.optedOut) parts.push(`${s.optedOut} opted out`);
  } else {
    parts.push(`${s.newBailouts} newly skipped by the React Compiler`);
    if (s.newFindings) parts.push(`${s.newFindings} new findings`);
    if (s.fixed) parts.push(`${s.fixed} fixed`);
  }
  return [head, ...parts, secs].join(' · ');
}

/** @param {CliContext} cli */
export function reactCommands(cli) {
  const { flags, format, ctx, list, oneProject } = cli;
  /** @type {CliContext['fail']} */
  const fail = cli.fail;

  return {
    async react() {
      cli.current = oneProject();
      if ([flags.since, flags.files, flags.all].filter((v) => v !== undefined).length > 1)
        fail('usage: react [--since <ref> | --files a,b | --all]');
      for (const n of ['since', 'files', 'sarif'])
        if (flags[n] === true) fail(`usage: --${n} needs a value`);
      const P = ctx().P;
      const files = list(flags.files).map((f) => relPath(P.workspaceRoot, resolve(f)));
      const r = await analyse(P, {
        since: typeof flags.since === 'string' ? flags.since : undefined,
        files,
        all: flags.all === true,
        flags,
      });
      // `--sarif <file>`: the compiler alerts as SARIF, written (empty) whatever the run found, so
      // a CI step that uploads it always has a file.
      const sarif = typeof flags.sarif === 'string' ? flags.sarif : null;
      const sarifCount = () =>
        sarif
          ? writeReactSarif(resolve(sarif), {
              alerts: r.ran ? r.report.alerts : [],
              version: PXSIG_VERSION,
            })
          : 0;
      if (!r.ran) {
        /** @type {Block[]} */
        const off = [{ h: 'React', sub: r.text }];
        if (sarif) off.push({ note: `wrote ${sarifCount()} React alerts to ${sarif} (SARIF)` });
        emit(format, off, { ran: false, why: r.why, text: r.text });
        process.exit(0);
      }
      const { report } = r;
      /** @type {Block[]} */
      const blocks = [{ h: 'React', sub: summaryLine(report, report.summary.cached) }];
      const alerts = report.alerts;
      if (alerts.length) {
        blocks.push({ list: alerts.slice(0, SHOWN).map((a) => a.text) });
        if (alerts.length > SHOWN)
          blocks.push({ note: `… ${alerts.length - SHOWN} more in reports/react.json` });
      }
      for (const n of report.notes) blocks.push({ note: n });
      for (const s of report.skipped)
        if (s.why === 'a Flow file')
          blocks.push({ note: `react: ${s.path}: a Flow file, not analysed` });
      if (r.heldBy) blocks.push({ note: `results not saved: ${r.heldBy}`, tone: 'warn' });
      if (sarif) blocks.push({ note: `wrote ${sarifCount()} React alerts to ${sarif} (SARIF)` });
      emit(format, blocks, report);
      process.exit(0);
    },
  };
}
