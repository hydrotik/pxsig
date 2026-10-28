#!/usr/bin/env node
/**
 * check-file-size.mjs — a source or test file has at most 5,000 tokens, and one already over the
 * limit may not grow.
 *
 * Tokens = ceil(bytes / 4) of the file as staged: its index blob (`git cat-file -s :<path>`), so the
 * size is the same on every OS, whatever the checkout's line endings. Counted: .js .mjs .cjs .jsx
 * .ts .tsx .rs, wherever they are, tests, stories and scripts included. Never counted, built in:
 * node_modules/, dist/, build/, coverage/, target/, .pxsig/, .desloppify/, lockfiles and every
 * other extension.
 *
 * What differs between repositories lives in scripts/file-size-baseline.json, never here: the
 * limit, `exempt` (generated or vendored source, path → reason) and `files` (every counted file
 * over the limit, path → its recorded size). This script is the same file in pxsig and hydrotik;
 * check-file-size.test.mjs holds its sha256, so a change made in one is made in both.
 *
 * Usage:
 *   node scripts/check-file-size.mjs --staged   the staged files (the pre-commit hook)
 *   node scripts/check-file-size.mjs --all      every tracked file (CI)
 *   node scripts/check-file-size.mjs --update   lower each recorded size to the current one and
 *                                               drop entries now within the limit; never raises
 *                                               or adds one
 *   node scripts/check-file-size.mjs --init     record the files over the limit (first run only)
 *   add --json for a machine-readable result.
 * Exit 0 ok, 1 a file failed (or --update / --init refused), 2 a usage or git error.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASELINE = 'scripts/file-size-baseline.json';
const SOURCE = /\.(?:js|mjs|cjs|jsx|ts|tsx|rs)$/;
const NEVER = /(?:^|\/)(?:node_modules|dist|build|coverage|target|\.pxsig|\.desloppify)\//;
const LOCKFILE =
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?|Cargo\.lock)$/;
const DESCRIPTION =
  'Source and test files (.js .mjs .cjs .jsx .ts .tsx .rs) over `limit` tokens (bytes / 4 of the ' +
  'staged file), at their recorded sizes. Such a file may not grow, and no other file may pass ' +
  'the limit. `exempt`: generated or vendored files, each with its reason. Lower with ' +
  '`node scripts/check-file-size.mjs --update` in its own commit. See scripts/check-file-size.mjs.';

/**
 * @typedef {{ $description?: string, limit: number, exempt: Record<string, string>,
 *   files: Record<string, number> }} Baseline
 * @typedef {{ path: string, tokens: number, recorded: number | null, from?: string }} Failure
 */

const MODES = ['--staged', '--all', '--update', '--init'];
const argv = process.argv.slice(2);
const mode = argv.filter((a) => MODES.includes(a));
const json = argv.includes('--json');
if (mode.length !== 1 || argv.some((a) => a !== '--json' && !MODES.includes(a))) {
  console.error(`[file-size] usage: check-file-size.mjs ${MODES.join(' | ')} [--json]`);
  process.exit(2);
}

/** The repository root: the hook and CI run from it, the tests from a temp repository. */
let root = process.cwd();
/**
 * @param {string[]} args
 * @param {string} [input]
 */
const git = (args, input) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    input,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

try {
  root = git(['rev-parse', '--show-toplevel']).trim();
} catch {
  console.error('[file-size] not inside a git repository');
  process.exit(2);
}

/** @param {number} bytes */
const tokensOf = (bytes) => Math.ceil(bytes / 4);
/** @param {number} n */
const fmt = (n) => n.toLocaleString('en-US');
/** @param {Record<string, unknown>} o @param {string} k */
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** @param {string} p @param {Baseline} b */
const counted = (p, b) =>
  SOURCE.test(p) && !NEVER.test(p) && !LOCKFILE.test(p) && !has(b.exempt, p);

/**
 * The baseline as staged (--staged) or as in the working tree; an absent one is empty.
 * @param {boolean} staged
 * @returns {Baseline}
 */
function readBaseline(staged) {
  /** @type {string | null} */
  let text = null;
  if (staged) {
    try {
      text = git(['cat-file', 'blob', `:${BASELINE}`]);
    } catch {
      text = null;
    }
  }
  const file = join(root, BASELINE);
  if (text === null && existsSync(file)) text = readFileSync(file, 'utf8');
  const raw = /** @type {Partial<Baseline>} */ (text === null ? {} : JSON.parse(text));
  return { ...raw, limit: raw.limit ?? 5000, exempt: raw.exempt ?? {}, files: raw.files ?? {} };
}

