#!/usr/bin/env node
/**
 * ds-fetch.mjs — `pnpm ds:fetch`: the design system the dashboard builds on, at the commit pinned in
 * design-system.json, fetched into this checkout's git-ignored target/design-system.
 *
 *   node scripts/ds-fetch.mjs [--repo <checkout>]   fetch and install it, unless it is already there
 *   node scripts/ds-fetch.mjs --pin [--repo <dir>]  print the pinned commit (checked) and nothing else
 *
 * The pin: design-system.json at the top of the checkout, `{ "commit": "<40 lower-case hex>" }`. A
 * reviewed commit bumps it (CONTRIBUTING.md, "The design system"); the build (scripts/dashboard-build.mjs)
 * and CI (.github/workflows/screens.yml, release.yml) read the same file.
 *
 * The source, first match wins: PXSIG_DS_SOURCE, else `git config pxsig.dsSource` (a clone's own
 * config, which every worktree of it shares; never committed). Either is a git URL or a local
 * checkout of the design-system monorepo. The source is never printed, in a log line, an error or
 * the stamp: in CI it is a secret URL that may hold a token, and locally a path in a home folder.
 *
 * What it does: `git init` target/design-system, `git fetch --depth 1 <source> <commit>`, a detached
 * checkout, then `pnpm install --frozen-lockfile --ignore-scripts` there. On success it writes
 * target/design-system.stamp.json (`{ "commit": … }`), so a second run with the same pin is a no-op;
 * a changed pin (or a checkout at another commit) fetches again, into a fresh folder. The folder is
 * this script's: anything changed in it is replaced on the next fetch.
 *
 * Then, when the source can be read, how far the pin is behind the design system's default branch
 * (scripts/lib/ds-behind.mjs): a warning past MAX_BEHIND_COMMITS (20) commits or MAX_BEHIND_DAYS (14)
 * days, a notice otherwise, either naming whether the design-system files the reference adapter uses
 * changed since the pin; `::warning::` / `::notice::` in GitHub Actions. It never fails the run.
 * The build (scripts/dashboard-build.mjs) fetches without this check.
 *
 * Keep the checkout inside the worktree (target/ is the place): with the design system under a
 * system temp folder such as /private/tmp, the dashboard's Vite build fails, because it resolves
 * that path as a relative one.
 *
 * Exit: 0 in place · 1 no source, a bad pin, or a fetch or install that failed · 2 usage.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { behind, describe } from './lib/ds-behind.mjs';

const here = fileURLToPath(new URL('..', import.meta.url));
const SHA = /^[0-9a-f]{40}$/;
export const PIN_FILE = 'design-system.json';

/** A setup problem a person fixes: its message is the whole report. */
export class DsFetchError extends Error {}

/** @param {string} repo */
export const dsDir = (repo) => join(repo, 'target', 'design-system');
/** @param {string} repo */
export const stampFile = (repo) => join(repo, 'target', 'design-system.stamp.json');

/**
 * The pinned commit, checked: 40 lower-case hex.
 * @param {string} repo
 * @returns {string}
 */
export function readPin(repo) {
  const file = join(repo, PIN_FILE);
  /** @type {unknown} */
  let commit;
  try {
    // design-system.json: `commit` is checked below.
    commit = /** @type {{ commit?: unknown }} */ (JSON.parse(readFileSync(file, 'utf8'))).commit;
  } catch (e) {
    throw new DsFetchError(
      `[ds-fetch] cannot read ${PIN_FILE}: ${/** @type {Error} */ (e).message}`
    );
  }
  if (typeof commit !== 'string' || !SHA.test(commit))
    throw new DsFetchError(
      `[ds-fetch] ${PIN_FILE}: "commit" must be the design system's full 40-character commit SHA (lower-case hex); got ${JSON.stringify(commit)}`
    );
  return commit;
}

/**
 * Where to fetch from: PXSIG_DS_SOURCE, else `git config pxsig.dsSource` in `repo`; null when
 * neither is set. The value is for git only: never print it.
 * @param {{ repo: string, env?: NodeJS.ProcessEnv }} o
 * @returns {string | null}
 */
