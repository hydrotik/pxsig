/**
 * build-identity.mjs — which source a dashboard build came from, so two builds are never taken for
 * each other.
 *
 * A build records `commit` (the full sha of pxsig's own checkout), `dirty` (whether that checkout
 * had uncommitted changes under the paths that feed the build, FEEDS) and `changes` (a sha256 of
 * those changes, so two modified builds of one commit are told apart) in its stamp:
 * BUILD.json for the reference build (scripts/build-record.mjs), pxsig-build.json for `pxsig
 * dashboard build`. Built from an installed package, or outside a git checkout of pxsig, all three
 * are null: the build is the release its `pxsig` version names.
 *
 * `pxsig serve` and `pxsig doctor`, run from a checkout, compare a build's commit and dirty state
 * with the checkout's (`sourceMismatch`): a build is out of date when FEEDS differ between its
 * commit and HEAD, or its uncommitted changes are not the checkout's. A commit that touches nothing
 * in FEEDS leaves a build current. A build that records no commit is compared by version only. Nothing here records a path, a user name or a host.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
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

/** @typedef {{ commit: string, dirty: boolean }} DsState */
/**
 * pxsig's checkout: its commit, whether FEEDS have uncommitted changes and their fingerprint
 * (null when clean), and `sameFeeds(c)`, whether FEEDS at commit `c` are as at HEAD (absent: only
 * the same commit is).
 * @typedef {object} SourceState
 * @property {string} commit
 * @property {boolean} dirty
 * @property {string | null} [changes]
 * @property {(commit: string) => boolean} [sameFeeds]
 */
/**
 * @typedef {object} BuildIdentity
 * @property {string | null} pxsig
 * @property {string | null} commit
 * @property {boolean | null} dirty
 * @property {string | null} changes
 * @property {DsState | null} designSystem
 * @property {string | null} adapter
 * @property {string | null} builtAt
 */

/**
 * The sha256 of the uncommitted changes under FEEDS: the diff against HEAD (staged or not), then
 * each untracked file's path and contents. Null when there are none.
 * @param {(...args: string[]) => string} git  git in the checkout's root
 * @param {string} top  the checkout's root
 */
function fingerprint(git, top) {
  const diff = git('diff', 'HEAD', '--binary', '--no-ext-diff', '--no-color', '--', ...FEEDS);
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z', '--', ...FEEDS)
    .split('\0')
    .filter(Boolean)
    .sort();
  if (!diff && !untracked.length) return null;
  const h = createHash('sha256').update(diff);
  for (const f of untracked) h.update(`\0${f}\0`).update(readFileSync(join(top, f)));
  return h.digest('hex');
}

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
  const run = (dir, ...args) =>
    spawnSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 256 * 1024 * 1024,
    });
  /** @param {string} dir @param {string[]} args */
  const git = (dir, ...args) => {
    const r = run(dir, ...args);
    if (r.status !== 0 || typeof r.stdout !== 'string') throw new Error('git failed');
    return r.stdout.trim();
  };
  try {
    const top = git(pkg, 'rev-parse', '--show-toplevel');
    const own = join(top, 'packages', 'pxsig');
    // The OS's own real path: on Windows git names the long path, a temp folder may be an 8.3 one.
    if (!existsSync(own) || realpathSync.native(own) !== realpathSync.native(pkg)) return null;
    const commit = git(top, 'rev-parse', 'HEAD');
    const changes = fingerprint((...a) => git(top, ...a), top);
    return {
      commit,
      dirty: changes !== null,
      changes,
      // `git diff --quiet` exits 0 when FEEDS are the same, 1 when not; an unknown commit fails.
      sameFeeds: (c) => run(top, 'diff', '--quiet', c, commit, '--', ...FEEDS).status === 0,
    };
  } catch {
    // Not a git checkout, or git is not installed.
    return null;
  }
}

/**
 * What a stamp records about its source: `{ commit, dirty, changes }`, all null without a checkout.
 * @param {SourceState | null} state
 * @returns {{ commit: string | null, dirty: boolean | null, changes: string | null }}
 */
export const sourceFields = (state) => ({
  commit: state?.commit ?? null,
  dirty: state ? state.dirty : null,
  changes: state?.changes ?? null,
});

/**
 * The identity of the dashboard build in `dir`, as the API and the page show it: no path.
 *   pxsig         the pxsig version it was built for
 *   commit        pxsig's commit it was built from, null for a release build
 *   dirty         whether that checkout had uncommitted changes (null without a commit)
 *   changes       the fingerprint of those changes (sha256), null when there were none
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
      changes: commit && s.dirty === true ? str(s.changes) : null,
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
 * Why the build in `dir` is not the checkout's source, or null when it is: its commit is HEAD, or
 * FEEDS are the same at both (`checkout.sameFeeds`), and its uncommitted changes are the
 * checkout's (by fingerprint). Null too when the build records no commit (a release build) or
 * there is no checkout.
 * @param {string} dir
 * @param {SourceState | null} checkout  pxsigSource()
 */
export function sourceMismatch(dir, checkout) {
  const id = buildIdentity(dir);
  if (!checkout || !id?.commit) return null;
  if (id.commit !== checkout.commit && !checkout.sameFeeds?.(id.commit))
    return `is from commit ${short(id.commit)} (the checkout is at ${short(checkout.commit)}, with other dashboard sources)`;
  if (id.dirty && !checkout.dirty)
    return 'was built with uncommitted changes (the checkout has none now)';
  if (!id.dirty && checkout.dirty) return "was built before the checkout's uncommitted changes";
  // Both modified: the same changes, unless both fingerprints are known and differ.
  if (id.dirty && id.changes && checkout.changes && id.changes !== checkout.changes)
    return "was built with other uncommitted changes than the checkout's";
  return null;
}
