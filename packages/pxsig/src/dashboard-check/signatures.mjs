/**
 * dashboard-check/signatures.mjs — the sample entry's signature images, made by the engine from the
 * sample images as a check makes them: `capture` the baseline into a signature, `compare` the
 * render with it, and read back the baseline and current signatures and the cell heatmap it writes
 * (`<stem>.{baseline,current,diff}.png`, square: the grid scaled up). Made once, when the server
 * starts, in a temporary folder that is removed after; nothing is committed or written elsewhere.
 * Without the engine (or when it fails) the answer is null and the server keeps its stand-ins.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from '../lib/spawn.mjs';
import { rustBinary } from '../lib/workspace/peers.mjs';
/** @import { SampleImages } from '../types/t4.js' */

/** @typedef {{ baseline: Buffer, current: Buffer, diff: Buffer }} SampleSignatures the engine's `<stem>.{baseline,current,diff}.png`: square */

/** The sample's grid: the engine's default, set so a PXSIG_GRID in the environment cannot move it. */
const GRID = '64';

/**
 * @param {Pick<SampleImages, 'baseline' | 'render'>} images
 * @param {string} [bin] the engine
 * @returns {SampleSignatures | null}
 */
export function sampleSignatures(images, bin = rustBinary()) {
  if (!existsSync(bin)) return null;
  const dir = mkdtempSync(join(tmpdir(), 'pxsig-sample-sigs-'));
  try {
    const base = join(dir, 'baseline.png');
    const render = join(dir, 'render.png');
    const sig = join(dir, 'sample.psig');
    const out = join(dir, 'out');
    writeFileSync(base, images.baseline);
    writeFileSync(render, images.render);
    const env = { ...process.env };
    delete env.PXSIG_GRID;
    const run = (/** @type {string[]} */ args) =>
      spawnSync(bin, args, { cwd: dir, env, stdio: 'ignore', timeout: 30_000 }).status;
    if (run(['capture', base, '--out', sig, '--grid', GRID]) !== 0) return null;
    // Exit 1 is "fails the gate": the sample render is a change, so that is the expected answer.
    const status = run(['compare', render, sig, '--out-dir', out]);
    if (status !== 0 && status !== 1) return null;
    const read = (/** @type {string} */ kind) => readFileSync(join(out, `sample.${kind}.png`));
    return { baseline: read('baseline'), current: read('current'), diff: read('diff') };
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
