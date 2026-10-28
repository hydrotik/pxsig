#!/usr/bin/env node
/**
 * check-lint-warnings.mjs — the oxlint warning count may only go down.
 *
 * Runs oxlint over the repository (the same scope as `pnpm lint`), counts warnings per file and
 * rule, and fails when any file gained one against scripts/lint-warnings-baseline.json. Errors are
 * `pnpm lint`'s job.
 *
 * Usage:
 *   node scripts/check-lint-warnings.mjs            exit 0 no file got worse, 1 otherwise
 *   node scripts/check-lint-warnings.mjs --update   lower the baseline to what is left
 *   node scripts/check-lint-warnings.mjs --init     record the current counts (first run only)
 *
 * A warning that is right to keep gets an inline oxlint disable with a reason, not a higher
 * baseline.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countWarnings, lowered, regressions, total } from './lib/lint-ratchet.mjs';
/** @import { Counts, OxlintDiagnostic, RatchetBaseline } from './types.js' */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(repoRoot, 'scripts', 'lint-warnings-baseline.json');
const update = process.argv.includes('--update');
const init = process.argv.includes('--init');
// oxlint's own launcher, run by this Node: no shell and no package-manager shim on any OS.
const oxlint = join(
  dirname(createRequire(import.meta.url).resolve('oxlint/package.json')),
  'bin',
  'oxlint'
);

/** @type {string} */
let raw;
try {
  raw = execFileSync(process.execPath, [oxlint, '--type-aware', '--format', 'json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (err) {
  // oxlint exits non-zero when there are errors; the JSON is still on stdout.
  // execFileSync's error, with encoding 'utf8': its stdout is a string.
  raw = /** @type {{ stdout: string }} */ (err).stdout;
}
// oxlint's --format json output: { diagnostics: [...] }.
const current = countWarnings(
  /** @type {{ diagnostics: OxlintDiagnostic[] }} */ (JSON.parse(raw)).diagnostics
);

const DESCRIPTION =
  'oxlint warnings per file and rule. A file may not gain a warning; lower with ' +
  '`node scripts/check-lint-warnings.mjs --update` after fixing some. See scripts/check-lint-warnings.mjs.';
/** @param {Counts} counts */
const write = (counts) =>
  writeFileSync(
    baselinePath,
    `${JSON.stringify({ $description: DESCRIPTION, total: total(counts), files: counts }, null, 2)}\n`
  );

if (init || !existsSync(baselinePath)) {
  write(current);
  console.log(`[lint-warnings] baseline recorded: ${total(current)} warnings`);
  process.exit(0);
}

// The baseline this script writes (`write` above).
const baseline = /** @type {RatchetBaseline} */ (JSON.parse(readFileSync(baselinePath, 'utf8')))
  .files;
const worse = regressions(baseline, current);
if (worse.length) {
  for (const r of worse) {
    console.error(`[lint-warnings] ✗ ${r.file}: ${r.rule} ${r.allowed} → ${r.count}`);
  }
  console.error(
    `[lint-warnings] ${worse.length} file/rule pair(s) got worse. Fix the new warnings ` +
      '(`pnpm lint` shows them), or suppress one inline with a reason.'
  );
  process.exit(1);
}

const next = lowered(baseline, current);
if (update) {
  write(next);
  console.log(`[lint-warnings] baseline lowered: ${total(baseline)} → ${total(next)}`);
} else {
  const drop = total(baseline) - total(current);
  console.log(
    `[lint-warnings] ok — ${total(current)} warnings (baseline ${total(baseline)})` +
      (drop > 0 ? `; run with --update to lock in the ${drop} fixed` : '')
  );
}
