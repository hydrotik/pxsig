/**
 * build-identity.mjs — which source a dashboard build came from, so two builds are never taken for
 * each other.
 *
 * A build records `commit` (the full sha of pxsig's own checkout) and `dirty` (whether that
 * checkout had uncommitted changes under the paths that feed the build, FEEDS) in its stamp:
 * BUILD.json for the reference build (scripts/build-record.mjs), pxsig-build.json for `pxsig
 * dashboard build`. Built from an installed package, or outside a git checkout of pxsig, both are
 * null: the build is the release its `pxsig` version names.
 *
 * `pxsig serve` and `pxsig doctor`, run from a checkout, compare a build's commit and dirty state
 * with the checkout's (`sourceMismatch`); a build that records no commit is compared by version
 * only, as before. Nothing here records a path, a user name or a host.
 */
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './files.mjs';
import { spawnSync } from './spawn.mjs';

/** packages/pxsig: this package's folder. */
const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The prebuilt dashboard that ships in this package (report.mjs `prebuiltDashboardDir`). */
export const PREBUILT = join(PKG, 'dist', 'dashboard');

/**
 * The paths of pxsig's checkout that feed a dashboard build, relative to its root: the dashboard's
 * source and build files, the build scripts, the pins and the lockfile. A change anywhere else (the
 * dashboard's tests and fixtures, its store of screens in .pxsig, the docs) does not change the
 * build.
 */
export const FEEDS = [
  'packages/dashboard/src',
  'packages/dashboard/index.html',
  'packages/dashboard/vite.config.mjs',
  'packages/dashboard/build-config.mjs',
  'packages/dashboard/postbuild.mjs',
  'packages/dashboard/package.json',
  'packages/pxsig/package.json',
  'scripts/dashboard-build.mjs',
  'scripts/build-record.mjs',
  'scripts/bundle-sbom.mjs',
  'scripts/ds-fetch.mjs',
  'design-system.json',
  'package.json',
  'pnpm-lock.yaml',
];

/** @typedef {{ commit: string, dirty: boolean }} SourceState */
/**
 * @typedef {object} BuildIdentity
 * @property {string | null} pxsig
 * @property {string | null} commit
 * @property {boolean | null} dirty
 * @property {SourceState | null} designSystem
 * @property {string | null} adapter
 * @property {string | null} builtAt
 */

/**
 * The commit of pxsig's own git checkout and whether it has uncommitted changes under FEEDS, or
 * null when this pxsig is an installed package (its folder is under node_modules), is not in a
 * git checkout, or the checkout is not pxsig's (packages/pxsig at its root is not this folder).
 * @param {string} [pkg]  pxsig's package folder (tests pass another)
 * @returns {SourceState | null}
 */
export function pxsigSource(pkg = PKG) {
  if (pkg.split(sep).includes('node_modules')) return null;
  /** @param {string} dir @param {string[]} args */
  const git = (dir, ...args) => {
    const r = spawnSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (r.status !== 0 || typeof r.stdout !== 'string') throw new Error('git failed');
    return r.stdout.trim();
  };
  try {
    const top = git(pkg, 'rev-parse', '--show-toplevel');
    const own = join(top, 'packages', 'pxsig');
    if (!existsSync(own) || realpathSync(own) !== realpathSync(pkg)) return null;
    const commit = git(top, 'rev-parse', 'HEAD');
    const changes = git(top, 'status', '--porcelain', '--', ...FEEDS);
    return { commit, dirty: changes !== '' };
  } catch {
    // Not a git checkout, or git is not installed.
    return null;
  }
}

/**
 * What a stamp records about its source: `{ commit, dirty }`, both null without a checkout.
 * @param {SourceState | null} state
 * @returns {{ commit: string | null, dirty: boolean | null }}
 */
export const sourceFields = (state) => ({
  commit: state?.commit ?? null,
  dirty: state ? state.dirty : null,
});

/**
 * The identity of the dashboard build in `dir`, as the API and the page show it: no path.
 *   pxsig         the pxsig version it was built for
 *   commit        pxsig's commit it was built from, null for a release build
 *   dirty         whether that checkout had uncommitted changes (null without a commit)
 *   designSystem  the design system's commit and dirty state (the reference build only), or null
 *   adapter       the UI adapter's name, or null when the stamp records none
 *   builtAt       when it was built (ISO 8601, UTC), or null
 * Null when the folder records nothing (no stamp, no BUILD.json).
 * @param {string} dir
 * @returns {BuildIdentity | null}
 */
export function buildIdentity(dir) {
  for (const file of ['pxsig-build.json', 'BUILD.json']) {
    // Either stamp's JSON; each field is checked before it is used.
    const s = /** @type {Record<string, unknown> | null} */ (readJson(join(dir, file), null));
    if (!s || typeof s !== 'object') continue;
    const str = (/** @type {unknown} */ v) => (typeof v === 'string' && v ? v : null);
    const ds =
      s.designSystem && typeof s.designSystem === 'object'
        ? /** @type {Record<string, unknown>} */ (s.designSystem)
        : null;
    const dsCommit = str(ds?.commit);
    // pxsig-build.json: milliseconds; BUILD.json: ISO 8601.
    const at = typeof s.builtAt === 'number' || typeof s.builtAt === 'string' ? s.builtAt : null;
    const when = at === null ? null : new Date(at);
    const commit = str(s.commit);
    return {
      pxsig: str(s.pxsig),
      commit,
      dirty: commit && typeof s.dirty === 'boolean' ? s.dirty : null,
      designSystem: dsCommit ? { commit: dsCommit, dirty: ds?.dirty === true } : null,
      // pxsig-build.json's `adapter` is the adapter's file (dashboard check reads it): its name
      // is `adapterName`. BUILD.json's `adapter` is the name.
      adapter: file === 'BUILD.json' ? str(s.adapter) : str(s.adapterName),
      builtAt: when && !Number.isNaN(when.getTime()) ? when.toISOString() : null,
    };
  }
  return null;
}

/** @param {string} sha */
const short = (sha) => sha.slice(0, 7);

/**
 * Why the build in `dir` is not the checkout's source (`is from commit 1a2b3c4 (the checkout is at
 * 5d6e7f8)`, `was built with uncommitted changes (the checkout has none now)`, `was built before
 * the checkout's uncommitted changes`), or null when it is, when the build records no commit (a
 * release build) or when there is no checkout.
 * @param {string} dir
 * @param {SourceState | null} checkout  pxsigSource()
 */
export function sourceMismatch(dir, checkout) {
  const id = buildIdentity(dir);
  if (!checkout || !id?.commit) return null;
  if (id.commit !== checkout.commit)
    return `is from commit ${short(id.commit)} (the checkout is at ${short(checkout.commit)})`;
  if (id.dirty && !checkout.dirty)
    return 'was built with uncommitted changes (the checkout has none now)';
  if (!id.dirty && checkout.dirty) return "was built before the checkout's uncommitted changes";
  return null;
}
