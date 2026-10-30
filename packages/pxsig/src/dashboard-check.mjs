/**
 * dashboard-check.mjs — `pxsig dashboard check`: every dashboard feature's screens, rendered on the
 * project's adapter build from shipped sample data, in each theme, beside the prebuilt reference
 * dashboard (docs/ui/build-adapter.md, "Verify").
 *
 *   pxsig dashboard check [--ui path] [--build dir] [--out dir] [--reference dir] [--themes dark,light] [--only feature,…]
 *                         [--strict] [--json]
 *
 * What it does, and what it does not:
 *   - Sample data only: the scenarios in the dashboard's fixtures/scenarios.mjs, never the project's
 *     report or store. The screens are fixtures/screens.json, generated from src/ui/features.ts.
 *   - Both builds are served on 127.0.0.1, on ephemeral ports, by a small server in this process
 *     that answers /__pxsig/ from the scenario. A POST is answered and recorded; nothing is written.
 *   - Playwright's Chromium (decision 91's list), 1280×900, reduced motion, the clock fixed and the
 *     caret hidden. For each screen and theme: load, run its actions, wait for its landmark, take a
 *     screenshot, run axe-core, and record page errors.
 *   - Writes only under --out (default node_modules/.cache/pxsig/dashboard-check): index.html (the
 *     gallery), report.json, summary.md and the screenshots.
 *
 * Exit: 0 every screen rendered with no page error · 1 a screen failed, or (with --strict) axe
 * violations · 2 setup: no build, no Chromium, or an adapter for an older major UI contract.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dashboardSource } from './dashboard.mjs';
import { axeScript, launchBrowser } from './lib/capture.mjs';
/** @import { Browser } from 'playwright' */
/** @import { Flags } from './types.js' */
/** @import { CheckPost, DashboardBuildConfig, DashboardCheckReport, DashboardFixtures, DashboardUiTools, ScenarioServer, Screen, ScreenCatalogue, ScreenFeature, ScreenResult, UiAdapter } from './types/t4.js' */
import { buildDirFor, STAMP } from './lib/dashboard-dir.mjs';
import { PXSIG_VERSION } from './lib/workspace.mjs';
import { prebuiltDashboardDir } from './report.mjs';
import { capture, pool } from './dashboard-check/capture.mjs';
import { galleryHtml, summaryMarkdown } from './dashboard-check/gallery.mjs';
import { sampleImages, scenarioServer } from './dashboard-check/server.mjs';

export { FIXED_TIME, VIEWPORT } from './dashboard-check/capture.mjs';
export { galleryHtml, summaryMarkdown } from './dashboard-check/gallery.mjs';
export { scenarioServer } from './dashboard-check/server.mjs';

/** A setup problem: exit 2. */
export class CheckSetupError extends Error {}

const THEMES = ['dark', 'light'];

/** @type {(dir: string, file: string) => Promise<unknown>} */
const load = (dir, file) => import(pathToFileURL(join(dir, file)).href);
/** A path for messages: relative to `cwd` when it is inside it, else absolute. */
const shown = (/** @type {string} */ cwd, /** @type {string} */ p) => {
  const r = relative(cwd, p);
  return r && !r.startsWith('..') ? r : p;
};
/** @returns {unknown} */
const readJson = (/** @type {string} */ f) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * A built dashboard folder: index.html with the data placeholder, and its assets.
 * @param {string | null | undefined} dir
 */
export function isDashboardBuild(dir) {
  if (!dir || !existsSync(join(dir, 'index.html')) || !existsSync(join(dir, 'assets')))
    return false;
  return /<!--pxsig:data-->|<script id="pxsig-data">/.test(
    readFileSync(join(dir, 'index.html'), 'utf8')
  );
}

/**
 * The page address for a screen in a theme: its query (with the theme) and hash.
 * @param {string} base
 * @param {Screen} screen
 * @param {string} theme
 */
export function screenUrl(base, screen, theme) {
  const q = new URLSearchParams(screen.query ?? '');
  q.set('theme', theme);
  return `${base}/report/?${q.toString()}${screen.hash ?? ''}`;
}

/**
 * Run the check. Returns `{ code, report, outDir }`; throws CheckSetupError for exit 2.
 * `browser` (tests) skips the launch.
 * @param {Flags} [flags]
 * @param {string} [cwd]
 * @param {{ log?: (m: string) => unknown, browser?: Browser | null, concurrency?: number, catalogue?: ScreenCatalogue | null, initScript?: string | null }} [opts]
 * @returns {Promise<{ code: number, report: DashboardCheckReport, outDir: string }>}
 */
