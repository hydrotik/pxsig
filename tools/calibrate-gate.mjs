#!/usr/bin/env node
/**
 * calibrate-gate.mjs — choose the whole gate from evidence: grid policy × whole-image rule ×
 * detail rule, over every saved scenario render (the general sample and every suite).
 *
 * The Rust engine does all the pixel work:
 *   - `baseline` builds throwaway signatures from the baseline images under each grid policy
 *     (a fixed grid, or a minimum cell size so small trimmed components don't get pixel-sized
 *     cells) into a scratch folder;
 *   - `check` (daemon) scores every render at each cell threshold with the gate opened wide,
 *     returning raw metrics (ssim, changed cells, changed %);
 *   - `detail-sweep` measures every detail tile that moved.
 *   - `check` again with the color rule measured (`.psig` baselines, which hold the image its
 *     flat-area check needs), once per pair of color lines.
 * This script then scores every rule combination on those numbers. A combination is admissible
 * only with zero false positives on every noise scenario; the best catches the most changed
 * regression renders (ties go to the one with more margin against noise). The color rule is
 * chosen last, on top of the best gate: it only fails entries the other rules pass.
 *
 *   node tools/calibrate-gate.mjs [--project name] [--workspace dir] [--grid 64] [--min-cells-px 4,6,8]
 *
 * Writes <store>/reports/calibration-gate.json; scratch under <store>/cache/research/calibrate-gate/.
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  baselineImages,
  engine,
  freshDir,
  log as logger,
  nums,
  parseFlags,
  pool,
  project,
  readReport,
  rust,
  scratchManifest,
  writeReport,
} from './lib/research.mjs';
/** @import { ManifestEntry } from '../packages/pxsig/src/types.js' */
/** @import { DetailSweep, MovedTile, ScenariosReport } from './types.js' */
/**
 * @typedef {{ key: string, suite: string, scenario: string, kind: 'regression' | 'noise',
 *   changed: boolean, id: string }} Item
 * @typedef {{ name: string, grid: number, minCellPx: number | null }} Policy
 * @typedef {{ policy: Policy, T: number, S: number, P: number, k: number, dk: number, bd: number,
 *   de: number }} Combination
 */

const log = logger('calibrate-gate');
const flags = parseFlags();
if (flags['detail-build'] === true) {
  // A bare `--detail-build` (no JSON after it) would parse as `true`.
  console.error(
    "usage: node tools/calibrate-gate.mjs [--project name] [--workspace dir] [--grid 64] [--min-cells-px 4,6,8] [--detail-build '<JSON object>']"
  );
  process.exit(2);
}
const { P, run } = project(flags);
const GRID = Number(flags.grid) || run.grid || 64;
/** @type {Policy[]} */
const POLICIES = [
  { name: `grid ${GRID}`, grid: GRID, minCellPx: null },
  ...nums(flags['min-cells-px'], [4, 6, 8]).map((c) => ({
    name: `cells ≥ ${c} px`,
    grid: GRID,
    minCellPx: c,
  })),
];
const THRESHOLDS = nums(flags.thresholds, [16, 24, 32, 48, 64]);
const SSIM = [0.995, 0.99, 0.985, 0.98, 0.97, 0];
const PCT = [2, 4, 100];
const K = [2, 3, 4, 6, 8, Infinity];
const DK = [2, 3, 4, 6, Infinity];
const DT = [24, 32, 48, 64];
const DE = [32, 48, 64, Infinity];
const OPEN = { minSsim: 0, maxChangedPct: 100, minCells: 0, detail: false, color: false };
/** The color rule's lines: one check per [deltaE, cellDeltaE] pair; areas and cell counts are scored after. */
const CDE = [
  [3, 5],
  [5, 8],
  [8, 12],
];
const AREA = [64, 128, 256, Infinity];
const CK = [3, 4, 6, Infinity];
const t0 = performance.now();

// --- the saved renders --------------------------------------------------------------------------
const tags = readdirSync(P.store.reports)
  .filter((f) => /^scenarios(-[\w.-]+)?\.json$/.test(f))
  .map((f) => f.slice(0, -5));
if (!tags.length)
  throw new Error(`no scenario reports in ${P.store.reports}: run tools/scenarios.mjs first`);
