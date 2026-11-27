#!/usr/bin/env node
/**
 * screens-check.mjs — pxsig's own baselines: every screen of the dashboard (the catalogue `pxsig
 * dashboard check` renders, each in both themes) checked against packages/dashboard/.pxsig, the
 * store of the `pxsig` project (packages/dashboard/pxsig.config.json).
 *
 *   node scripts/screens-check.mjs [--project pxsig|plain] [--fixtures-only] [--build <dir>] [--only <feature,…>] [--update-locks] [--no-live] [--repeat <n>]
 *   pnpm screens:check …   (the same, in pxsig's container: scripts/screens-container.mjs)
 *
 * --project plain checks the plain adapter's build against its own store, packages/dashboard/plain
 * (lib/screens-project.mjs: fixture screens only, its own locks, and an advisory comparison of its
 * structure with the reference's locks). The rest of this says pxsig's.
 * Each run also writes its findings by kind to the store's reports/findings.md (lib/screens-findings.mjs).
 *
 * --build is the dashboard to check: the reference build (`pnpm build:dashboard`, the design
 * system pinned in design-system.json), by default packages/pxsig/dist/dashboard.
 * The baselines are rendered in pxsig's container (docs/releasing.md, "pxsig's own baselines");
 * a render elsewhere differs in fonts, and its rows say so (`envMatch`).
 *
 * It writes the store as `pxsig check` does, and no baseline: manifest.json (the entries, with
 * `source: dashboard-screens`), renders/latest/<id>.png, diffs/latest, reports/check.json,
 * summary.md and junit.xml (and each screen's text record beside its render, `<id>.boxes.json`, with
 * the project's `text` on). A person reviews and approves them with `pxsig serve` in
 * packages/dashboard (approving needs `pxsig serve --link`).
 *
 * It also checks each screen's locked structure and geometry (scripts/lib/screen-locks.mjs): its
 * accessibility snapshot and its feature's anchors against packages/dashboard/fixtures/locked/.
 * `--update-locks` rewrites those files instead, for a change made on purpose; the current ones are
 * always written to reports/structure/.
 *
 * An entry id is `<section>--<feature>-<n>@<theme>`: inspector.header's first screen in the dark
 * theme is `inspector--header-1@dark`, so the review groups screens by section.
 *
 * Live screens (scripts/live/): the real `pxsig serve` on a staged example, driven through the
 * reviewer's flows, `live--<flow>-<n>@<theme>`, checked the same way after the fixture screens.
 * `--only` takes fixture and live features alike; `--no-live` leaves the live screens out;
 * `--repeat <n>` runs the flows n times (default 2) and fails a step whose runs differ; with
 * n > 1 each fixture screen renders twice, and one whose renders differ fails
 * (lib/screens-repeat.mjs).
 * Every rendered screen must also have no accessibility (axe), layout, alignment or fidelity
 * finding, as `pxsig dashboard check --strict` requires, and the top bar no `top-bar` finding.
 *
 * Exit: 0 every screen matches its baseline and its locks, with no finding · 1 a screen changed, is
 * new, did not render, changed structure or geometry, or has a finding · 2 setup or a crash.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CheckSetupError, dashboardCheck } from '../packages/pxsig/src/dashboard-check.mjs';
import { axeScript, browserPool } from '../packages/pxsig/src/lib/capture.mjs';
import { envConfig } from '../packages/pxsig/src/lib/env.mjs';
import { writeJson } from '../packages/pxsig/src/lib/files.mjs';
import { takeLock } from '../packages/pxsig/src/lib/lock.mjs';
import { asMain } from './lib/crash.mjs';
import { fixtureRepeat } from './lib/screens-repeat.mjs';
import { boxesFile } from '../packages/pxsig/src/lib/capture/boxes.mjs';
import { textSettings } from '../packages/pxsig/src/lib/text/config.mjs';
import { engineVerdicts } from './lib/screens-engine.mjs';
import { SCREENS } from '../packages/pxsig/src/lib/source.mjs';
import {
  alignmentNotes,
  checkGeometry,
  checkStructure,
  screenFindings,
  structureFile,
} from './lib/screen-locks.mjs';
import { FEATURES as LIVE } from './live/flows.mjs';
import { projectHints, projectOfArgs } from './lib/screens-project.mjs';
import { ariaVsReference, runFindings, writeFindings } from './lib/screens-findings.mjs';
import { liveCatalogue, runLive } from './live/run.mjs';
import {
  engineVersion,
  openProject,
  PXSIG_VERSION,
  writeRunManifest,
} from '../packages/pxsig/src/lib/workspace.mjs';

/** @import { ManifestEntry, Project } from '../packages/pxsig/src/types.js' */
/** @import { DashboardCheckReport, ScreenCatalogue, ScreenResult } from '../packages/pxsig/src/types/t4.js' */

