#!/usr/bin/env node
/**
 * check-clean.mjs — what this repository must never contain, checked on every push and PR.
 *
 *   node scripts/check-clean.mjs [--all]     # tracked files (git ls-files); --all: every file on disk
 *   node scripts/check-clean.mjs --require-terms --since origin/main [--text <file>]
 *                                            # the scrub: also the denylist, the branch's commit
 *                                            # messages and a draft (a PR body); see /scrub
 *
 * Fails (exit 1) on:
 *   - images, fonts and binaries, and anything a run produces (baselines, stores, renders, reports):
 *     those belong to the project under test, never to the tool. One exemption: product
 *     screenshots in `docs/product-shots/` (png, jpg, webp, avif or gif, up to 1.5 MB each, because
 *     the README loads them; the folder holds those and its own Markdown, nothing else)
 *   - anything under `.local/`: the maintainer's private notes and reference material (git-ignored)
 *   - absolute home-directory paths
 *   - paths from a consuming repository's package layout (configured below: `forbiddenPaths`)
 *   - a denylist of names that must not appear, matched case-sensitively on word boundaries. The
 *     list is never committed or uploaded (it would publish the names). It is read from, in order:
 *     PXSIG_CLEAN_TERMS (comma-separated), `~/.config/pxsig/clean-terms` (or $XDG_CONFIG_HOME),
 *     a git-ignored `.clean-terms` in this checkout, and the one in the main checkout, so every
 *     worktree finds it. Names only come in from reading other repositories, so the check runs
 *     after that work (the /scrub command, the peer-reader agent), not as a hook on every push. CI
 *     runs it without the denylist. A hit never prints the name, only where it is.
 * Binary-looking files and lockfiles are skipped for the text checks.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
/** Folders a run or a build writes. */
const RUN_DIRS =
  /(^|\/)(\.pxsig|__pxsig__|\.baselines|\.renders|\.reports|px-diff-out|pxsig-diff|target|dist)\//;
const FORBIDDEN_FILES = [
  /\.(png|jpe?g|gif|webp|avif|bmp|ico|woff2?|ttf|otf|wasm)$/i,
  /\.psig$/i,
  /\.pxsig\.json$/i,
  RUN_DIRS,
  /(^|\/)\.DS_Store$/,
  /(^|\/)\.env/,
];
/** Private notes and reference maps (docs/ui-headless.md): never tracked, whatever their type. */
const PRIVATE = /(^|\/)\.local\//;
/** The one folder images may be committed to: product screenshots for the README and docs. */
export const SHOTS = 'docs/product-shots/';
const SHOT_IMAGE = /\.(png|jpe?g|webp|avif|gif)$/i;
/** The README loads every shot on the repository's front page: keep each one light. */
export const SHOT_MAX_BYTES = 1.5 * 1024 * 1024;

/**
 * Why a tracked file must not be committed, from its path (and size, for a product shot), or null.
 * Its text is checked separately.
 * @param {string} f
 * @param {number} [size]
 */
export function fileProblem(f, size = 0) {
  if (PRIVATE.test(f)) return '.local/ holds private notes and stays out of the repository';
  if (f.startsWith(SHOTS)) {
    if (SHOT_IMAGE.test(f)) {
      if (RUN_DIRS.test(f)) return 'this kind of file stays out of the repository';
      return size > SHOT_MAX_BYTES
        ? `a product shot over ${SHOT_MAX_BYTES / 1024 / 1024} MB (${(size / 1024 / 1024).toFixed(2)} MB): the README loads it, compress it`
        : null;
    }
    if (!/\.md$/i.test(f))
      return `${SHOTS} holds product screenshots (png, jpg, webp, avif, gif) and Markdown only`;
  }
  if (FORBIDDEN_FILES.some((re) => re.test(f)))
    return 'this kind of file stays out of the repository';
  return null;
}

