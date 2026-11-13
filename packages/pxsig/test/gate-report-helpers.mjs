/**
 * gate-report-helpers.mjs — a project for the gate report's tests, with no engine: one changed
 * entry whose baseline (.psig with its image section), latest render and check row (gate, metrics,
 * reasons, environments) are written here, and a diff in JavaScript that answers as the engine's
 * `diff` does (changed pixels, one region per changed bar, the mask PNG).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';
import { openProject } from '../src/lib/workspace.mjs';
import { tempDir } from './fixture.mjs';

export const ID = 'secret-widgets--launch-banner@dark';
export const STORY = 'secret-widgets--launch-banner';

/**
 * A w×h image: `bg`, with `bars` ([x, y, w, h, [r, g, b]]) painted over it.
 * @param {number} w
 * @param {number} h
 * @param {number[]} bg
 * @param {[number, number, number, number, number[]][]} bars
 */
export function image(w, h, bg, bars) {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const bar = bars.find(([bx, by, bw, bh]) => x >= bx && x < bx + bw && y >= by && y < by + bh);
      p.data.set([...(bar ? bar[4] : bg), 255], (y * w + x) * 4);
    }
  return PNG.sync.write(p);
}

/**
 * A `.psig` holding `png` as its image section (the signature section is empty: the report never
 * reads it).
 * @param {string} id
 * @param {Buffer} png
 */
function psig(id, png) {
  const header = Buffer.from(
    JSON.stringify({
      format: 'psig',
      container: 1,
      entry: { id },
      record: {},
      encryption: 'none',
      sections: [
        { name: 'sig', length: 0, sha256: '' },
        {
          name: 'image',
          type: 'image/png',
          length: png.length,
          sha256: createHash('sha256').update(png).digest('hex'),
        },
      ],
    })
  );
  const pre = Buffer.alloc(10);
  pre.write('PSIG', 0, 'latin1');
  pre.writeUInt16LE(1, 4);
  pre.writeUInt32LE(header.length, 6);
  return Buffer.concat([pre, header, png]);
}

/**
 * The engine's `diff`, in JavaScript: every pixel that differs is changed; one region per
 * connected run of rows (enough for bars); the mask magenta on transparent.
 * @type {import('../src/types/rejections.js').DiffFn}
 */
export async function jsDiff(a, b, maskPath) {
  const { readFileSync } = await import('node:fs');
  const A = PNG.sync.read(readFileSync(a));
  const B = PNG.sync.read(readFileSync(b));
  const W = Math.max(A.width, B.width);
  const H = Math.max(A.height, B.height);
  const mask = new PNG({ width: W, height: H });
  /** @type {{ x: number, y: number, w: number, h: number, px: number }[]} */
  const regions = [];
  let changed = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const same =
        x < A.width &&
        y < A.height &&
        x < B.width &&
        y < B.height &&
        [0, 1, 2].every(
          (k) => A.data[(y * A.width + x) * 4 + k] === B.data[(y * B.width + x) * 4 + k]
        );
      if (same) continue;
      changed++;
      mask.data.set([255, 0, 255, 255], i);
      const r = regions.find(
        (g) => x >= g.x - 1 && x <= g.x + g.w && y >= g.y - 1 && y <= g.y + g.h
      );
      if (!r) regions.push({ x, y, w: 1, h: 1, px: 1 });
      else {
        const x1 = Math.max(r.x + r.w, x + 1);
        const y1 = Math.max(r.y + r.h, y + 1);
        r.x = Math.min(r.x, x);
        r.y = Math.min(r.y, y);
        r.w = x1 - r.x;
        r.h = y1 - r.y;
        r.px++;
      }
    }
  writeFileSync(maskPath, PNG.sync.write(mask));
  return { width: W, height: H, changed, maxDelta: changed ? 255 : 0, regions };
}

/** The render environment the check recorded (as lib/env.mjs keeps it in check.json's `envs`). */
const ENV = {
  v: 1,
  id: 'e1',
  browser: { name: 'chromium', version: '141.0.7390.37', channel: null, launchArgs: [] },
  playwright: '1.56.0',
  os: { platform: 'darwin', arch: 'arm64', release: '24.6.0', distro: null },
  fonts: { probe: { digest: 'x', families: {} }, system: null },
  render: {
    dpr: 1,
    gpu: 'angle-metal',
    colorGamut: 'srgb',
    timezone: 'UTC',
    locale: 'en-US',
    reducedMotion: 'reduce',
  },
  capture: { pipeline: 1 },
  container: null,
  pxsig: '0.0.0',
  engine: '0.0.0',
  node: '22.0.0',
};

/**
 * The project: a 200×100 capture whose 40×20 bar at (60, 40) changed colour (green to purple), or
 * `opts` for another change. `row` is laid over the check row.
 * @param {{ after: (fn: () => void) => void }} t
 * @param {{ row?: Record<string, unknown>, base?: Buffer, render?: Buffer, sig?: boolean }} [opts]
 */
export function reportProject(t, opts = {}) {
  const root = tempDir('report', t);
  const px = join(root, '.pxsig');
  /** @param {string} p @param {string | Buffer} d */
  const w = (p, d) => (mkdirSync(dirname(p), { recursive: true }), writeFileSync(p, d));
  w(
    join(root, 'pxsig.config.json'),
    JSON.stringify({ name: 'secret-app', srcRoot: 'src', storybook: { url: 'http://127.0.0.1:1' } })
  );
  mkdirSync(join(root, 'src'), { recursive: true });
  const sig = `.pxsig/baselines/secret/${ID}.psig`;
  w(
    join(px, 'manifest.json'),
    JSON.stringify({
      version: 2,
      project: 'secret-app',
      skipped: [],
      stories: [{ id: ID, story: STORY, mode: 'dark', state: null, sig }],
    })
  );
  const base = opts.base ?? image(200, 100, [250, 250, 250], [[60, 40, 40, 20, [31, 122, 67]]]);
  const render =
    opts.render ?? image(200, 100, [250, 250, 250], [[60, 40, 40, 20, [122, 31, 106]]]);
  if (opts.sig !== false) w(join(root, sig), psig(ID, base));
  w(join(px, 'renders', 'latest', `${ID}.png`), render);
  const row = {
    id: ID,
    story: STORY,
    mode: 'dark',
    state: null,
    pass: false,
    changed: true,
    gate: {
      threshold: 24,
      minSsim: 0.99,
      maxChangedPct: 2,
      maxEdgePct: null,
      minCells: 3,
      detail: null,
      color: { deltaE: 3, minArea: 64, cellDeltaE: 5, minCells: 3 },
    },
    metrics: { ssim: 0.9644, changedCells: 12, changedCellsPct: 4.7, grid: 16, threshold: 24 },
    color: { flatArea: 532, flatDeltaE: 7.8, cells: 4, maxCellDeltaE: 9.1 },
    reasons: [`color ΔE00 7.8 over 532 px (flat area) >= 3`, `rendered at ${root}/src`],
    env: 'e1',
    baselineEnv: 'e1',
    envMatch: 'same',
    checkedAt: '2026-11-13T10:00:00.000Z',
    ...opts.row,
  };
  w(
    join(px, 'reports', 'check.json'),
    JSON.stringify({ summary: {}, rows: [row], envs: { e1: ENV } })
  );
  const P = openProject({ cwd: root, env: { PXSIG_BIN: join(root, 'no-engine') } });
  return { root, px, P };
}