/** @param {Baseline} b */
function writeBaseline(b) {
  /** @type {Record<string, number>} */
  const files = {};
  for (const k of Object.keys(b.files).sort()) files[k] = b.files[k];
  const out = {
    $description: b.$description ?? DESCRIPTION,
    limit: b.limit,
    exempt: b.exempt,
    files,
  };
  writeFileSync(join(root, BASELINE), `${JSON.stringify(out, null, 2)}\n`);
}

/**
 * Index blob sizes in tokens, the same as `git cat-file -s :<path>` for each path.
 * @param {string[]} paths
 * @returns {Map<string, number>}
 */
function stagedTokens(paths) {
  /** @type {Map<string, number>} */
  const sizes = new Map();
  if (!paths.length) return sizes;
  const out = git(
    ['cat-file', '--batch-check=%(objectsize)'],
    paths.map((p) => `:${p}\n`).join('')
  );
  out
    .trim()
    .split('\n')
    .forEach((line, i) => {
      if (/^\d+$/.test(line)) sizes.set(paths[i], tokensOf(Number(line)));
    });
  return sizes;
}

/** Every tracked regular file, from the index. */
const tracked = () =>
  git(['ls-files', '-s', '-z'])
    .split('\0')
    .filter((e) => /^100\d{3} /.test(e))
    .map((e) => e.slice(e.indexOf('\t') + 1));

/**
 * Staged changes: [path, the path it was renamed from, if it was]. Deletions are left out.
 * @returns {Array<[string, string | undefined]>}
 */
function stagedChanges() {
  const t = git(['diff', '--cached', '--name-status', '-M', '-z']).split('\0');
  /** @type {Array<[string, string | undefined]>} */
  const changes = [];
  for (let i = 0; i < t.length - 1;) {
    const status = t[i];
    if (status.startsWith('R') || status.startsWith('C')) {
      changes.push([t[i + 2], status.startsWith('R') ? t[i + 1] : undefined]);
      i += 3;
    } else {
      if (!status.startsWith('D')) changes.push([t[i + 1], undefined]);
      i += 2;
    }
  }
  return changes;
}

/** @param {Failure} f @param {number} limit */
const failureLine = (f, limit) =>
  f.recorded === null
    ? `[file-size] ✗ ${f.path}: ${fmt(f.tokens)} tokens; a file not in the baseline may have at most ${fmt(limit)}.`
    : `[file-size] ✗ ${f.path}: ${fmt(f.tokens)} tokens; its recorded size is ${fmt(f.recorded)}. A file over ${fmt(limit)} tokens may not grow.`;

const GUIDANCE = `
Tokens = bytes / 4 of the staged file. Limit and recorded sizes: ${BASELINE}.

If this commit is a fix or a small change to a file already over the limit:
  keep the file from growing. Remove what the change makes redundant, or first move one
  self-contained part out in its own commit (below). If you are in the middle of other work,
  stop and say the file needs splitting. Do not split it as a side effect of unrelated work.

To split a file:
  1. Choose the seam by responsibility: one command group, one route group, one component part,
     one test topic. Never by line count (no "part2" files), never through the middle of a
     function.
  2. Move that code to a new file beside it, named for what it does (commands/approve.mjs,
     routes/review.mjs, DataGrid.editing.test.tsx).
  3. Keep every export where it was: the old file re-exports what moved
     (export { approveCommand } from './commands/approve.mjs'), so no import changes and the
     published entry points stay the same.
  4. Move the tests with the code, or split a test file by describe() topic; shared setup goes
     to a helper file.
  5. Commit the move alone: no renames, no behaviour change, nothing else in the commit. Run
     every test suite.
  6. Lower the baseline in its own commit: node scripts/check-file-size.mjs --update

A generated or vendored file: add it to "exempt" in ${BASELINE} with the
reason, in its own commit.`;

/**
 * @param {{ ok: boolean, [key: string]: unknown }} result
 * @param {string[]} lines
 */
function finish(result, lines) {
  if (json) console.log(JSON.stringify({ mode: mode[0].slice(2), ...result }, null, 2));
  else for (const l of lines) (result.ok ? console.log : console.error)(l);
  process.exit(result.ok ? 0 : 1);
}

