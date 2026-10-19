#!/usr/bin/env node
/**
 * bench.mjs — how fast the Rust engine and the renderer are on this project.
 *
 *   check       batch check of the latest renders against the committed baselines, at 1…N
 *               threads (metrics only, no artifacts): the engine's own time and process wall
 *               time, median of --runs
 *   capture     batch `baseline` over the same renders, written to a scratch folder
 *   per call    one `compare` per process (CLI) vs one request to the daemon (`pxsig serve`)
 *   memory      peak RSS of the batch check
 *   render      Playwright wall time for the entries at 1, 2, 4, 8 pages
 *   footprint   the binary's size
 *
 *   node tools/bench.mjs [--project name] [--workspace dir] [--runs 5] [--no-render]
 *        [--concurrency 1,2,4,8] [--every N] [--max N]
 *
 * Needs the latest renders (`pxsig check` first). Writes <store>/reports/bench.json; scratch
 * under <store>/cache/research/bench/.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { cpus, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { browserPool, engine, freshDir, log as logger, median, nums, parseFlags, pickEntries, project, renderStories, rust, scratchManifest, writeReport } from './lib/research.mjs';

const log = logger('bench');
const flags = parseFlags();
const { P, run } = project(flags);
const RUNS = Number(flags.runs) || 5;
const pngDir = P.store.latest;
const entries = run.stories.filter((e) => existsSync(join(pngDir, `${e.id}.png`)) && existsSync(resolve(P.workspaceRoot, e.sig)));
if (!entries.length) throw new Error(`no latest renders with baselines in ${pngDir}: run \`pxsig check\` first`);
const N = entries.length;
const scratch = freshDir(P, 'bench');
const out = { generatedAt: new Date().toISOString(), project: P.name, stories: N, cpus: cpus().length, cpu: cpus()[0]?.model ?? null, runs: RUNS };

// The latest renders that have a baseline, against the committed baselines (read only).
const checkManifest = scratchManifest(P, join(scratch, 'check.json'), run, entries);
const checkArgs = ['check', '--manifest', checkManifest, '--png-dir', pngDir, '--root', P.workspaceRoot, '--no-artifacts', '--json'];

// --- batch check by thread count ----------------------------------------------------------------
const threads = [1, 2, 4, 8, cpus().length].filter((v, i, a) => v <= cpus().length && a.indexOf(v) === i);
out.check = { rust: {} };
for (const t of threads) {
  const internal = [];
  const wall = [];
  for (let i = 0; i < RUNS; i++) {
    const r = rust(P, ['-j', String(t), ...checkArgs]);
    internal.push(r.out.summary.elapsedMs);
    wall.push(r.wallMs);
  }
  out.check.rust[t] = { internalMs: median(internal), wallMs: median(wall) };
}
log(`check ${N}: ${threads.map((t) => `${t}t ${out.check.rust[t].wallMs.toFixed(0)} ms`).join(' · ')} (process wall)`);

// --- batch capture (scratch signatures; the committed ones are never touched) --------------------
const capManifest = scratchManifest(P, join(scratch, 'capture.json'), run, entries, (e) => `sig/${e.id}.psig`);
const capWall = [];
const capInternal = [];
for (let i = 0; i < RUNS; i++) {
  const r = rust(P, ['baseline', '--manifest', capManifest, '--png-dir', pngDir, '--root', scratch, '--json']);
  capWall.push(r.wallMs);
  capInternal.push(r.out.summary.elapsedMs);
}
out.capture = { rustWallMs: median(capWall), rustInternalMs: median(capInternal) };
log(`capture ${N}: ${out.capture.rustWallMs.toFixed(0)} ms process wall · ${out.capture.rustInternalMs.toFixed(0)} ms in the engine (writes .psig files)`);

// --- per call: CLI process vs daemon request ------------------------------------------------------
const sample = entries.slice(0, 30);
const cli = [];
for (const e of sample) cli.push(rust(P, ['compare', join(pngDir, `${e.id}.png`), resolve(P.workspaceRoot, e.sig), '--json']).wallMs);
const eng = engine(P);
const serve = [];
try {
  await eng.call('ping');
  for (const e of sample) {
    const t = performance.now();
    await eng.call('compare', { png: join(pngDir, `${e.id}.png`), sig: resolve(P.workspaceRoot, e.sig) });
    serve.push(performance.now() - t);
  }
} finally {
  eng.close();
}
out.perCall = { rustMs: median(cli), serveMs: median(serve), samples: sample.length };
log(`per-call compare: CLI process ${out.perCall.rustMs.toFixed(1)} ms · daemon ${out.perCall.serveMs.toFixed(2)} ms`);

// --- memory ----------------------------------------------------------------------------------------
function peakRss(cmd, args) {
  const mac = platform() === 'darwin';
  const r = spawnSync('/usr/bin/time', [mac ? '-l' : '-v', cmd, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) return null;
  const m = mac ? r.stderr.match(/(\d+)\s+maximum resident set size/) : r.stderr.match(/Maximum resident set size \(kbytes\):\s*(\d+)/);
  return m ? Number(m[1]) * (mac ? 1 : 1024) : null;
}
out.memory = { rustPeakRssBytes: peakRss(P.rustBin, checkArgs) };
if (out.memory.rustPeakRssBytes) log(`peak RSS (batch check): ${(out.memory.rustPeakRssBytes / 1e6).toFixed(0)} MB`);

out.footprint = { rustBinaryBytes: statSync(P.rustBin).size };

// --- render throughput by page-pool size -------------------------------------------------------------
if (!flags['no-render']) {
  const stories = pickEntries(run, flags);
  const browser = browserPool(P);
  out.render = { stories: stories.length, byConcurrency: {} };
  try {
    for (const c of nums(flags.concurrency, [1, 2, 4, 8])) {
      const dir = freshDir(P, 'bench', `render-${c}`);
      const { results, wallMs, reloads } = await renderStories(browser, stories, dir, { ...run, concurrency: c, project: P, a11y: false });
      out.render.byConcurrency[c] = { wallMs, msPerStory: wallMs / stories.length, errors: results.filter((r) => r.error).length, reloads };
      log(`render ${stories.length} entries @ ${c} page(s): ${(wallMs / 1000).toFixed(1)} s (${(wallMs / stories.length).toFixed(0)} ms/entry)`);
    }
  } finally {
    await browser.close();
  }
}

log(`wrote ${writeReport(P, 'bench', out)}`);
