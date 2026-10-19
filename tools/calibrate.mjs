#!/usr/bin/env node
/**
 * calibrate.mjs — pick the signature grid and the whole-image rule from evidence.
 *
 * Re-scores the renders scenarios.mjs saved. For each grid size, the Rust engine builds throwaway
 * signatures from the baseline images (out of the committed `.psig` files) into a scratch folder,
 * then checks every scenario render against them at each cell threshold with the gate opened wide,
 * so it reports raw metrics (ssim, changed cells). Candidate rules are scored on those metrics:
 * a rule is admissible when it raises zero false positives on every noise scenario; the best
 * admissible rule catches the most regression renders whose pixels changed.
 *
 *   node tools/calibrate.mjs [--project name] [--workspace dir] [--suite name]
 *        [--grids 32,48,64,96,128] [--thresholds 12,16,24,32] [--ks 1,2,3,4] [--min-cell-px 8]
 *
 * Writes <store>/reports/calibration[-<suite>].json; scratch signatures under
 * <store>/cache/research/calibrate[-<suite>]/.
 */
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { baselineImages, engine, freshDir, log as logger, nums, parseFlags, pool, project, readReport, rust, scratchManifest, str, writeReport } from './lib/research.mjs';

const log = logger('calibrate');
const flags = parseFlags();
const { P, run } = project(flags);
const GRIDS = nums(flags.grids, [32, 48, 64, 96, 128]);
const THRESHOLDS = nums(flags.thresholds, [12, 16, 24, 32]);
const KS = nums(flags.ks, [1, 2, 3, 4]);
/** Fixed grids by default; `--min-cell-px N` applies the min-cell policy under each grid as the maximum. */
const MIN_CELL = Number(flags['min-cell-px']) || null;
const suite = str(flags.suite);
const tag = suite ? `scenarios-${suite}` : 'scenarios';
const scen = readReport(P, tag);
if (!scen) throw new Error(`no ${tag}.json in ${P.store.reports}: run tools/scenarios.mjs${suite ? ` --suite ${suite}` : ''} first`);

/** Candidate whole-image rules over Rust's metrics; `threshold` is the per-cell delta. */
const RULES = [
  { name: 'default', label: 'ssim < 0.99 or changed > 2%', threshold: 12, fails: (m) => m.ssim < 0.99 || m.changedCellsPct > 2 },
  ...KS.flatMap((k) =>
    THRESHOLDS.map((t) => ({ name: `cells>=${k}@${t}`, label: `default, or ≥${k} cell(s) off by > ${t}`, threshold: t, fails: (m) => m.ssim < 0.99 || m.changedCellsPct > 2 || m.changedCells >= k }))
  ),
];

const ids = new Set(scen.scenarios[0].rows.filter((r) => !r.error).map((r) => r.id));
// Per-entry gates and grids are dropped: every entry gets exactly the grid and gate under test.
const entries = run.stories.filter((e) => ids.has(e.id)).map(({ gate, grid, ...e }) => e);
const scratch = freshDir(P, suite ? `calibrate-${suite}` : 'calibrate');
const baseDir = join(scratch, 'base');
baselineImages(P, entries, baseDir);
const renderDir = (name) => join(P.store.root, 'renders', tag, name);
const eng = engine(P);
const OPEN = { minSsim: 0, maxChangedPct: 100, minCells: 0, detail: false };

const result = { generatedAt: new Date().toISOString(), project: P.name, suite: scen.suite ?? null, minCellPx: MIN_CELL, renders: entries.length * scen.scenarios.length, grids: [] };
try {
  for (const grid of GRIDS) {
    const manifest = scratchManifest(P, join(scratch, `g${grid}.json`), { grid, minCellPx: MIN_CELL, detail: false }, entries, (e) => `g${grid}/${e.id}.pxsig.json`);
    rust(P, ['baseline', '--manifest', manifest, '--png-dir', baseDir, '--root', scratch, '--no-detail', '--json']);
    const sigBytes = statSync(join(scratch, `g${grid}`, `${entries[0].id}.pxsig.json`)).size;
    const t0 = performance.now();
    let compares = 0;
    const metrics = {}; // metrics[T][scenario] = [{ id, changed, m }]
    const jobs = THRESHOLDS.includes(12) ? THRESHOLDS : [12, ...THRESHOLDS];
    await pool(
      jobs.flatMap((T) => scen.scenarios.map((sc) => ({ T, sc }))),
      8,
      async ({ T, sc }) => {
        const out = await eng.call('check', { manifest, pngDir: renderDir(sc.name), root: scratch, artifacts: 'none', gate: { ...OPEN, threshold: T } });
        const byId = new Map(out.results.map((r) => [r.id, r]));
        metrics[T] ??= {};
        metrics[T][sc.name] = sc.rows
          .filter((r) => !r.error && byId.get(r.id)?.metrics)
          .map((r) => (compares++, { id: r.id, changed: r.changed, m: byId.get(r.id).metrics }));
      }
    );
    const ms = performance.now() - t0;
    const rules = RULES.map(({ fails, ...rule }) => {
      let fp = 0;
      let caught = 0;
      let changed = 0;
      const per = {};
      for (const sc of scen.scenarios) {
        const rows = metrics[rule.threshold][sc.name];
        if (sc.kind === 'noise') {
          const f = rows.filter((x) => fails(x.m)).length;
          fp += f;
          per[sc.name] = { falsePositives: f, of: rows.length };
        } else {
          const ch = rows.filter((x) => x.changed);
          const c = ch.filter((x) => fails(x.m)).length;
          caught += c;
          changed += ch.length;
          per[sc.name] = { caught: c, of: ch.length };
        }
      }
      return { ...rule, falsePositives: fp, caught, changed, recall: changed ? caught / changed : 0, per };
    });
    const admissible = rules.filter((r) => r.falsePositives === 0).sort((a, b) => b.caught - a.caught);
    result.grids.push({ grid, signatureBytes: sigBytes, msPerCompare: ms / Math.max(1, compares), rules, best: admissible[0]?.name ?? null });
    const def = rules.find((r) => r.name === 'default');
    const best = admissible[0];
    log(
      `grid ${String(grid).padStart(3)} · sig ${(sigBytes / 1024).toFixed(1).padStart(5)} KB · default ${def.caught}/${def.changed} fp ${def.falsePositives}` +
        (best ? ` · best ${best.name.padEnd(12)} ${best.caught}/${best.changed} fp 0` : ' · no zero-fp rule')
    );
  }
} finally {
  eng.close();
}
log(`wrote ${writeReport(P, suite ? `calibration-${suite}` : 'calibration', result)}`);