export async function dashboardCheck(
  flags = {},
  cwd = process.cwd(),
  {
    log = (m) => process.stderr.write(`${m}\n`),
    browser: given = null,
    concurrency = 4,
    catalogue: givenCatalogue = null,
    initScript = null,
  } = {}
) {
  const src = dashboardSource();
  // The dashboard source's own modules and files (packages/dashboard).
  const fixtures = /** @type {DashboardFixtures} */ (await load(src, 'fixtures/scenarios.mjs'));
  const catalogue =
    givenCatalogue ??
    /** @type {ScreenCatalogue | null} */ (readJson(join(src, 'fixtures', 'screens.json')));
  if (!catalogue?.features?.length)
    throw new CheckSetupError(
      `the dashboard's screen list is missing (${join(src, 'fixtures', 'screens.json')})`
    );
  // --only <feature,…>: a part of the check, while working on one feature.
  const only =
    typeof flags.only === 'string'
      ? flags.only
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : null;
  const unknown = (only ?? []).filter((id) => !catalogue.features.some((f) => f.id === id));
  if (unknown.length)
    throw new CheckSetupError(
      `--only names no feature: ${unknown.join(', ')} (features: ${catalogue.features.map((f) => f.id).join(', ')})`
    );
  const features = only
    ? catalogue.features.filter((f) => only.includes(f.id))
    : catalogue.features;

  const build = typeof flags.build === 'string' ? resolve(cwd, flags.build) : buildDirFor(cwd);
  if (!isDashboardBuild(build))
    throw new CheckSetupError(
      `no dashboard build at ${shown(cwd, build)}: run \`pxsig dashboard build\` first, or pass --build <dir>`
    );

  // The adapter, for the contract version and the components it leaves to fallbacks.
  const { resolveAdapter } = /** @type {DashboardBuildConfig} */ (
    await load(src, 'build-config.mjs')
  );
  const { contractStatus, gapsOf, buildManifest, readConformance } =
    /** @type {DashboardUiTools} */ (await load(src, 'ui-tools.mjs'));
  // --ui, else the adapter the build's stamp names (`pxsig dashboard build` records it), else the
  // project's dashboard.ui. Without any of them the fallbacks column stays empty.
  // pxsig-build.json, as `pxsig dashboard build` writes it.
  const stamp = /** @type {{ adapter?: string, adapterContract?: string } | null} */ (
    readJson(join(build, STAMP))
  );
  /** @type {UiAdapter | null} */
  let ui = null;
  try {
    const spec =
      typeof flags.ui === 'string'
        ? flags.ui
        : stamp?.adapter && existsSync(stamp.adapter)
          ? stamp.adapter
          : undefined;
    const { from } = /** @type {DashboardBuildConfig} */ (
      await load(src, 'build-config.mjs')
    ).adapterSpec({ adapter: spec, cwd });
    if (from !== 'default') ui = resolveAdapter({ adapter: spec, cwd });
  } catch {
    ui = null;
  }
  const contract = contractStatus(
    (ui ? readConformance(ui.dir)?.contract : null) ?? stamp?.adapterContract ?? '1.0.0'
  );
  if (contract.status === 'older-major')
    throw new CheckSetupError(
      [`the adapter is ${contract.line}.`, ...(contract.notes ?? [])].join('\n\n')
    );
  const gapRows = ui ? gapsOf({ adapterFile: ui.file, manifest: buildManifest() }).rows : null;
  const fallback = new Set(
    (gapRows ?? []).filter((r) => r.status === 'missing').map((r) => r.name)
  );

  const refDir =
    typeof flags.reference === 'string' ? resolve(cwd, flags.reference) : prebuiltDashboardDir;
  /** @type {DashboardCheckReport['reference']} */
  const reference = { dir: refDir, used: false, note: null };
  if (resolve(refDir) === resolve(build))
    reference.note = 'the build checked is the reference itself';
  else if (!isDashboardBuild(refDir))
    reference.note = existsSync(join(refDir, 'index.html'))
      ? `${refDir} is a placeholder, not a built dashboard`
      : `no prebuilt dashboard at ${refDir}`;
  else reference.used = true;

  const themes =
    typeof flags.themes === 'string'
      ? flags.themes
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : THEMES;
  const bad = themes.filter((x) => !THEMES.includes(x));
  if (bad.length || !themes.length)
    throw new CheckSetupError(`--themes takes dark, light or both (got ${flags.themes})`);

  const outDir =
    typeof flags.out === 'string'
      ? resolve(cwd, flags.out)
      : join(cwd, 'node_modules', '.cache', 'pxsig', 'dashboard-check');
  // Only what this command writes is replaced; anything else in the folder stays.
  for (const f of ['shots', 'index.html', 'report.json', 'summary.md'])
    rmSync(join(outDir, f), { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  /** @type {Browser | null} */
  let browser = given;
  if (!browser) {
    try {
      browser = await launchBrowser({ root: cwd, workspaceRoot: cwd });
    } catch (e) {
      throw new CheckSetupError(
        `no Chromium for the check (${String(/** @type {{ message?: string }} */ (e).message ?? e).split('\n')[0]}): install it with \`npx playwright install chromium\``
      );
    }
  }
  const axe = axeScript({ root: cwd, workspaceRoot: cwd });
  const images = sampleImages();
  /** @type {CheckPost[]} */
  const posts = [];
  /** @type {Map<string, Promise<ScenarioServer>>} */
  const servers = new Map();
  const serverFor = async (/** @type {string} */ dir, /** @type {string} */ scenario) => {
    const k = `${dir}\n${scenario}`;
    if (!servers.has(k)) servers.set(k, scenarioServer({ dir, scenario, fixtures, images, posts }));
    // Set on the line above when it was missing.
    return /** @type {Promise<ScenarioServer>} */ (servers.get(k));
  };

  /** @type {{ f: ScreenFeature, screen: Screen, index: number, theme: string }[]} */
  const jobs = [];
  for (const f of features)
    f.screens.forEach((screen, index) => {
      for (const theme of themes) jobs.push({ f, screen, index, theme });
    });
  log(
    `[dashboard] checking ${jobs.length} screens (${features.length} features × ${themes.join(', ')}) on ${shown(cwd, build)}${reference.used ? ', beside the reference' : ''}`
  );
  const name = (/** @type {{ f: ScreenFeature, index: number, theme: string }} */ j) =>
    `${j.f.id}__${j.index + 1}__${j.theme}.png`;
  /** @type {ScreenResult[]} */
  let screens;
  try {
    screens = await pool(jobs, concurrency, async (j) => {
      const server = await serverFor(build, j.screen.scenario);
      const shot = join(outDir, 'shots', 'adapter', name(j));
      const r = await capture(browser, {
        url: screenUrl(server.base, j.screen, j.theme),
        screen: j.screen,
        shot,
        axe,
        initScript,
      });
      let referenceShot = null;
      if (reference.used) {
        const rs = await serverFor(refDir, j.screen.scenario);
        const file = join(outDir, 'shots', 'reference', name(j));
        const rr = await capture(browser, {
          url: screenUrl(rs.base, j.screen, j.theme),
          screen: j.screen,
          shot: file,
          axe: '',
        });
        referenceShot = rr.rendered ? `shots/reference/${name(j)}` : null;
      }
      return {
        feature: j.f.id,
        title: j.f.title,
        purpose: j.f.purpose,
        components: j.f.components,
        index: j.index,
        scenario: j.screen.scenario,
        theme: j.theme,
        rendered: r.rendered,
        reason: r.reason,
        errors: r.errors,
        axe: r.axe,
        fallbacks: gapRows ? j.f.components.filter((c) => fallback.has(c)) : null,
        ms: r.ms,
        ...(r.settled === false ? { settled: r.settled } : {}),
        ...(r.retried ? { retried: r.retried } : {}),
        shot: r.rendered ? `shots/adapter/${name(j)}` : null,
        referenceShot,
      };
    });
  } finally {
    for (const s of servers.values()) (await s).close();
    if (!given) await browser.close().catch(() => {});
  }

  const failed = screens.filter((x) => !x.rendered).length;
  const withAxe = screens.filter((x) => x.axe.length).length;
  const report = {
    pxsig: PXSIG_VERSION,
    build: shown(cwd, build),
    adapter: ui?.name ?? null,
    contract: { current: contract.current, adapter: contract.adapter, status: contract.status },
    reference: { ...reference, dir: shown(cwd, reference.dir) },
    themes,
    strict: Boolean(flags.strict),
    summary: {
      screens: screens.length,
      rendered: screens.length - failed,
      failed,
      withAxe,
      posts: posts.length,
    },
    screens,
  };
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outDir, 'summary.md'), summaryMarkdown(report));
  writeFileSync(join(outDir, 'index.html'), galleryHtml(report));
  const code = failed || (report.strict && withAxe) ? 1 : 0;
  return { code, report, outDir };
}