export function dsSource({ repo, env = process.env }) {
  if (env.PXSIG_DS_SOURCE) return env.PXSIG_DS_SOURCE;
  const r = spawnSync('git', ['-C', repo, 'config', '--get', '--path', 'pxsig.dsSource'], {
    encoding: 'utf8',
    env,
  });
  const v = r.status === 0 ? r.stdout.trim() : '';
  return v || null;
}

export const NO_SOURCE = [
  '[ds-fetch] no design-system source. The dashboard in this repository builds on the hydrotik',
  'design system, fetched at the commit in design-system.json. Name where to fetch it from once per',
  'clone (every worktree of it shares the setting; it is never committed):',
  '',
  '  git config pxsig.dsSource <git URL or local checkout of the design-system monorepo>',
  '',
  'or set PXSIG_DS_SOURCE for one command. Then run `pnpm ds:fetch` (the build runs it too).',
].join('\n');

/**
 * Text with the source, and anything that looks like a URL or a host path, taken out.
 * @param {string} text
 * @param {string} source
 */
export function redact(text, source) {
  let out = text;
  /** @type {string[]} */
  const parts = [];
  try {
    const u = new URL(source);
    parts.push(u.host, u.hostname, u.username, u.password, u.pathname);
  } catch {
    // not a URL: scp-like `user@host:path`, or a folder
    const scp = /^[^@\s]+@([^:\s]+):(.+)$/.exec(source);
    if (scp) parts.push(scp[1], scp[2]);
  }
  for (const p of [source, ...parts.map((x) => decodeURIComponent(x))].filter((x) => x.length > 2))
    out = out.split(p).join('<source>');
  return out
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi, '<url>')
    .replace(/[^\s'"]+@[^\s:'"]+:[^\s'"]*/g, '<url>')
    .replace(/(?:^|(?<=[\s'"]))(?:\/|[A-Za-z]:\\)[^\s'"]+/g, '<path>');
}

/**
 * Whether target/design-system is the pinned commit, installed.
 * @param {string} repo
 * @param {string} commit
 */
export function isCurrent(repo, commit) {
  try {
    // The stamp, as `fetchDesignSystem` writes it.
    const stamp = /** @type {{ commit?: unknown }} */ (
      JSON.parse(readFileSync(stampFile(repo), 'utf8'))
    );
    if (stamp.commit !== commit) return false;
  } catch {
    return false;
  }
  const head = spawnSync('git', ['-C', dsDir(repo), 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return head.status === 0 && head.stdout.trim() === commit;
}

/**
 * The design system's dependencies, as its lockfile pins them; no install scripts. pnpm runs
 * through Node when pnpm started us (`npm_execpath` is its script), else from PATH (through a shell
 * on Windows, where it is a `.cmd` shim).
 * @param {string} dir
 */
export function pnpmInstall(dir) {
  const ep = process.env.npm_execpath ?? '';
  const viaNode = /pnpm\.c?js$/i.test(ep.split(/[\\/]/).pop() ?? '');
  const args = ['install', '--frozen-lockfile', '--ignore-scripts'];
  const r = spawnSync(viaNode ? process.execPath : 'pnpm', viaNode ? [ep, ...args] : args, {
    cwd: dir,
    stdio: 'inherit',
    shell: !viaNode && process.platform === 'win32',
  });
  if (r.status !== 0)
    throw new DsFetchError(
      `[ds-fetch] pnpm install in target/design-system failed (exit ${r.status ?? r.error?.message})`
    );
}

/**
 * Fetch `commit` from `source` into target/design-system (a fresh folder) and install it.
 * @param {object} o
 * @param {string} o.repo
 * @param {string} o.source
 * @param {string} o.commit
 * @param {(dir: string) => void} [o.install]  default: `pnpm install --frozen-lockfile --ignore-scripts`
 * @param {(line: string) => void} [o.log]
 */
export function fetchDesignSystem({
  repo,
  source,
  commit,
  install = pnpmInstall,
  log = console.log,
}) {
  const dir = dsDir(repo);
  rmSync(stampFile(repo), { force: true });
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // No prompt for credentials (CI has no terminal), no pager.
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' };
  /** @param {string} what @param {string[]} args */
  const git = (what, args) => {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env });
    if (r.status !== 0) {
      const said = redact(`${r.stderr ?? ''}${r.stdout ?? ''}`.trim(), source);
      throw new DsFetchError(
        `[ds-fetch] git ${what} failed (exit ${r.status ?? r.error?.message})${said ? `:\n${said}` : ''}`
      );
    }
  };
  log(`[ds-fetch] fetching the design system at ${commit}`);
  git('init', ['init', '-q']);
  git('fetch', ['fetch', '-q', '--depth', '1', '--no-tags', source, commit]);
  git('checkout', ['-c', 'advice.detachedHead=false', 'checkout', '-q', '--detach', 'FETCH_HEAD']);
  log('[ds-fetch] installing its dependencies');
  install(dir);
  writeFileSync(stampFile(repo), `${JSON.stringify({ commit }, null, 2)}\n`);
  log(`[ds-fetch] target/design-system is at ${commit}`);
}

/**
 * target/design-system at the pin: nothing to do when it is there, else fetched from the source.
 * Returns the folder.
 * @param {object} o
 * @param {string} [o.repo]
 * @param {NodeJS.ProcessEnv} [o.env]
 * @param {(dir: string) => void} [o.install]
 * @param {(line: string) => void} [o.log]
 * @returns {string}
 */
export function ensureDesignSystem({
  repo = here,
  env = process.env,
  install,
  log = console.log,
} = {}) {
  const commit = readPin(repo);
  if (isCurrent(repo, commit)) {
    log(`[ds-fetch] target/design-system is at ${commit}: nothing to fetch`);
    return dsDir(repo);
  }
  const source = dsSource({ repo, env });
  if (!source) throw new DsFetchError(NO_SOURCE);
  fetchDesignSystem({ repo, source, commit, install, log });
  return dsDir(repo);
}

/**
 * Say how far the pin is behind the default branch (scripts/lib/ds-behind.mjs). Never throws; the
 * source is never in what it says.
 * @param {object} [o]
 * @param {string} [o.repo]
 * @param {NodeJS.ProcessEnv} [o.env]
 * @param {(line: string) => void} [o.log]
 * @returns {import('./lib/ds-behind.mjs').Behind | null}
 */
export function reportBehind({ repo = here, env = process.env, log = console.log } = {}) {
  const gh = !!env.GITHUB_ACTIONS;
  const source = dsSource({ repo, env });
  if (!source) {
    log('[ds-fetch] how far the pin is behind: not checked (no source)');
    return null;
  }
  try {
    const b = behind({ dir: dsDir(repo), source, commit: readPin(repo) });
    const { level, text } = describe(b);
    log(gh ? `::${level}::${text}` : `[ds-fetch] ${level === 'warning' ? 'warning: ' : ''}${text}`);
    return b;
  } catch (e) {
    log(
      `[ds-fetch] how far the pin is behind: not checked (${redact(String(/** @type {Error} */ (e).message), source)})`
    );
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--repo');
  const repo = at >= 0 ? resolve(args[at + 1] ?? '') : here;
  const rest = at < 0 ? args : args.filter((_, i) => i !== at && i !== at + 1);
  if ((at >= 0 && !args[at + 1]) || rest.some((a) => a !== '--pin')) {
    console.error('usage: ds-fetch.mjs [--pin] [--repo <checkout>]');
    process.exit(2);
  }
  try {
    if (rest.includes('--pin')) console.log(readPin(repo));
    else {
      ensureDesignSystem({ repo });
      reportBehind({ repo });
    }
  } catch (e) {
    // DsFetchError carries its whole report; anything else is unexpected, and may name the source.
    console.error(
      e instanceof DsFetchError
        ? e.message
        : `[ds-fetch] ${redact(String(/** @type {Error} */ (e).message), dsSource({ repo }) ?? '')}`
    );
    process.exit(1);
  }
}