const scratch = freshDir(P, 'calibrate-gate');
const baseDir = join(scratch, 'base');
/** @type {Item[]} */
const items = []; // { key, suite, scenario, kind, changed, id }
/** @type {{ tag: string, rep: ScenariosReport, entries: Omit<ManifestEntry, 'gate' | 'grid'>[] }[]} */
const suites = [];
for (const tag of tags) {
  // A report tools/scenarios.mjs wrote: `tag` is one listed in the reports folder above.
  const rep = /** @type {ScenariosReport | null} */ (readReport(P, tag));
  if (!Array.isArray(rep?.scenarios) || !rep.scenarios.length) {
    console.error(
      `[calibrate-gate] ${join(P.store.reports, `${tag}.json`)} is not a scenarios report: run tools/scenarios.mjs again`
    );
    process.exit(1);
  }
  const ids = new Set(rep.scenarios[0].rows.filter((r) => !r.error).map((r) => r.id));
  const entries = run.stories
    .filter((e) => ids.has(e.id))
    .map(({ gate: _gate, grid: _grid, ...e }) => e);
  baselineImages(P, entries, baseDir);
  suites.push({ tag, rep, entries });
  for (const sc of rep.scenarios)
    for (const r of sc.rows)
      if (!r.error)
        items.push({
          key: `${tag}/${sc.name}/${r.id}`,
          suite: tag,
          scenario: sc.name,
          kind: sc.kind,
          changed: r.changed,
          id: r.id,
        });
}
const renderOf = (/** @type {Item} */ x) =>
  join(P.store.root, 'renders', x.suite, x.scenario, `${x.id}.png`);

// --- whole-image metrics per policy and threshold (Rust) ----------------------------------------
/** @type {Record<string, Record<number, Record<string, { ssim: number, cells: number, pct: number }>>>} */
const metrics = {}; // metrics[policy][T][key] = { ssim, cells, pct }
const eng = engine(P);
try {
  for (const pol of POLICIES) {
    metrics[pol.name] = {};
    const slug = pol.minCellPx ?? 'fixed';
    for (const s of suites) {
      const manifest = scratchManifest(
        P,
        join(scratch, `${s.tag}-${slug}.json`),
        { grid: pol.grid, minCellPx: pol.minCellPx, detail: false },
        s.entries,
        (e) => `sig-${slug}/${s.tag}/${e.id}.pxsig.json`
      );
      rust(P, [
        'baseline',
        '--manifest',
        manifest,
        '--png-dir',
        baseDir,
        '--root',
        scratch,
        '--no-detail',
        '--json',
      ]);
      await pool(
        THRESHOLDS.flatMap((T) => s.rep.scenarios.map((sc) => ({ T, sc }))),
        8,
        async ({ T, sc }) => {
          const out = await eng.call('check', {
            manifest,
            pngDir: join(P.store.root, 'renders', s.tag, sc.name),
            root: scratch,
            artifacts: 'none',
            gate: { ...OPEN, threshold: T },
          });
          metrics[pol.name][T] ??= {};
          for (const r of out.results)
            if (r.metrics)
              metrics[pol.name][T][`${s.tag}/${sc.name}/${r.id}`] = {
                ssim: r.metrics.ssim,
                cells: r.metrics.changedCells,
                pct: r.metrics.changedCellsPct,
              };
        }
      );
    }
  }
} finally {
  eng.close();
}

// --- detail tiles (Rust) -------------------------------------------------------------------------
const detail = run.gate?.detail ?? {};
const build = {
  tile: 16,
  block: 4,
  selEnergy: 10,
  // `--detail-build`: a JSON object of build keys (tools/README.md). JSON.parse reads its argument
  // as a string either way.
  ...(flags['detail-build']
    ? /** @type {Record<string, number>} */ (JSON.parse(String(flags['detail-build'])))
    : {}),
};
const sweepIn = join(scratch, 'sweep.json');
writeFileSync(
  sweepIn,
  JSON.stringify({
    pairs: items.map((x) => ({ key: x.key, base: join(baseDir, `${x.id}.png`), cur: renderOf(x) })),
    builds: [build],
  })
);
const sweep = new Map(
  // `detail-sweep` prints its rows as DetailSweep; one build was asked for.
  /** @type {DetailSweep} */ (rust(P, ['detail-sweep', '--input', sweepIn]).out).rows.map(
    (r) => /** @type {[string, MovedTile[]]} */ ([r.key, r.builds[0].moved])
  )
);