export const THEMES = ['dark', 'light'];
/** `pxsig dashboard check`'s window (dashboard-check/capture.mjs). */
const VIEWPORT = { width: 1280, height: 900 };
/** The ids the server and the MCP server accept (docs/spec.md section 6). */
const ID = /^[a-z0-9-]+--[a-z0-9-]+(@[a-z0-9-]+)?$/;

/**
 * A screen's entry id and story: `<section>--<feature>-<n>@<theme>`.
 * @param {string} feature a feature id, `<section>.<name>` (`inspector.header`)
 * @param {number} n the screen's number within its feature, from 1
 * @param {string} theme
 */
export function screenId(feature, n, theme) {
  const [section, ...name] = feature.split('.');
  const story = `${section}--${[...name, String(n)].join('-')}`;
  const id = `${story}@${theme}`;
  if (!ID.test(id)) throw new Error(`screen ${feature} #${n} makes no valid entry id (${id})`);
  return { id, story };
}

/**
 * The manifest entries for every screen of `catalogue` in each theme. Two screens that would share
 * an id are an error, never a silent overwrite.
 * @param {ScreenCatalogue} catalogue
 * @param {(id: string, section: string) => string} sigFor the baseline path of an entry
 * @param {(feature: string) => string} fileOf the file that defines a feature (its `importPath`)
 * @returns {ManifestEntry[]}
 */
export function screenEntries(catalogue, sigFor, fileOf) {
  /** @type {Map<string, string>} */
  const seen = new Map();
  /** @type {ManifestEntry[]} */
  const out = [];
  for (const f of catalogue.features)
    f.screens.forEach((screen, i) => {
      for (const theme of THEMES) {
        const { id, story } = screenId(f.id, i + 1, theme);
        const was = seen.get(id);
        if (was) throw new Error(`${f.id} #${i + 1} and ${was} make the same entry id ${id}`);
        seen.set(id, `${f.id} #${i + 1}`);
        out.push({
          id,
          story,
          mode: theme,
          state: null,
          sig: sigFor(id, story.split('--')[0]),
          importPath: fileOf(f.id),
          globals: '',
          colorScheme: theme,
          viewport: [screen.width ?? VIEWPORT.width, VIEWPORT.height],
          browser: 'chromium',
          a11y: false,
        });
      }
    });
  return out;
}

