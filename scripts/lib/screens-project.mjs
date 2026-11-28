/**
 * screens-project.mjs — the stores pxsig's own dashboard screens are checked against
 * (scripts/screens-check.mjs, scripts/screens-container.mjs, docs/releasing.md, "pxsig's own
 * baselines").
 *
 *   pxsig   the reference build (the design system's adapter), store packages/dashboard/.pxsig: the
 *           fixture screens and the live ones, locks in packages/dashboard/fixtures/locked/
 *   plain   the plain adapter's build (`PXSIG_UI_ADAPTER=plain`), store
 *           packages/dashboard/plain/.pxsig: the fixture screens only (a required check in CI,
 *           .github/workflows/screens.yml), locks in
 *           packages/dashboard/plain/locked/ (with its geometry.json and unstable.json), never in
 *           fixtures/, which ships in the npm package
 *
 * Both use the same entry ids, so an entry of one names the same screen as the entry of the other.
 * `--project <name>` picks one (default pxsig); `--fixtures-only` leaves the live screens out of
 * any project's manifest, as plain always does.
 *
 * Zero dependencies.
 */
import { join, relative } from 'node:path';

/**
 * @typedef {object} ScreensProject
 * @property {string} name          the `--project` value
 * @property {string} dir           the project folder (its pxsig.config.json; the store is `<dir>/.pxsig`)
 * @property {string} build         the dashboard build checked by default
 * @property {string} locks         the locked structure folder (`<section>/<name>-<n>.aria.yml`)
 * @property {string} geometry      the locked geometry file
 * @property {string} unstable      the allow-list of unstable screens (lib/screens-repeat.mjs)
 * @property {boolean} fixturesOnly no live screens: none rendered, none in the manifest
 * @property {boolean} fidelity     a fidelity finding fails the check, as an axe one does (both
 *   projects; `pxsig dashboard check` fails on one too)
 * @property {string | null} ariaReference another project's locks, compared with this run's
 *   structure in an advisory report (lib/screens-findings.mjs), never failing
 * @property {string} rel           `dir` relative to the repository, for messages
 */

/**
 * The project `name` of the checkout at `repo`.
 * @param {string} repo
 * @param {string} [name]
 * @param {{ fixturesOnly?: boolean }} [o]
 * @returns {ScreensProject}
 */
export function screensProject(repo, name = 'pxsig', { fixturesOnly = false } = {}) {
  const dashboard = join(repo, 'packages', 'dashboard');
  /** @type {Record<string, Omit<ScreensProject, 'name' | 'rel'>>} */
  const known = {
    pxsig: {
      dir: dashboard,
      build: join(repo, 'packages', 'pxsig', 'dist', 'dashboard'),
      locks: join(dashboard, 'fixtures', 'locked'),
      geometry: join(dashboard, 'fixtures', 'locked', 'geometry.json'),
      unstable: join(dashboard, 'fixtures', 'unstable.json'),
      fixturesOnly,
      fidelity: true,
      ariaReference: null,
    },
    plain: {
      dir: join(dashboard, 'plain'),
      build: join(repo, 'target', 'dashboard-plain'),
      locks: join(dashboard, 'plain', 'locked'),
      geometry: join(dashboard, 'plain', 'locked', 'geometry.json'),
      unstable: join(dashboard, 'plain', 'locked', 'unstable.json'),
      fixturesOnly: true,
      fidelity: true,
      ariaReference: join(dashboard, 'fixtures', 'locked'),
    },
  };
  const p = known[name];
  if (!p)
    throw new Error(
      `--project ${name}: no such screens project (${Object.keys(known).join(', ')})`
    );
  return { name, ...p, rel: relative(repo, p.dir).split('\\').join('/') };
}

/**
 * The project the screens-check arguments name (`--project`, `--fixtures-only`).
 * @param {string} repo
 * @param {string[]} args
 */
export function projectOfArgs(repo, args) {
  const i = args.indexOf('--project');
  return screensProject(repo, i >= 0 ? args[i + 1] : undefined, {
    fixturesOnly: args.includes('--fixtures-only'),
  });
}

/**
 * The lines screens-check prints after its verdict for this project: how to update the locks, how
 * to review.
 * @param {ScreensProject} p
 * @param {string} repo
 */
export const projectHints = (p, repo) => {
  const flags = p.name === 'pxsig' ? '' : ` --project ${p.name}`;
  const pxsigBin = relative(p.dir, join(repo, 'packages', 'pxsig', 'bin', 'pxsig.mjs'))
    .split('\\')
    .join('/');
  return {
    locks: `[screens] a structure or geometry change made on purpose: pnpm screens:check${flags} --update-locks, and commit ${relative(repo, p.locks).split('\\').join('/')}`,
    review: `[screens] review them: cd ${p.rel} && node ${pxsigBin} serve (approve with serve --link)`,
  };
};