// --- the color rule (Rust) ---------------------------------------------------------------------
/** @type {Record<string, { area: number, cells: number }>[]} */
const colorM = CDE.map(() => ({})); // colorM[i][key] = { area, cells }
const eng2 = engine(P);
try {
  for (const s of suites) {
    const manifest = scratchManifest(
      P,
      join(scratch, `${s.tag}-color.json`),
      { grid: run.grid, minCellPx: run.minCellPx, detail: false },
      s.entries,
      (e) => `sig-color/${s.tag}/${e.id}.psig`
    );
    rust(P, [
      'baseline',
      '--manifest',
      manifest,
      '--png-dir',
      baseDir,
      '--root',
      scratch,
      '--no-detail',
      '--json',
    ]);
    await pool(
      CDE.flatMap(([de, cde], i) => s.rep.scenarios.map((sc) => ({ i, de, cde, sc }))),
      8,
      async ({ i, de, cde, sc }) => {
        const out = await eng2.call('check', {
          manifest,
          pngDir: join(P.store.root, 'renders', s.tag, sc.name),
          root: scratch,
          artifacts: 'none',
          gate: {
            ...OPEN,
            threshold: 255,
            color: { deltaE: de, cellDeltaE: cde, minArea: 1, minCells: 1 },
          },
        });
        for (const r of out.results)
          if (r.color)
            colorM[i][`${s.tag}/${sc.name}/${r.id}`] = {
              area: r.color.flatArea ?? 0,
              cells: r.color.cells ?? 0,
            };
      }
    );
  }
} finally {
  eng2.close();
}
const rustMs = performance.now() - t0;

// --- search --------------------------------------------------------------------------------------
const tiles = new Map(
  items.map((x) => [
    x.key,
    Object.fromEntries(
      DT.flatMap((bd) =>
        DE.map((e) => [
          `${bd}|${e}`,
          (sweep.get(x.key) ?? []).filter(([b, r]) => b > bd || r > e).length,
        ])
      )
    ),
  ])
);
const noise = items.filter((x) => x.kind === 'noise');
const regs = items.filter((x) => x.kind === 'regression' && x.changed);
const failsWith = (/** @type {Combination} */ c) => (/** @type {Item} */ x) => {
  const m = metrics[c.policy.name][c.T][x.key];
  if (!m) return false;
  return (
    m.ssim < c.S ||
    m.pct > c.P ||
    m.cells >= c.k ||
    // `tiles` has an entry for every item.
    (c.dk !== Infinity &&
      /** @type {Record<string, number>} */ (tiles.get(x.key))[`${c.bd}|${c.de}`] >= c.dk)
  );
};
/** @type {(Combination & { caught: number, margin: number }) | null} */
let best = null;
let evaluated = 0;
let admissible = 0;
for (const policy of POLICIES)
  for (const T of THRESHOLDS)
    for (const S of SSIM)
      for (const Pc of PCT)
        for (const k of K)
          for (const dk of DK)
            for (const bd of DT)
              for (const de of DE) {
                if (dk === Infinity && (bd !== DT[0] || de !== DE[0])) continue;
                evaluated++;
                const c = { policy, T, S, P: Pc, k, dk, bd, de };
                const fails = failsWith(c);
                if (noise.some(fails)) continue;
                admissible++;
                const caught = regs.filter(fails).length;
                // Ties: coarser cells, larger thresholds, more cells/tiles needed, lower ssim floor: more margin against noise.
                const margin =
                  (policy.minCellPx ?? 0) +
                  T / 8 +
                  (k === Infinity ? 9 : k) +
                  (dk === Infinity ? 9 : dk) -
                  S * 10;
                if (
                  !best ||
                  caught > best.caught ||
                  (caught === best.caught && margin > best.margin)
                )
                  best = { ...c, caught, margin };
              }

// The color rule on top of the best gate: the candidate with no false positive that catches most.
/** @typedef {{ i: number, area: number, ck: number }} ColorRule */
const colorFails = (/** @type {ColorRule} */ c) => (/** @type {Item} */ x) => {
  const m = colorM[c.i][x.key];
  return !!m && (m.area >= c.area || m.cells >= c.ck);
};
const bestFails = best ? failsWith(best) : () => false;
/** @type {(ColorRule & { caught: number, margin: number }) | null} */
let colorBest = null;
for (let i = 0; i < CDE.length; i++)
  for (const area of AREA)
    for (const ck of CK) {
      if (area === Infinity && ck === Infinity) continue;
      const cf = colorFails({ i, area, ck });
      const fails = (/** @type {Item} */ x) => bestFails(x) || cf(x);
      if (noise.some(fails)) continue;
      const caught = regs.filter(fails).length;
      const margin = i * 10 + (area === Infinity ? 16 : area / 64) + (ck === Infinity ? 9 : ck);
      if (
        !colorBest ||
        caught > colorBest.caught ||
        (caught === colorBest.caught && margin > colorBest.margin)
      )
        colorBest = { i, area, ck, caught, margin };
    }
