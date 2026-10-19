#!/usr/bin/env node
/**
 * calibrate-detail.mjs — pick the detail channel's parameters from evidence.
 *
 * Re-scores every saved scenario render (general sample and suites) with the Rust engine doing
 * the pixel work:
 *   1. `baseline` builds signatures from the baseline images at the project's grid policy, without
 *      detail, into a scratch folder;
 *   2. `check` (daemon) scores every render under the project's whole-image gate (detail off): the
 *      signature verdict per render;
 *   3. `detail-sweep` measures, per render and per detail build (tile / block / selEnergy), every
 *      tile that moved.
 * A detail rule "≥ k tiles with blockDelta > T or energyRise > E", OR-ed with the signature verdict,
 * is admissible when it raises zero false positives on every noise scenario. The best admissible
 * rule catches the most changed regression renders; ties go to the smaller record.
 *
 *   node tools/calibrate-detail.mjs [--project name] [--workspace dir]
 *
 * Writes <store>/reports/calibration-detail.json; scratch under <store>/cache/research/calibrate-detail/.
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { baselineImages, engine, freshDir, log as logger, parseFlags, project, readReport, rust, scratchManifest, writeReport } from './lib/research.mjs';

const log = logger('calibrate-detail');
const flags = parseFlags();
const { P, run } = project(flags);
const BUILDS = flags.builds
  ? JSON.parse(flags.builds)
  : [
      { tile: 16, block: 4, selEnergy: 4 },
      { tile: 16, block: 4, selEnergy: 6 },
      { tile: 16, block: 4, selEnergy: 10 },
      { tile: 16, block: 2, selEnergy: 6 },
      { tile: 8, block: 2, selEnergy: 6 },
    ];
const KS = [1, 2, 3, 4, 6];
const TS = [16, 24, 32, 40, 48, 64, 96];
const ES = [12, 16, 24, 32, 48, 64, Infinity];
const { detail: _d, ...wholeGate } = run.gate ?? {};
const sigGate = { ...wholeGate, detail: false };

const t0 = performance.now();
const tags = readdirSync(P.store.reports).filter((f) => /^scenarios(-[\w.-]+)?\.json$/.test(f)).map((f) => f.slice(0, -5));
if (!tags.length) throw new Error(`no scenario reports in ${P.store.reports}: run tools/scenarios.mjs first`);
const scratch = freshDir(P, 'calibrate-detail');
const baseDir = join(scratch, 'base');
const pairs = [];
const verdict = new Map(); // key → { suite, scenario, kind, changed, sigCaught }
const eng = engine(P);
try {
  for (const tag of tags) {
    const rep = readReport(P, tag);
    const ids = new Set(rep.scenarios[0].rows.filter((r) => !r.error).map((r) => r.id));
    const entries = run.stories.filter((e) => ids.has(e.id)).map(({ gate, grid, ...e }) => e);
    baselineImages(P, entries, baseDir);
    const manifest = scratchManifest(P, join(scratch, `${tag}.json`), { grid: run.grid, minCellPx: run.minCellPx, detail: false }, entries, (e) => `sig/${tag}/${e.id}.pxsig.json`);
    rust(P, ['baseline', '--manifest', manifest, '--png-dir', baseDir, '--root', scratch, '--no-detail', '--json']);
    for (const sc of rep.scenarios) {
      const dir = join(P.store.root, 'renders', tag, sc.name);
      const out = await eng.call('check', { manifest, pngDir: dir, root: scratch, artifacts: 'none', gate: sigGate });
      const byId = new Map(out.results.map((r) => [r.id, r]));
      for (const row of sc.rows) {
        const r = byId.get(row.id);
        if (row.error || !r || r.error) continue;
        const key = `${tag}/${sc.name}/${row.id}`;
        verdict.set(key, { suite: tag, scenario: sc.name, kind: sc.kind, changed: row.changed, sigCaught: r.pass === false });
        pairs.push({ key, base: join(baseDir, `${row.id}.png`), cur: join(dir, `${row.id}.png`) });
      }
    }
  }
} finally {
  eng.close();
}
const sweepIn = join(scratch, 'sweep.json');
writeFileSync(sweepIn, JSON.stringify({ pairs, builds: BUILDS }));
const tSweep = performance.now();
const sweep = rust(P, ['detail-sweep', '--input', sweepIn]).out;
const sweepMs = performance.now() - tSweep;

const candidates = [];
BUILDS.forEach((build, bi) => {
  const rows = sweep.rows.map((r) => ({ key: r.key, ...verdict.get(r.key), b: r.builds[bi] }));
  const bytes = rows.reduce((a, r) => a + r.b.recordBytes, 0) / Math.max(1, rows.length);
  for (const k of KS)
    for (const T of TS)
      for (const E of ES) {
        let fp = 0;
        let caught = 0;
        let changed = 0;
        let detailOnly = 0;
        const per = {};
        for (const r of rows) {
          const moved = r.b.moved.filter(([bd, rise]) => bd > T || rise > E).length;
          const fails = r.sigCaught || moved >= k;
          const name = `${r.suite}/${r.scenario}`;
          per[name] ??= { kind: r.kind, caught: 0, sigCaught: 0, of: 0, fp: 0 };
          if (r.kind === 'noise') {
            per[name].of++;
            if (fails) fp++, per[name].fp++;
          } else if (r.changed) {
            changed++;
            per[name].of++;
            if (r.sigCaught) per[name].sigCaught++;
            if (fails) caught++, per[name].caught++;
            if (fails && !r.sigCaught) detailOnly++;
          }
        }
        candidates.push({ build, k, T, E: E === Infinity ? null : E, fp, caught, changed, detailOnly, avgRecordBytes: Math.round(bytes), per });
      }
});
const sigOnly = { caught: 0, changed: 0, fp: 0 };
for (const v of verdict.values()) {
  if (v.kind === 'noise') sigOnly.fp += v.sigCaught ? 1 : 0;
  else if (v.changed) sigOnly.changed++, (sigOnly.caught += v.sigCaught ? 1 : 0);
}
// Per-suite optimum: what a story-level gate (parameters.pxsig.gate) could buy one family.
const perSuite = {};
for (const tag of tags) {
  const scoped = candidates.map((c) => {
    const ps = Object.entries(c.per).filter(([n]) => n.startsWith(`${tag}/`));
    const regs = ps.filter(([, p]) => p.kind === 'regression');
    return { build: c.build, k: c.k, T: c.T, E: c.E, fp: ps.reduce((a, [, p]) => a + p.fp, 0), caught: regs.reduce((a, [, p]) => a + p.caught, 0), of: regs.reduce((a, [, p]) => a + p.of, 0), avgRecordBytes: c.avgRecordBytes };
  });
  perSuite[tag] = scoped.filter((c) => c.fp === 0).sort((a, b) => b.caught - a.caught || a.avgRecordBytes - b.avgRecordBytes)[0] ?? null;
}
const admissible = candidates.filter((c) => c.fp === 0).sort((a, b) => b.caught - a.caught || a.avgRecordBytes - b.avgRecordBytes || b.k - a.k || b.T - a.T);
const best = admissible[0] ?? null;
const g = sigGate;
const result = {
  generatedAt: new Date().toISOString(),
  project: P.name,
  renders: pairs.length,
  sweepMs,
  totalMs: performance.now() - t0,
  signatureGate: `grid ${run.grid}${run.minCellPx ? ` (cells ≥ ${run.minCellPx} px)` : ''}, ssim < ${g.minSsim} or > ${g.maxChangedPct}% cells or ≥ ${g.minCells} cells off by > ${g.threshold}`,
  current: run.detail ? run.gate?.detail ?? null : false,
  sigOnly,
  best,
  perSuite,
  topAdmissible: admissible.slice(0, 15).map(({ per, ...c }) => c),
  builds: BUILDS,
};
log(`${pairs.length} renders · sweep ${(sweepMs / 1000).toFixed(2)} s in Rust`);
log(`  signature gate alone: ${sigOnly.caught}/${sigOnly.changed} caught · ${sigOnly.fp} false positives`);
if (best) {
  log(`  + detail (tile ${best.build.tile}, block ${best.build.block}, sel ${best.build.selEnergy}; ≥${best.k} tiles, Δ>${best.T}, rise>${best.E ?? '∞'}): ${best.caught}/${best.changed} caught · 0 fp · ~${(best.avgRecordBytes / 1024).toFixed(1)} KB/record`);
  for (const [name, p] of Object.entries(best.per)) if (p.kind === 'regression') log(`    ${name.padEnd(36)} ${p.sigCaught}/${p.of} → ${p.caught}/${p.of}`);
} else log('  no zero-false-positive detail rule (the signature gate alone already raises false positives?)');
log(`wrote ${writeReport(P, 'calibration-detail', result)}`);
