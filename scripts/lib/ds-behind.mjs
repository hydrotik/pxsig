/**
 * ds-behind.mjs — how far the design-system pin (design-system.json) is behind the design system's
 * default branch, and whether the design-system files the reference adapter uses changed since.
 * `pnpm ds:fetch` (scripts/ds-fetch.mjs) reports it after a fetch, locally as a console line and in
 * CI as a `::warning::`; it never fails anything. The source is never printed.
 *
 * The files the adapter uses: there is no committed list of paths (the design system's own
 * docs/llm/pxsig-uses.json names exports, not files), so they are derived from the adapter's
 * imports (scripts/lib/hydrotik-types.mjs `adapterImports`): each name imported from
 * `@hydrotik/design-system[/chart|/styles|/fonts]` is followed through that entry file's
 * `export … from` lines to its folder, and the design system's `src/internal/` (shared helpers), its
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

/** The text of a module (a file, or a folder's index). @param {string} abs */
function moduleText(abs) {
  const file =
    existsSync(abs) && statSync(abs).isDirectory()
      ? ['index.ts', 'index.tsx'].map((f) => path.join(abs, f)).find(existsSync)
      : abs;
  return file && existsSync(file) ? readFileSync(file, 'utf8') : '';
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
    const text = existsSync(entry) ? readFileSync(entry, 'utf8') : '';
    /** @type {[string[], string][]} */
    const named = [
      ...text.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/g),
    ].map((m) => [
      m[1].split(',').map(
        (x) =>
          x
            .trim()
            .split(/\s+as\s+/)
            .pop() ?? ''
      ),
      m[2],
    ]);
    const stars = [...text.matchAll(/export\s*\*\s*from\s*['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
    for (const name of names.keys()) {
      if (spec === '@hydrotik/design-system' && name === 'Icons') continue; // lucide-react
      const hit = named.find(([list]) => list.includes(name))?.[1];
      const via =
        hit ??
        stars.find((s) =>
          new RegExp(`\\b${name}\\b`).test(moduleText(path.resolve(path.dirname(entry), s)))
        );
      const t = via ? target(root, entry, via) : null;
      if (!t) unresolved.push(`${spec}:${name}`);
      else paths.add(statSync(path.join(root, t)).isDirectory() ? `${t}/` : t);
    }
  }
  return { paths: [...paths].sort(), unresolved };
}

/**
 * @typedef {{ commits: number, days: number, changed: string[], unresolved: string[] }} Behind
 */

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
  try {
    git('fetch', '-q', '--no-tags', source, `+HEAD:${UPSTREAM}`);
  } finally {
    // FETCH_HEAD holds the source (scripts/lib/ds-scrub.mjs).
    scrubSource(dir);
  }
  // First-parent: the default branch's own line from its head down to the pin, all of it fetched
  // (a shallow checkout has no older history to walk).
  const commits = Number(git('rev-list', '--count', '--first-parent', `${commit}..${UPSTREAM}`));
  const time = (/** @type {string} */ ref) => Number(git('log', '-1', '--format=%ct', ref));
  const days = Math.max(0, Math.floor((time(UPSTREAM) - time(commit)) / 86400));
  const { paths, unresolved } = usedPaths(dir, imports);
  const changed = commits
    ? git('diff', '--name-only', commit, UPSTREAM, '--', ...paths)
        .split('\n')
        .filter(Boolean)
    : [];
  return { commits, days, changed, unresolved };
}

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
