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
 *     those belong to the project under test, never to the tool
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
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const FORBIDDEN_FILES = [
  /\.(png|jpe?g|gif|webp|avif|bmp|ico|woff2?|ttf|otf|wasm)$/i,
  /\.psig$/i,
  /\.pxsig\.json$/i,
  /(^|\/)(\.pxsig|__pxsig__|\.baselines|\.renders|\.reports|px-diff-out|pxsig-diff|target|dist)\//,
  /(^|\/)\.DS_Store$/,
  /(^|\/)\.env/,
];
/** Private notes and reference maps (docs/ui-headless.md): never tracked, whatever their type. */
const PRIVATE = /(^|\/)\.local\//;
const forbiddenPaths = [/\bpackages\/hy-[a-z]/, /\bapps\/hy-[a-z]/];
const HOME = /(?:^|[\s"'`(=])\/(?:Users|home)\/[A-Za-z0-9._-]+\//;
const SKIP_TEXT = /(^|\/)(pnpm-lock\.yaml|Cargo\.lock)$|\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|wasm)$/i;
/** Files that describe these rules and so must name the patterns. */
const SELF = new Set(['scripts/check-clean.mjs', '.gitignore', '.clean-terms']);

function files() {
  if (process.argv.includes('--all') || !existsSync(join(root, '.git'))) {
    const out = [];
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
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
}

const flag = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null;
};
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
  const config = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'pxsig', 'clean-terms');
  const main = mainCheckout();
  for (const f of [config, join(root, '.clean-terms'), main && join(main, '.clean-terms')])
    if (f && existsSync(f)) list.push(...readFileSync(f, 'utf8').split(/\r?\n/));
  return [...new Set(list.map((t) => t.trim()).filter((t) => t && !t.startsWith('#')))];
}

if (process.argv.includes('--require-terms') && !terms().length) {
  console.error('[check-clean] no denylist: create ~/.config/pxsig/clean-terms or .clean-terms (one name per line)');
  process.exit(1);
}

const problems = [];
const denylist = terms().map((t) => ({ t, re: new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`) }));
for (const f of files()) {
  if (PRIVATE.test(f)) {
    problems.push(`${f}: .local/ holds private notes and stays out of the repository`);
    continue;
  }
  if (FORBIDDEN_FILES.some((re) => re.test(f))) {
    problems.push(`${f}: this kind of file stays out of the repository`);
    continue;
  }
  if (SELF.has(f) || SKIP_TEXT.test(f)) continue;
  let text;
  try {
    if (statSync(join(root, f)).size > 4 * 1024 * 1024) continue;
    text = readFileSync(join(root, f), 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\u0000')) continue; // binary
  text.split('\n').forEach((line, i) => {
    const at = `${f}:${i + 1}`;
    if (HOME.test(line)) problems.push(`${at}: absolute home path`);
    for (const re of forbiddenPaths) if (re.test(line)) problems.push(`${at}: a consuming repository's package path (${re.source})`);
    for (const { re } of denylist) if (re.test(line)) problems.push(`${at}: denylisted name`);
  });
}

/** Lines of free text (commit messages, a PR body): names and home paths, as in files. */
function checkText(label, text) {
  text.split('\n').forEach((line, i) => {
    if (HOME.test(line)) problems.push(`${label}:${i + 1}: absolute home path`);
    for (const { re } of denylist) if (re.test(line)) problems.push(`${label}:${i + 1}: denylisted name`);
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
console.log(`[check-clean] ok · ${denylist.length ? `${denylist.length} denylisted names checked` : 'no denylist here (run /scrub on the maintainer\'s machine to check names)'}`);
