/**
 * ds-behind.mjs — how far the design-system pin (design-system.json) is behind the design system's
 * default branch, and whether the design-system files the reference adapter uses changed since.
 * `pnpm ds:fetch` (scripts/ds-fetch.mjs) reports it after a fetch, locally as a console line and in
 * CI as a `::warning::`; it never fails anything. The source is never printed.
 *
 * The files the adapter uses: there is no committed list of paths (the design system's own
 * docs/llm/pxsig-uses.json names exports, not files), so they are derived from the adapter's
 * imports (scripts/lib/hydrotik-types.mjs `adapterImports`): each name imported from
 * `@hydrotik/design-system[/chart|/styles|/styles/scoped|/fonts]` is followed through that entry
 * file's `export … from` lines, and those of any barrel they lead to, to its folder, and the design system's `src/internal/` (shared helpers), its
 * package.json and the whole `@hydrotik/tokens` and `@hydrotik/theme-provider` packages are always
 * included. A name no entry line accounts for is listed as unresolved. Only the adapter's direct
 * imports are followed: a component's own imports of other components are not.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { packagesIn } from '../../packages/dashboard/src/ui/adapters/hydrotik/vite.mjs';
import { adapterImports } from './hydrotik-types.mjs';
import { scrubSource } from './ds-scrub.mjs';

/** Warn when the pin is more than this many commits behind the default branch (first-parent). */
export const MAX_BEHIND_COMMITS = 20;
/** …or when the default branch's head is more than this many days newer than the pin. */
export const MAX_BEHIND_DAYS = 14;
/** The ref the default branch's head is fetched into, inside target/design-system. */
const UPSTREAM = 'refs/pxsig/upstream';

/** The entry file of each design-system specifier the adapter may import. */
const ENTRIES = {
  '@hydrotik/design-system': 'src/index.ts',
  '@hydrotik/design-system/chart': 'src/chart.ts',
  '@hydrotik/design-system/styles': 'src/styles.ts',
  '@hydrotik/design-system/styles/scoped': 'src/styles-scoped.ts',
  '@hydrotik/design-system/fonts': 'src/fonts.ts',
};

/** @param {string} p */
const posix = (p) => p.split(path.sep).join('/');

/**
 * The module file or folder an entry's relative specifier names, relative to `root`.
 * @param {string} root @param {string} from the entry file @param {string} spec
 */
function target(root, from, spec) {
  const abs = path.resolve(path.dirname(from), spec);
  for (const c of [abs, ...['.ts', '.tsx'].map((e) => abs + e)])
    if (existsSync(c)) return posix(path.relative(root, c));
  return null;
}

/** The file of a module: itself, with an extension, or a folder's index. @param {string} abs */
function moduleFile(abs) {
  if (existsSync(abs) && statSync(abs).isDirectory())
    return ['index.ts', 'index.tsx'].map((f) => path.join(abs, f)).find(existsSync) ?? null;
  return (
    [abs, `${abs}.ts`, `${abs}.tsx`].find((c) => existsSync(c) && statSync(c).isFile()) ?? null
  );
}

/** The text of a module. @param {string} abs */
function moduleText(abs) {
  const file = moduleFile(abs);
  return file ? readFileSync(file, 'utf8') : '';
}

/**
 * The relative specifier a module's export of `name` comes from: its `export { name } from` line,
 * else the first `export * from` module that mentions it. `null`: no line accounts for it.
 * @param {string} text @param {string} file @param {string} name
 */
