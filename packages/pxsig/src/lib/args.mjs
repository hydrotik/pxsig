/**
 * args.mjs — one argv parser for every pxsig entry point (cli, check, serve, report).
 *
 * `--name value`, `--name=value`, and boolean flags, which never take the next word as a value.
 * Everything not starting with `--` is positional.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BOOLEAN_FLAGS = new Set([
  'json',
  'plain',
  'pretty',
  'markdown',
  'help',
  'all',
  'new',
  'adopt',
  'all-changed',
  'first-baselines',
  'ci',
  'repair',
  'apply',
  'prune',
  'offline',
  'full',
  'update',
  'watch',
  'no-open',
  'no-verify',
  'no-a11y',
  'no-server',
  'from-git',
  'strict-env',
  'warn',
  'enforce',
  'strict',
]);

export function parseArgs(argv, { booleans = BOOLEAN_FLAGS } = {}) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--') || a === '--') {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq > 0) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const name = a.slice(2);
    flags[name] =
      !booleans.has(name) && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')
        ? argv[++i]
        : true;
  }
  return { positional, flags };
}

/**
 * Every flag some pxsig command takes: the global ones and each command's and subcommand's in
 * help/commands.json, which test/help.test.mjs keeps equal to the flags the CLI reads. A flag
 * outside it is a typo or another tool's flag: the CLI says so and goes on (`unknownFlags`).
 */
let known = null;
export function knownFlags() {
  if (!known) {
    const { global, commands } = JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', 'help', 'commands.json'),
        'utf8'
      )
    );
    const entries = [
      global,
      ...Object.values(commands).flatMap((c) => [c, ...Object.values(c.subcommands ?? {})]),
    ];
    known = new Set(entries.flatMap((e) => (e.flags ?? []).map((f) => f.name)));
  }
  return known;
}

/** The edit distance between two short strings: insertions, deletions, substitutions and swaps of two neighbours. */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/**
 * The flags in `argv` that no command knows, each with the closest known flag (within two edits,
 * one for a name of four letters or fewer)
 * and the word it took as its value, if any (a misspelled boolean takes the next word).
 * @returns {{ name: string, suggestion: string | null, took: string | null }[]}
 */
export function unknownFlags(argv, { known = knownFlags(), booleans = BOOLEAN_FLAGS } = {}) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--') || a === '--') continue;
    const eq = a.indexOf('=');
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    const took =
      eq < 0 && !booleans.has(name) && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')
        ? argv[++i]
        : null;
    if (known.has(name)) continue;
    let suggestion = null;
    // Two edits for a longer name, one for a short one (`--x` is not a typo of `--ci`).
    let best = name.length > 4 ? 3 : 2;
    for (const k of known) {
      const d = distance(name, k);
      if (d < best) [best, suggestion] = [d, k];
    }
    out.push({ name, suggestion, took });
  }
  return out;
}

/** One line per unknown flag, for stderr. */
export const unknownFlagLines = (unknown) =>
  unknown.map(
    ({ name, suggestion, took }) =>
      `pxsig: unknown flag --${name}, ignored${suggestion ? ` (did you mean --${suggestion}?)` : ''}${took != null ? `; it took "${took}" as its value` : ''}`
  );

/** A flag's string value, or null (absent, or given without a value). */
export const strFlag = (flags, k) =>
  typeof flags[k] === 'string' && flags[k] !== '' ? flags[k] : null;