async function main() {
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const args = process.argv.slice(2);
  const flag = (/** @type {string} */ k) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  /** @type {(m: string) => never} */
  const die = (m) => (console.error(`[screens] ${m}`), process.exit(2));
  const proj = projectOfArgs(repo, args);
  // The catalogue and the features are the dashboard's, whichever store is checked.
  const dashboard = join(repo, 'packages', 'dashboard');
  /** @type {Project} */
  const P = openProject({ cwd: proj.dir });
  const build = resolve(flag('build') ?? proj.build);
  // --only splits into the fixture features (dashboardCheck's) and the live ones.
  const named =
    flag('only')
      ?.split(',')
      .map((x) => x.trim())
      .filter(Boolean) ?? null;
  const liveIds = new Set(LIVE.map((f) => f.id));
  const noLive = args.includes('--no-live');
  const liveOnly = named ? named.filter((x) => liveIds.has(x)) : null;
  const only = named?.filter((x) => !liveIds.has(x)).join(',') || (named ? null : undefined);
  const runFixtures = only !== null;
  const runLiveScreens = !noLive && !proj.fixturesOnly && (!liveOnly || liveOnly.length > 0);
  const repeat = Number(flag('repeat') ?? 2);

  // The entries: every screen in both themes, baselines grouped by section.
  const catalogue = /** @type {ScreenCatalogue} */ (
    JSON.parse(readFileSync(join(dashboard, 'fixtures', 'screens.json'), 'utf8'))
  );
  const rel = (/** @type {string} */ p) => relative(P.workspaceRoot, p).split('\\').join('/');
  // Each feature is defined in one file of src/ui/features/: its screens' importPath.
  const featuresDir = join(dashboard, 'src', 'ui', 'features');
  /** @type {Map<string, string>} */
  const defined = new Map();
  for (const f of readdirSync(featuresDir).filter((n) => n.endsWith('.ts')))
    for (const m of readFileSync(join(featuresDir, f), 'utf8').matchAll(/\bid: '([a-z0-9.-]+)'/g))
      defined.set(m[1], rel(join(featuresDir, f)));
  const entries = screenEntries(
    { features: [...catalogue.features, ...(proj.fixturesOnly ? [] : liveCatalogue().features)] },
    (id, section) => rel(join(P.store.baselines, section, `${id}.psig`)),
    (feature) =>
      liveIds.has(feature)
        ? rel(join(repo, 'scripts', 'live', 'flows.mjs'))
        : (defined.get(feature) ?? rel(join(dashboard, 'src', 'ui', 'features.ts')))
  );
  const manifestPath = P.manifestPath();
  mkdirSync(P.store.root, { recursive: true });
  writeJson(
    manifestPath,
    { version: 2, project: P.name, source: SCREENS, stories: entries, skipped: [] },
    { pretty: true }
  );
  const run = writeRunManifest(P, manifestPath);

  /** @type {{ check: () => void, release: () => void }} */
  let lock;
  try {
    lock = await takeLock(P, { holder: 'screens-check' });
  } catch (e) {
    // takeLock throws when another writer (a `pxsig serve`) holds the store.
    die(`${/** @type {Error} */ (e).message}: stop pxsig serve in ${proj.rel} first`);
  }

  // Render with the browser the environment is probed in, so the two cannot disagree.
  const pool = browserPool(P);
  const engine = engineVersion(P.rustBin);
  const envCfg = envConfig(P.config);
  const current = await pool.envs(['chromium'], {
    fontProbe: envCfg.fontProbe,
    pxsig: PXSIG_VERSION,
    engine,
  });
  // The project's text capture: each screen's text record beside its render.
  const textOn = textSettings(P.config);
  const text = textOn.on ? { ignore: textOn.ignore } : null;
  const tmp = join(P.store.root, 'renders', '.screens');
  const keep = join(P.store.reports, 'live-repeat');
  rmSync(keep, { recursive: true, force: true });
  /** @type {{ report: Pick<DashboardCheckReport, 'screens' | 'topBar'>, outDir: string }} */
  let checked = { report: { screens: [] }, outDir: tmp };
  const log = (/** @type {string} */ m) => console.log(m);
  const idOf = (/** @type {ScreenResult} */ x) => screenId(x.feature, x.index + 1, x.theme).id;
  /** @type {Awaited<ReturnType<typeof fixtureRepeat>> | null} */
  let repeated = null;
  try {
    const browser = await pool.get('chromium');
    const flags = { build, out: tmp, reference: build, ...(only ? { only } : {}) };
    const opts = { browser, log, aria: true, anchors: true, text };
    if (runFixtures) checked = await dashboardCheck(flags, repo, opts);
    if (runFixtures && repeat > 1)
      repeated = await fixtureRepeat({
        P,
        first: checked,
        flags,
        opts,
        idOf,
        log,
        allowFile: proj.unstable,
        screens: join(dashboard, 'fixtures', 'screens.json'),
      });
    if (runLiveScreens)
      checked.report.screens.push(
        ...(await runLive({
          dashboard: build,
          axe: axeScript({ root: repo, workspaceRoot: repo }),
          out: join(tmp, 'live'),
          keep,
          themes: /** @type {('dark' | 'light')[]} */ (THEMES),
          repeat,
          only: liveOnly,
          text,
        }))
      );
  } catch (e) {
    await pool.close();
    if (e instanceof CheckSetupError) die(e.message);
    throw e;
  }
  await pool.close();

  // The renders, under their entry ids, where the engine and `pxsig serve` read them.
  mkdirSync(P.store.latest, { recursive: true });
  /** @type {Map<string, { id: string, png?: string, error?: string, ms: number }>} */
  const render = new Map();
  for (const x of checked.report.screens) {
    const id = idOf(x);
    const png = join(P.store.latest, `${id}.png`);
    rmSync(png, { force: true });
    rmSync(boxesFile(png), { force: true });
    if (x.rendered && x.shot) {
      const shot = isAbsolute(x.shot) ? x.shot : join(checked.outDir, x.shot);
      cpSync(shot, png);
      // Its text record, under the same entry id, for the approval to store.
      if (existsSync(boxesFile(shot))) cpSync(boxesFile(shot), boxesFile(png));
    }
    render.set(
      id,
      x.rendered
        ? { id, png, ms: x.ms ?? 0 }
        : { id, error: x.reason ?? 'not rendered', ms: x.ms ?? 0 }
    );
  }
  rmSync(tmp, { recursive: true, force: true });
  const selected = [...render.keys()];

  // The locked structure: every theme of a screen alike, and as committed.
  const structureDir = join(P.store.reports, 'structure');
  rmSync(structureDir, { recursive: true, force: true });
  for (const x of checked.report.screens)
    if (x.aria != null && x.theme === THEMES[0]) {
      const file = join(structureDir, structureFile(x.feature, x.index + 1));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${x.aria.trimEnd()}\n`);
    }
  // Strict: an accessibility or layout finding on any screen fails, as `dashboard check --strict`.
  const findings = screenFindings(checked.report.screens, idOf, checked.report.topBar, proj);
  const aligned = alignmentNotes(checked.report.screens, idOf, P.store.reports);
  const lockArgs = {
    screens: checked.report.screens,
    update: args.includes('--update-locks'),
    // A stale lock file shows only when both kinds of screen ran in full.
    complete:
      !named && (proj.fixturesOnly || !noLive) && checked.report.screens.every((x) => x.rendered),
  };
  const structure = checkStructure({ ...lockArgs, dir: proj.locks });
  const geometry = checkGeometry({ ...lockArgs, file: proj.geometry });
  mkdirSync(structureDir, { recursive: true });
  writeFileSync(
    join(structureDir, 'geometry.json'),
    `${JSON.stringify(geometry.geometry, null, 2)}\n`
  );
  // Advisory: this run's structure against the reference's locks (never fails).
  const reports = P.store.reports;
  const aria = proj.ariaReference
    ? ariaVsReference({
        current: structureDir,
        reference: proj.ariaReference,
        reports,
        project: P.name,
      })
    : null;

  // The engine's verdicts and the reports, as `pxsig check` writes them (lib/screens-engine.mjs).
  const renderWallMs = checked.report.screens.reduce((n, x) => n + (x.ms ?? 0), 0);
  const { out, summary } = engineVerdicts({
    P,
    run,
    entries,
    selected,
    render,
    current,
    envCfg,
    lock,
    die,
    only,
    renderWallMs,
  });

  const failed = out.filter((r) => !r.skipped && (r.error || !r.pass));
  const gated = ['axe', 'layout', 'alignment', 'top-bar', 'unstable', 'structure', 'geometry'];
  writeFindings({
    reports,
    project: P.name,
    rows: out,
    gated: proj.fidelity ? [...gated, 'fidelity'] : gated,
    findings: runFindings({
      screens: checked.report.screens,
      idOf,
      topBar: checked.report.topBar,
      unstable: repeated?.problems,
      structure: structure.problems,
      geometry: geometry.problems,
    }),
  });
  for (const f of structure.written) console.log(`[screens] locked structure written: ${f}`);
  for (const f of structure.removed) console.log(`[screens] locked structure removed: ${f}`);
  if (geometry.written) console.log('[screens] locked geometry written: geometry.json');
  for (const p of structure.problems) console.log(`  structure ${p}`);
  for (const p of geometry.problems) console.log(`  geometry ${p}`);
  for (const f of findings) console.log(`  finding ${f}`.slice(0, 400));
  for (const p of [...(repeated?.problems ?? []), ...(repeated?.notes ?? [])])
    console.log(`  ${p}`);
  for (const l of [...aligned, ...(aria ? [aria] : [])]) console.log(l);
  const hints = projectHints(proj, repo);
  const locksFailed = structure.problems.length + geometry.problems.length;
  if (locksFailed) console.log(hints.locks);
  const live = out.filter((r) => !r.skipped && r.id.startsWith('live--')).length;
  console.log(
    `[screens] ${out.length - out.filter((r) => r.skipped).length} screens checked (${live} live) · ${summary.passed} match · ${failed.length} to review (changed, new or not rendered)`
  );
  for (const r of failed.slice(0, 20))
    console.log(`  ${r.id}: ${r.error ? `error: ${r.error}` : r.new ? 'new' : 'changed'}`);
  if (failed.length) console.log(hints.review);
  process.exit(
    failed.length || locksFailed || findings.length || repeated?.problems.length ? 1 : 0
  );
}

if (asMain(import.meta.url, 'screens')) await main();