function exportVia(text, file, name) {
  const named = [
    ...text.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/g),
  ].find((m) =>
    m[1]
      .split(',')
      .map(
        (x) =>
          x
            .trim()
            .split(/\s+as\s+/)
            .pop() ?? ''
      )
      .includes(name)
  )?.[2];
  if (named) return named;
  const stars = [...text.matchAll(/export\s*\*\s*from\s*['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
  return (
    stars.find((s) =>
      new RegExp(`\\b${name}\\b`).test(moduleText(path.resolve(path.dirname(file), s)))
    ) ?? null
  );
}

/**
 * Where `name` is defined, from an entry file: its export lines followed through every barrel
 * (a module that itself only re-exports it) to the folder or file that is not one.
 * @param {string} root @param {string} entry @param {string} name
 */
function definedIn(root, entry, name) {
  let file = entry;
  let found = null;
  for (let depth = 0; depth < 8; depth++) {
    const via = exportVia(readFileSync(file, 'utf8'), file, name);
    if (!via) break;
    const t = target(root, file, via);
    if (!t) break;
    found = t;
    const next = moduleFile(path.join(root, t));
    if (!next || statSync(path.join(root, t)).isDirectory()) break;
    file = next;
  }
  return found;
}

/**
 * The design-system paths the adapter uses, relative to the checkout `root`.
 * @param {string} root a design-system checkout
 * @param {Map<string, Map<string, Set<string>>>} [imports] the adapter's imports
 * @returns {{ paths: string[], unresolved: string[] }}
 */
export function usedPaths(root, imports = adapterImports()) {
  const pkgs = packagesIn(root);
  const rel = (/** @type {string} */ p) => posix(path.relative(root, p));
  const ds = pkgs['@hydrotik/design-system'];
  /** @type {Set<string>} */
  const paths = new Set();
  /** @type {string[]} */
  const unresolved = [];
  for (const name of ['@hydrotik/tokens', '@hydrotik/theme-provider'])
    if (pkgs[name]) paths.add(`${rel(pkgs[name])}/`);
  if (!ds) return { paths: [...paths].sort(), unresolved: ['@hydrotik/design-system'] };
  paths.add(`${rel(ds)}/package.json`);
  if (existsSync(path.join(ds, 'src', 'internal'))) paths.add(`${rel(ds)}/src/internal/`);
  for (const [spec, names] of imports) {
    const entryRel = /** @type {Record<string, string>} */ (ENTRIES)[spec];
    if (!entryRel) continue;
    const entry = path.join(ds, entryRel);
    paths.add(rel(entry));
    for (const name of names.keys()) {
      if (spec === '@hydrotik/design-system' && name === 'Icons') continue; // lucide-react
      const t = existsSync(entry) ? definedIn(root, entry, name) : null;
      if (!t) unresolved.push(`${spec}:${name}`);
      else paths.add(statSync(path.join(root, t)).isDirectory() ? `${t}/` : t);
    }
  }
  return { paths: [...paths].sort(), unresolved };
}

/**
 * `ref`: what the pin was compared with. `HEAD` for a git URL (the remote's default branch); for a
 * local checkout its `origin/HEAD` (the default branch it was cloned from), else its own `HEAD`.
 * @typedef {{ commits: number, days: number, changed: string[], unresolved: string[],
 *   ref?: 'HEAD' | 'origin/HEAD' | 'local HEAD' }} Behind
 */

/**
 * The ref of `source` that stands for the design system's default branch. A git URL's `HEAD` is
 * the remote's default branch; a local checkout's `HEAD` is whatever it has checked out, so its
 * `origin/HEAD` (the branch it tracks, resolved to its name) is used when it has one.
 * @param {string} source never printed
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ refspec: string, ref: NonNullable<Behind['ref']> }}
 */
export function upstreamRef(source, env) {
  if (!existsSync(source) || !statSync(source).isDirectory())
    return { refspec: 'HEAD', ref: 'HEAD' };
  const r = spawnSync('git', ['-C', source, 'symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], {
    encoding: 'utf8',
    env,
  });
  const name = r.status === 0 ? r.stdout.trim() : '';
  return name ? { refspec: name, ref: 'origin/HEAD' } : { refspec: 'HEAD', ref: 'local HEAD' };
}

/**
 * The default branch's head fetched from `source` into the checkout at `dir` (which holds the
 * pinned commit), then compared with the pin.
 * @param {object} o
 * @param {string} o.dir     target/design-system, at the pin
 * @param {string} o.source  never printed
 * @param {string} o.commit  the pin
 * @param {Map<string, Map<string, Set<string>>>} [o.imports] the adapter's imports (default: its own)
 * @returns {Behind}
 */
export function behind({ dir, source, commit, imports }) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' };
  /** @param {string[]} args */
  const git = (...args) => {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env });
    if (r.status !== 0)
      throw new Error(`git ${args[0]} failed (exit ${r.status}): ${r.stderr.trim()}`);
    return r.stdout.trim();
  };
  const up = upstreamRef(source, env);
  try {
    git('fetch', '-q', '--no-tags', source, `+${up.refspec}:${UPSTREAM}`);
  } finally {
    // FETCH_HEAD holds the source (scripts/lib/ds-scrub.mjs).
    scrubSource(dir);
  }
  // First-parent: the default branch's own line from its head down to the pin. The checkout is
  // shallow (ds-fetch fetches the pin at depth 1), so git knows none of the pin's ancestors, and
  // `pin..head` leaves out only the pin itself. When the line passes through the pin the walk stops
  // there and the count is exact; otherwise (the pin came in through a merge's second parent, or
  // the source's head is behind the pin or on another line) the walk runs on through history the
  // pin already has and counts all of it. The pin's history is fetched first in that case.
  const line = git('rev-list', '--first-parent', UPSTREAM).split('\n');
  let commits = line.indexOf(commit);
  if (commits < 0) {
    if (git('rev-parse', '--is-shallow-repository') === 'true')
      try {
        git('fetch', '-q', '--no-tags', '--unshallow', source, commit);
      } finally {
        scrubSource(dir);
      }
    commits = Number(git('rev-list', '--count', '--first-parent', `${commit}..${UPSTREAM}`));
  }
  const time = (/** @type {string} */ ref) => Number(git('log', '-1', '--format=%ct', ref));
  const days = Math.max(0, Math.floor((time(UPSTREAM) - time(commit)) / 86400));
  const { paths, unresolved } = usedPaths(dir, imports);
  const changed = commits
    ? git('diff', '--name-only', commit, UPSTREAM, '--', ...paths)
        .split('\n')
        .filter(Boolean)
    : [];
  return { commits, days, changed, unresolved, ref: up.ref };
}

