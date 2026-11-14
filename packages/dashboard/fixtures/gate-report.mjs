/**
 * gate-report.mjs — sample answers for the inspector's Report to pxsig: the facts of a gate report
 * (what packages/pxsig/src/lib/gate-report.mjs builds from a check row and the engine's diff) for
 * the sample images' change, and the self-check's answer. `pxsig dashboard check`'s server and the
 * flows tests make the text, the link and the image from these facts with pxsig's own code, so the
 * screens show what a real report holds. Neutral names and fixed numbers: two runs give the same.
 */

/** The sample images' change (dashboard-check/server.mjs `sampleImages`): the button moved 16px. */
const REGION = { x: 60, y: 120, w: 136, h: 32, px: 1024 };

/**
 * The facts of the sample entry's gate report, with the dialog's options.
 * @param {{ full?: boolean, keepId?: boolean, noImage?: boolean }} [o]
 */
export function gateFacts({ full = false, keepId = false, noImage = false } = {}) {
  const box = full ? { x: 0, y: 0, w: 320, h: 200 } : { x: 44, y: 104, w: 168, h: 64 };
  const scale = full ? 1 : 2;
  return {
    v: 1,
    entry: keepId ? 'ui-button--primary' : 'entry-1',
    mode: 'dark',
    state: null,
    pxsig: '0.0.0-sample',
    engine: '0.0.0-sample',
    verdict: 'fails',
    gate: {
      threshold: 24,
      minSsim: 0.99,
      maxChangedPct: 2,
      maxEdgePct: null,
      minCells: 3,
      detail: { blockDelta: 32, energyDelta: 48, minTiles: 3 },
      color: { deltaE: 3, minArea: 64, cellDeltaE: 5, minCells: 3 },
    },
    metrics: { ssim: 0.8, changedCells: 12, changedCellsPct: 3, grid: 64, threshold: 24 },
    color: null,
    detail: { changedTiles: 4, newEdgeTiles: 2, maxBlockDelta: 61 },
    reasons: ['ssim 0.8 < min 0.99'],
    pixels: { width: 320, height: 200, changed: 1024, maxDelta: 180, regions: 1 },
    regions: [noImage ? { ...REGION, baseline: '#5d7dc8', render: '#9aa6c4' } : REGION],
    environment: {
      render: 'Linux x64 · chromium 140 · GPU swiftshader · container',
      baseline: 'Linux x64 · chromium 140 · GPU swiftshader · container',
      match: 'same',
    },
    image: noImage
      ? null
      : {
          crop: full ? 'full' : 'regions',
          margin: full ? 0 : 16,
          box,
          scale,
          width: box.w * scale * 3 + 16,
          height: box.h * scale,
        },
  };
}

/**
 * The self-check's answer in a scenario: the entry still fails the gate on this machine.
 * @param {string} _name
 */
export const selfCheckOf = (_name) => ({ state: 'differs', reasons: ['ssim 0.8 < min 0.99'] });
