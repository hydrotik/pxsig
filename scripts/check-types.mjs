#!/usr/bin/env node
/**
 * check-types.mjs — tsc errors in the JavaScript may only go down, to none.
 *
 * Runs tsc (checkJs, strict: tsconfig.node.json) over each Node project — pxsig, the Storybook
 * addon, scripts, tools — counts errors per file and code, and fails when any file gained one
 * against scripts/type-errors-baseline.json. The same ratchet as the lint warnings
 * (scripts/lib/lint-ratchet.mjs). An error reported by two projects (a script importing pxsig's
 * code) counts once. `pnpm typecheck` runs it.
 *
 * Usage:
 *   node scripts/check-types.mjs            exit 0 no file got worse, 1 otherwise
 *   node scripts/check-types.mjs --update   lower the baseline to what is left
 *   node scripts/check-types.mjs --init     record the current counts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countDiagnostics, lowered, regressions, total } from './lib/lint-ratchet.mjs';
/** @import { RatchetBaseline } from './types.js' */

export const PROJECTS = ['packages/pxsig', 'packages/storybook-addon', 'scripts', 'tools'];

const repo = fileURLToPath(new URL('..', import.meta.url));
const baselinePath = join(repo, 'scripts', 'type-errors-baseline.json');
const tsc = createRequire(join(repo, 'package.json')).resolve('typescript/bin/tsc');

/**
 * tsc's `--pretty false` lines as diagnostics: `path(line,col): error TS1234: message`. tsc prints
 * paths relative to where it runs (the repository root, here); returned with forward slashes.
 * @param {string} out
 */
export function parseTsc(out) {
  /** @type {{ filename: string, code: string, at: string }[]} */
  const found = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+):/.exec(line);
    if (!m) continue;
    const filename = relative(repo, resolve(repo, m[1])).split('\\').join('/');
    found.push({ filename, code: m[4], at: `${m[2]}:${m[3]}` });
  }
  return found;
}

function current() {
  const seen = new Set();
  /** @type {{ filename: string, code: string }[]} */
  const all = [];
  for (const project of PROJECTS) {
    const r = spawnSync(
      process.execPath,
      [tsc, '-p', join(project, 'tsconfig.json'), '--pretty', 'false'],
      { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
    );
    for (const d of parseTsc(`${r.stdout}${r.stderr}`)) {
      const key = `${d.filename}:${d.at}:${d.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(d);
    }
  }
  return countDiagnostics(all);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const update = process.argv.includes('--update');
  const init = process.argv.includes('--init');
  const now = current();
  const DESCRIPTION =
    'tsc errors (checkJs, strict) per file and code in the JavaScript. A file may not gain one; ' +
    'lower with `node scripts/check-types.mjs --update` after fixing some. The goal is an empty ' +
    'file. See scripts/check-types.mjs.';
  /** @param {Record<string, Record<string, number>>} counts */
  const write = (counts) =>
    writeFileSync(
      baselinePath,
      `${JSON.stringify({ $description: DESCRIPTION, total: total(counts), files: counts }, null, 2)}\n`
    );
  if (init || !existsSync(baselinePath)) {
    write(now);
    console.log(`[types] baseline recorded: ${total(now)} errors`);
    process.exit(0);
  }
  // The baseline this script writes (`write` above).
  const baseline = /** @type {RatchetBaseline} */ (JSON.parse(readFileSync(baselinePath, 'utf8')))
    .files;
  const worse = regressions(baseline, now);
  if (worse.length) {
    for (const r of worse)
      console.error(`[types] ✗ ${r.file}: ${r.rule} ${r.allowed} → ${r.count}`);
    console.error(
      `[types] ${worse.length} file/code pair(s) got worse. Fix the new errors ` +
        '(`pnpm exec tsc -p <project>/tsconfig.json` shows them).'
    );
    process.exit(1);
  }
  const next = lowered(baseline, now);
  if (update) {
    write(next);
    console.log(`[types] baseline lowered: ${total(baseline)} → ${total(next)}`);
  } else {
    const drop = total(baseline) - total(now);
    console.log(
      `[types] ok — ${total(now)} errors (baseline ${total(baseline)})` +
        (drop > 0 ? `; run with --update to lock in the ${drop} fixed` : '')
    );
  }
}