/** How the message names what the pin was compared with. */
const AGAINST = {
  HEAD: " (the source's HEAD)",
  'origin/HEAD': " (the source checkout's origin/HEAD)",
  'local HEAD': " (the source checkout's HEAD: it has no origin/HEAD)",
};

/**
 * What to say: a warning when the pin is past either threshold, else a notice; with the used paths
 * that changed (their folders, at most a few named).
 * @param {Behind} b
 * @returns {{ level: 'warning' | 'notice', text: string }}
 */
export function describe(b) {
  const over = b.commits > MAX_BEHIND_COMMITS || b.days > MAX_BEHIND_DAYS;
  const folders = [...new Set(b.changed.map((f) => f.replace(/\/[^/]+$/, '/')))];
  const shown =
    folders.slice(0, 8).join(', ') + (folders.length > 8 ? `, and ${folders.length - 8} more` : '');
  const text =
    `the design-system pin is ${b.commits} commit${b.commits === 1 ? '' : 's'} and ${b.days} day${b.days === 1 ? '' : 's'} behind its default branch` +
    (b.ref ? AGAINST[b.ref] : '') +
    (over ? ` (more than ${MAX_BEHIND_COMMITS} commits or ${MAX_BEHIND_DAYS} days)` : '') +
    (b.commits === 0
      ? ''
      : b.changed.length
        ? `; files the reference adapter uses changed since the pin (${b.changed.length}): ${shown}. Bump design-system.json in a reviewed commit (CONTRIBUTING.md, "The design system")`
        : '; none of the files the reference adapter uses changed since the pin') +
    (b.unresolved.length
      ? `; adapter imports not traced to a file: ${b.unresolved.join(', ')}`
      : '');
  return { level: over ? 'warning' : 'notice', text };
}