/** --staged and --all: each file against its recorded size, or the limit. */
function check() {
  const staged = mode[0] === '--staged';
  const b = readBaseline(staged);
  /** @type {Array<[string, string | undefined]>} */
  const changes = staged ? stagedChanges() : tracked().map((p) => [p, undefined]);
  const list = changes.filter(([p]) => counted(p, b));
  const sizes = stagedTokens(list.map(([p]) => p));
  /** @type {Failure[]} */
  const failures = [];
  /** @type {string[]} */
  const notes = [];
  for (const [path, from] of list) {
    const tokens = sizes.get(path);
    if (tokens === undefined) continue;
    const inherited = !has(b.files, path) && from !== undefined && has(b.files, from);
    const recorded = has(b.files, path) ? b.files[path] : inherited && from ? b.files[from] : null;
    if (recorded === null) {
      if (tokens > b.limit) failures.push({ path, tokens, recorded });
      continue;
    }
    if (tokens > recorded) failures.push({ path, tokens, recorded, ...(inherited && { from }) });
    else if (inherited && tokens > b.limit)
      notes.push(
        `[file-size] note: ${from} → ${path} keeps its recorded size (${fmt(recorded)}); ` +
          `move its entry in ${BASELINE} in this commit: node scripts/check-file-size.mjs --update`
      );
    else if (!inherited && tokens < recorded)
      notes.push(
        `[file-size] note: ${path} is ${fmt(tokens)} tokens, recorded ${fmt(recorded)}. Lower the ` +
          'baseline in its own commit: node scripts/check-file-size.mjs --update'
      );
  }
  if (!staged) {
    const present = new Set(list.map(([p]) => p));
    for (const p of Object.keys(b.files))
      if (!present.has(p))
        notes.push(`[file-size] note: ${p} is in the baseline but not tracked; --update drops it`);
  }
  const ok = failures.length === 0;
  const summary = `[file-size] ${list.length} ${staged ? 'staged' : 'tracked'} source file(s) checked`;
  finish(
    { ok, limit: b.limit, checked: list.length, failures, notes },
    ok ? [...notes, `${summary}: ok`] : [...failures.map((f) => failureLine(f, b.limit)), GUIDANCE]
  );
}

/** --update: lower or drop entries, move a staged rename's entry; never raise or add one. */
function update() {
  const b = readBaseline(false);
  const paths = tracked().filter((p) => counted(p, b));
  const sizes = stagedTokens(paths);
  /** @type {Record<string, number>} */
  const files = { ...b.files };
  /** @type {Array<{ path: string, from: string }>} */
  const moved = [];
  for (const [path, from] of stagedChanges())
    if (from && has(files, from) && !has(files, path) && !sizes.has(from) && sizes.has(path)) {
      files[path] = files[from];
      delete files[from];
      moved.push({ path, from });
    }
  /** @type {Failure[]} */
  const refused = [];
  /** @type {Array<{ path: string, from: number, to: number }>} */
  const lowered = [];
  /** @type {string[]} */
  const dropped = [];
  for (const [path, recorded] of Object.entries(files)) {
    const tokens = sizes.get(path);
    if (tokens === undefined || tokens <= b.limit) {
      dropped.push(path);
      delete files[path];
    } else if (tokens > recorded) refused.push({ path, tokens, recorded });
    else if (tokens < recorded) {
      lowered.push({ path, from: recorded, to: tokens });
      files[path] = tokens;
    }
  }
  for (const [path, tokens] of sizes)
    if (tokens > b.limit && !has(files, path) && !dropped.includes(path))
      refused.push({ path, tokens, recorded: null });
  if (refused.length)
    return finish({ ok: false, refused }, [
      `[file-size] --update only lowers the baseline; it never raises or adds an entry. Nothing written.`,
      ...refused.map((f) => failureLine(f, b.limit)),
      GUIDANCE,
    ]);
  writeBaseline({ ...b, files });
  finish({ ok: true, lowered, dropped, moved }, [
    ...moved.map((m) => `[file-size] moved ${m.from} → ${m.path}`),
    ...lowered.map((l) => `[file-size] lowered ${l.path}: ${fmt(l.from)} → ${fmt(l.to)}`),
    ...dropped.map((p) => `[file-size] dropped ${p}`),
    `[file-size] baseline: ${Object.keys(files).length} file(s) over ${fmt(b.limit)} tokens`,
  ]);
}

/** --init: record every counted file over the limit, keeping `exempt`. */
function init() {
  const b = readBaseline(false);
  if (Object.keys(b.files).length)
    return finish({ ok: false, files: Object.keys(b.files).length }, [
      `[file-size] ${BASELINE} already records files; --init runs once. Use --update to lower it.`,
    ]);
  const sizes = stagedTokens(tracked().filter((p) => counted(p, b)));
  /** @type {Record<string, number>} */
  const files = {};
  for (const [path, tokens] of sizes) if (tokens > b.limit) files[path] = tokens;
  writeBaseline({ ...b, files });
  const total = Object.values(files).reduce((s, n) => s + n, 0);
  finish({ ok: true, files, total }, [
    `[file-size] baseline recorded: ${Object.keys(files).length} file(s) over ${fmt(b.limit)} tokens, ${fmt(total)} tokens in all`,
  ]);
}

if (mode[0] === '--update') update();
else if (mode[0] === '--init') init();
else check();
