/**
 * live/pair.mjs — the live screens' `{ pair: id }` action (scripts/live/run.mjs): one baseline of
 * the scratch store made as `pxsig migrate` made such pairs before it checked them, for the
 * live.record-repair flow. The latest render becomes the baseline image (the render itself is not
 * touched, so nothing reads as re-rendered), packed with a record captured from another render (that
 * render with one pixel changed: within the gate), and one `pxsig migrate` line logged for the new
 * bytes. The scratch store only.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decisionRef,
  migrateBatch,
  paths,
  sha256,
  stamp,
} from '../../packages/pxsig/src/lib/approvals.mjs';
import { appendLine } from '../../packages/pxsig/src/lib/files.mjs';
import { readHeader } from '../../packages/pxsig/src/lib/psig.mjs';
import { openProject } from '../../packages/pxsig/src/lib/workspace.mjs';
import { repo } from './stage.mjs';

/** pngjs, as the live run reads it (it resolves from packages/pxsig). */
const { PNG } =
  /** @type {{ PNG: { sync: { read: (b: Buffer) => { width: number, height: number, data: Buffer }, write: (p: object) => Buffer } } }} */ (
    createRequire(join(repo, 'packages', 'pxsig', 'package.json'))('pngjs')
  );
/** When the staged migrate line says it was written (a fixed time: the scrub fixes it anyway). */
const AT = '2026-10-25T10:00:00.000Z';

/**
 * Make `id`'s baseline a record and an image from two renders, logged by migrate only.
 * @param {string} dir the staged workspace (a single-package project)
 * @param {string} id
 * @param {NodeJS.ProcessEnv} [env] what the engine is found from (`PXSIG_BIN`)
 */
export function stagePair(dir, id, env = process.env) {
  const P = openProject({ cwd: dir, env });
  // The manifest `pxsig manifest` wrote in the scratch store.
  const manifest = /** @type {{ stories: { id: string, sig: string }[] }} */ (
    JSON.parse(readFileSync(P.manifestPath(), 'utf8'))
  );
  const entry = manifest.stories.find((e) => e.id === id);
  if (!entry) throw new Error(`live pair: ${id} is not in the manifest`);
  const p = paths(P, entry);
  const image = readFileSync(p.latestPng);
  // The header pxsig wrote: its record's grid and whether it has the detail channel.
  const record = /** @type {{ config?: { grid?: number }, detail?: unknown } | undefined} */ (
    readHeader(p.sig)?.record
  );
  if (!record) throw new Error(`live pair: ${id} has no baseline`);
  const tmp = mkdtempSync(join(tmpdir(), 'pxsig-live-pair-'));
  try {
    const png = PNG.sync.read(image);
    // Another render: the first pixel's colour inverted.
    for (let i = 0; i < 3; i++) png.data[i] = 255 - png.data[i];
    writeFileSync(join(tmp, 'other.png'), PNG.sync.write(png));
    writeFileSync(join(tmp, 'image.png'), image);
    const rec = join(tmp, 'other.pxsig.json');
    /** @param {string[]} args */
    const engine = (args) => {
      const r = spawnSync(P.rustBin, args, { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`live pair: pxsig ${args[0]}: ${r.stderr}`);
    };
    engine([
      'capture',
      join(tmp, 'other.png'),
      '--out',
      rec,
      '--grid',
      String(record.config?.grid ?? 64),
      ...(record.detail ? ['--detail'] : []),
    ]);
    engine([
      'pack',
      rec,
      '--out',
      p.sig,
      '--image',
      join(tmp, 'image.png'),
      '--entry',
      JSON.stringify({ id }),
    ]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  appendLine(
    P.store.approvals,
    stamp({
      at: AT,
      id,
      via: 'migrate',
      batch: migrateBatch(AT),
      ref: decisionRef(),
      kind: null,
      gitHead: null,
      before: null,
      after: sha256(p.sig),
    })
  );
}