// The project's own color rule (on by default), scored the same way: null when it is not one of
// the lines measured above.
const setColor = run.gate?.color;
const cur =
  setColor === false
    ? null
    : {
        deltaE: 3,
        minArea: 64,
        cellDeltaE: 5,
        minCells: 3,
        ...(typeof setColor === 'object' ? setColor : {}),
      };
const curI = cur ? CDE.findIndex(([de, cde]) => de === cur.deltaE && cde === cur.cellDeltaE) : -1;
const currentColor =
  curI < 0 || !cur
    ? null
    : (() => {
        const cf = colorFails({
          i: curI,
          area: cur.minArea || Infinity,
          ck: cur.minCells || Infinity,
        });
        const fails = (/** @type {Item} */ x) => bestFails(x) || cf(x);
        return { caught: regs.filter(fails).length, falsePositives: noise.filter(fails).length };
      })();

/** @type {Record<string, { kind: Item['kind'], caught: number, of: number, fp: number }>} */
const per = {};
if (best) {
  const cf = colorBest ? colorFails(colorBest) : () => false;
  const fails = (/** @type {Item} */ x) => bestFails(x) || cf(x);
  for (const x of items) {
    const n = `${x.suite}/${x.scenario}`;
    per[n] ??= { kind: x.kind, caught: 0, of: 0, fp: 0 };
    if (x.kind === 'noise') {
      per[n].of++;
      if (fails(x)) per[n].fp++;
    } else if (x.changed) {
      per[n].of++;
      if (fails(x)) per[n].caught++;
    }
  }
}
const bySuite = Object.fromEntries(
  suites.map((s) => {
    const rs = Object.entries(per).filter(
      ([n, p]) => n.startsWith(`${s.tag}/`) && p.kind === 'regression'
    );
    return [
      s.tag,
      {
        caught: rs.reduce((a, [, p]) => a + p.caught, 0),
        of: rs.reduce((a, [, p]) => a + p.of, 0),
      },
    ];
  })
);
const gate = best && {
  grid: best.policy.grid,
  minCellPx: best.policy.minCellPx,
  threshold: best.T,
  minSsim: best.S,
  maxChangedPct: best.P,
  minCells: best.k === Infinity ? 0 : best.k,
  detail:
    best.dk === Infinity
      ? false
      : {
          blockDelta: best.bd,
          energyDelta: best.de === Infinity ? 255 : best.de,
          minTiles: best.dk,
        },
  color: colorBest
    ? {
        deltaE: CDE[colorBest.i][0],
        minArea: colorBest.area === Infinity ? 0 : colorBest.area,
        cellDeltaE: CDE[colorBest.i][1],
        minCells: colorBest.ck === Infinity ? 0 : colorBest.ck,
      }
    : false,
};
const current = {
  grid: run.grid,
  minCellPx: run.minCellPx,
  ...run.gate,
  detail: run.detail ? detail : false,
};
const result = {
  generatedAt: new Date().toISOString(),
  project: P.name,
  renders: items.length,
  evaluated,
  admissible,
  rustMs,
  totalMs: performance.now() - t0,
  detailBuild: build,
  current,
  gate,
  caught: colorBest?.caught ?? best?.caught ?? 0,
  caughtWithoutColor: best?.caught ?? 0,
  currentColor,
  of: regs.length,
  bySuite,
  per,
};
log(
  `${items.length} renders · ${evaluated} rules (${admissible} with zero false positives) · Rust ${(rustMs / 1000).toFixed(1)} s`
);
if (!gate) log('  no zero-false-positive gate');
else {
  // `gate` is set only when `best` is.
  log(
    `  best: ${JSON.stringify(gate)} → ${result.caught}/${regs.length} (${result.caughtWithoutColor} without the color rule)`
  );
  if (currentColor)
    log(
      `  the project's color rule on top: ${currentColor.caught}/${regs.length}, ${currentColor.falsePositives} false positives`
    );
  for (const [n, p] of Object.entries(per))
    if (p.kind === 'regression') log(`    ${n.padEnd(36)} ${p.caught}/${p.of}`);
}
log(`wrote ${writeReport(P, 'calibration-gate', result)}`);
