#!/usr/bin/env node
/**
 * screens-check.mjs — pxsig's own baselines: every screen of the dashboard (the catalogue `pxsig
 * dashboard check` renders, each in both themes) checked against packages/dashboard/.pxsig, the
 * store of the `pxsig` project (packages/dashboard/pxsig.config.json).
 *
 *   node scripts/screens-check.mjs [--build <dir>] [--only <feature,…>] [--update-locks]
 *   pnpm screens:check …   (the same, in pxsig's container: scripts/screens-container.mjs)
 *
 * --build is the dashboard to check: the reference build (`PXSIG_UI_ADAPTER=hydrotik
 * PXSIG_DS_SOURCE=<design system> pnpm build:dashboard`), by default packages/pxsig/dist/dashboard.
 * The baselines are rendered in pxsig's container (docs/releasing.md, "pxsig's own baselines");
 * a render elsewhere differs in fonts, and its rows say so (`envMatch`).
 *
 * It writes the store as `pxsig check` does, and no baseline: manifest.json (the entries, with
 * `source: dashboard-screens`), renders/latest/<id>.png, diffs/latest, reports/check.json,
 * summary.md and junit.xml. A person reviews and approves them with `pxsig serve` in
 * packages/dashboard (approving needs `pxsig serve --link`).
 *
 * It also checks each screen's locked structure and geometry (scripts/lib/screen-locks.mjs): its
 * accessibility snapshot and its feature's anchors against packages/dashboard/fixtures/locked/.
 * `--update-locks` rewrites those files instead, for a change made on purpose; the current ones are
 * always written to reports/structure/.
 *
 * An entry id is `<section>--<feature>-<n>@<theme>`: inspector.header's first screen in the dark
 * theme is `inspector--header-1@dark`, so the review groups screens by section.
 * Exit: 0 every screen matches its baseline and its locks · 1 a screen changed, is new, did not
 * render, or changed structure or geometry · 2 setup.
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CheckSetupError, dashboardCheck } from '../packages/pxsig/src/dashboard-check.mjs';
import { browserPool } from '../packages/pxsig/src/lib/capture.mjs';
import { annotateRow, byId, envConfig, envSummary } from '../packages/pxsig/src/lib/env.mjs';
import { writeJson } from '../packages/pxsig/src/lib/files.mjs';
import { takeLock } from '../packages/pxsig/src/lib/lock.mjs';
import { buildRow, summarize } from '../packages/pxsig/src/lib/rows.mjs';
import { SCREENS } from '../packages/pxsig/src/lib/source.mjs';
import { checkGeometry, checkStructure, structureFile } from './lib/screen-locks.mjs';
import {
  engineVersion,
  openProject,
  PXSIG_VERSION,
  writeRunManifest,
} from '../packages/pxsig/src/lib/workspace.mjs';

/** @import { CheckRow, ManifestEntry, Project } from '../packages/pxsig/src/types.js' */
/** @import { EnvFields } from '../packages/pxsig/src/types/env.js' */
/** @import { DashboardCheckReport, EngineCheckOutput, ScreenCatalogue } from '../packages/pxsig/src/types/t4.js' */

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
    f.screens.forEach((_, i) => {
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
          viewport: [VIEWPORT.width, VIEWPORT.height],
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
  const projectDir = join(repo, 'packages', 'dashboard');
  /** @type {Project} */
  const P = openProject({ cwd: projectDir });
  const build = resolve(flag('build') ?? join(repo, 'packages/pxsig/dist/dashboard'));
  const only = flag('only');

  // The entries: every screen in both themes, baselines grouped by section.
  const catalogue = /** @type {ScreenCatalogue} */ (
    JSON.parse(readFileSync(join(projectDir, 'fixtures', 'screens.json'), 'utf8'))
  );
  const rel = (/** @type {string} */ p) => relative(P.workspaceRoot, p).split('\\').join('/');
  // Each feature is defined in one file of src/ui/features/: its screens' importPath.
  const featuresDir = join(projectDir, 'src', 'ui', 'features');
  /** @type {Map<string, string>} */
  const defined = new Map();
  for (const f of readdirSync(featuresDir).filter((n) => n.endsWith('.ts')))
    for (const m of readFileSync(join(featuresDir, f), 'utf8').matchAll(/\bid: '([a-z0-9.-]+)'/g))
      defined.set(m[1], rel(join(featuresDir, f)));
  const entries = screenEntries(
    catalogue,
    (id, section) => rel(join(P.store.baselines, section, `${id}.psig`)),
    (feature) => defined.get(feature) ?? rel(join(projectDir, 'src', 'ui', 'features.ts'))
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
    die(`${/** @type {Error} */ (e).message}: stop pxsig serve in packages/dashboard first`);
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
  const tmp = join(P.store.root, 'renders', '.screens');
  /** @type {{ report: DashboardCheckReport, outDir: string }} */
  let checked;
  try {
    checked = await dashboardCheck(
      { build, out: tmp, reference: build, ...(only ? { only } : {}) },
      repo,
      {
        browser: await pool.get('chromium'),
        log: (/** @type {string} */ m) => console.log(m),
        aria: true,
        anchors: true,
      }
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
    const { id } = screenId(x.feature, x.index + 1, x.theme);
    const png = join(P.store.latest, `${id}.png`);
    rmSync(png, { force: true });
    if (x.rendered && x.shot) cpSync(join(checked.outDir, x.shot), png);
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
  const lockArgs = {
    screens: checked.report.screens,
    update: args.includes('--update-locks'),
    complete: !only && checked.report.screens.every((x) => x.rendered),
  };
  const structure = checkStructure({ ...lockArgs, dir: join(projectDir, 'fixtures', 'locked') });
  const geometry = checkGeometry({
    ...lockArgs,
    file: join(projectDir, 'fixtures', 'locked', 'geometry.json'),
  });
  mkdirSync(structureDir, { recursive: true });
  writeFileSync(
    join(structureDir, 'geometry.json'),
    `${JSON.stringify(geometry.geometry, null, 2)}\n`
  );

  // The engine's check, as `pxsig check` runs it.
  const reports = P.store.reports;
  mkdirSync(reports, { recursive: true });
  const onlyFile = join(reports, '.selected.json');
  writeFileSync(onlyFile, JSON.stringify(selected.filter((id) => render.get(id)?.png)));
  const engineRun = (/** @type {string[]} */ a) => {
    const r = spawnSync(P.rustBin, a, {
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      cwd: P.workspaceRoot,
    });
    if (r.status === 2) die(`pxsig ${a[0]} failed: ${r.stderr || r.stdout}`);
    return r.stdout;
  };
  lock.check();
  const rustRes = /** @type {EngineCheckOutput} */ (
    JSON.parse(
      engineRun([
        'check',
        '--manifest',
        run.path,
        '--png-dir',
        P.store.latest,
        '--root',
        P.workspaceRoot,
        '--out-dir',
        P.store.diffLatest,
        '--only',
        `@${onlyFile}`,
        '--json',
        '--history',
        join(reports, 'history.ndjson'),
      ])
    )
  );
  const rows = new Map(rustRes.results.map((r) => [r.id, r]));

  // check.json: this run's rows, and the earlier verdict of any screen --only left out.
  const reportPath = join(reports, 'check.json');
  const previous = existsSync(reportPath)
    ? /** @type {{ rows?: CheckRow[], envs?: Record<string, EnvFields>, fullCheckAt?: string } } */ (
        JSON.parse(readFileSync(reportPath, 'utf8'))
      )
    : null;
  const prevRows = new Map((previous?.rows ?? []).map((r) => [r.id, r]));
  const envs = { ...previous?.envs, ...rustRes.baselineEnvs, ...byId(current) };
  const want = new Set(selected);
  /** @type {CheckRow[]} */
  const out = entries.map((e) => {
    if (!want.has(e.id)) {
      const p = prevRows.get(e.id);
      return p
        ? { ...p, skipped: true, inherited: true }
        : {
            id: e.id,
            story: e.story,
            mode: e.mode,
            state: null,
            skipped: true,
            pass: true,
            metrics: null,
            inherited: false,
          };
    }
    return annotateRow(buildRow(e, rows.get(e.id), render.get(e.id), {}, run.manifest, null), {
      current,
      envs,
      ignore: envCfg.ignore,
    });
  });
  const now = new Date().toISOString();
  const summary = summarize(out, {
    renderWallMs: checked.report.screens.reduce((n, x) => n + (x.ms ?? 0), 0),
    rustEngineMs: rustRes.summary.elapsedMs,
    ...envSummary(out, envs),
  });
  const used = new Set(out.flatMap((r) => [r.env, r.baselineEnv]).filter(Boolean));
  lock.check();
  writeJson(reportPath, {
    generatedAt: now,
    fullCheckAt: only ? (previous?.fullCheckAt ?? null) : now,
    project: P.name,
    suite: null,
    manifest: {
      grid: run.manifest.grid,
      gate: run.manifest.gate,
      modes: run.manifest.modes,
      defaultMode: run.manifest.defaultMode,
    },
    summary,
    affected: null,
    envs: Object.fromEntries(Object.entries(envs).filter(([id]) => used.has(id))),
    rows: out,
  });
  // Review decisions belong to the run they were made on: a new run starts clean.
  for (const f of ['review.json', 'a11y-review.json']) rmSync(join(reports, f), { force: true });
  for (const [format, file] of [
    ['markdown', 'summary.md'],
    ['junit', 'junit.xml'],
  ])
    engineRun(['report', '--input', reportPath, '--format', format, '--out', join(reports, file)]);
  rmSync(onlyFile, { force: true });
  lock.release();

  const failed = out.filter((r) => !r.skipped && (r.error || !r.pass));
  for (const f of structure.written) console.log(`[screens] locked structure written: ${f}`);
  for (const f of structure.removed) console.log(`[screens] locked structure removed: ${f}`);
  if (geometry.written) console.log('[screens] locked geometry written: geometry.json');
  for (const p of structure.problems) console.log(`  structure ${p}`);
  for (const p of geometry.problems) console.log(`  geometry ${p}`);
  const locksFailed = structure.problems.length + geometry.problems.length;
  if (locksFailed)
    console.log(
      '[screens] a structure or geometry change made on purpose: pnpm screens:check --update-locks, and commit packages/dashboard/fixtures/locked'
    );
  console.log(
    `[screens] ${out.length - out.filter((r) => r.skipped).length} screens checked · ${summary.passed} match · ${failed.length} to review (changed, new or not rendered)`
  );
  for (const r of failed.slice(0, 20))
    console.log(`  ${r.id}: ${r.error ? `error: ${r.error}` : r.new ? 'new' : 'changed'}`);
  if (failed.length)
    console.log(
      '[screens] review them: cd packages/dashboard && node ../pxsig/bin/pxsig.mjs serve (approve with serve --link)'
    );
  process.exit(failed.length || locksFailed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