const forbiddenPaths = [/\bpackages\/hy-[a-z]/, /\bapps\/hy-[a-z]/];
const HOME = /(?:^|[\s"'`(=])\/(?:Users|home)\/[A-Za-z0-9._-]+\//;
const SKIP_TEXT =
  /(^|\/)(pnpm-lock\.yaml|Cargo\.lock)$|\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|wasm)$/i;
/** Files that describe these rules and so must name the patterns. */
const SELF = new Set(['scripts/check-clean.mjs', '.gitignore', '.clean-terms']);

function files() {
  if (process.argv.includes('--all') || !existsSync(join(root, '.git'))) {
    /** @type {string[]} */
    const out = [];
    /** @param {string} d */
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (['node_modules', '.git', 'target', '.local'].includes(e.name)) continue;
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else out.push(relative(root, p).split('\\').join('/'));
      }
    };
    walk(root);
    return out;
  }
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

/** @param {string} k */
const flag = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : null;
};
/** @param {string[]} a */
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });

/** The main checkout's root (a worktree's .clean-terms is usually only there). */
function mainCheckout() {
  try {
    return dirname(resolve(root, git('rev-parse', '--git-common-dir').trim()));
  } catch {
    return null;
  }
}

function terms() {
  const list = (process.env.PXSIG_CLEAN_TERMS ?? '').split(',');
  const config = join(
    process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
    'pxsig',
    'clean-terms'
  );
  const main = mainCheckout();
  for (const f of [config, join(root, '.clean-terms'), main && join(main, '.clean-terms')])
    if (f && existsSync(f)) list.push(...readFileSync(f, 'utf8').split(/\r?\n/));
  return [...new Set(list.map((t) => t.trim()).filter((t) => t && !t.startsWith('#')))];
}

// Imported (by its test) for fileProblem: run nothing.
const main = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (main) run();

function run() {
  if (process.argv.includes('--require-terms') && !terms().length) {
    console.error(
      '[check-clean] no denylist: create ~/.config/pxsig/clean-terms or .clean-terms (one name per line)'
    );
    process.exit(1);
  }

  /** @type {string[]} */
  const problems = [];
  const denylist = terms().map((t) => ({
    t,
    re: new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
  }));
  for (const f of files()) {
    let size = 0;
    try {
      size = statSync(join(root, f)).size;
    } catch {
      /* deleted in the working tree: its path is still checked */
    }
    const why = fileProblem(f, size);
    if (why) {
      problems.push(`${f}: ${why}`);
      continue;
    }
    if (SELF.has(f) || SKIP_TEXT.test(f)) continue;
    let text;
    try {
      if (size > 4 * 1024 * 1024) continue;
      text = readFileSync(join(root, f), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000')) continue; // binary
    text.split('\n').forEach((line, i) => {
      const at = `${f}:${i + 1}`;
      if (HOME.test(line)) problems.push(`${at}: absolute home path`);
      for (const re of forbiddenPaths)
        if (re.test(line))
          problems.push(`${at}: a consuming repository's package path (${re.source})`);
      for (const { re } of denylist) if (re.test(line)) problems.push(`${at}: denylisted name`);
    });
  }

  /**
   * Lines of free text (commit messages, a PR body): names and home paths, as in files.
   * @param {string} label
   * @param {string} text
   */
  function checkText(label, text) {
    text.split('\n').forEach((line, i) => {
      if (HOME.test(line)) problems.push(`${label}:${i + 1}: absolute home path`);
      for (const { re } of denylist)
        if (re.test(line)) problems.push(`${label}:${i + 1}: denylisted name`);
    });
  }
  const since = flag('--since');
  if (since) {
    // Commit messages are published with the branch as surely as its files are.
    for (const rec of git('log', '--format=%h%x00%B%x01', `${since}..HEAD`).split('\x01')) {
      const [sha, body] = rec.replace(/^\n/, '').split('\0');
      if (sha) checkText(`commit ${sha}`, body ?? '');
    }
  }
  const draft = flag('--text');
  if (draft) checkText(draft, readFileSync(resolve(draft), 'utf8'));

  if (problems.length) {
    console.error(`[check-clean] ${problems.length} problem(s):`);
    for (const p of problems.slice(0, 200)) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(
    `[check-clean] ok · ${denylist.length ? `${denylist.length} denylisted names checked` : "no denylist here (run /scrub on the maintainer's machine to check names)"}`
  );
}
