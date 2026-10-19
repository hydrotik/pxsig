/**
 * shape.mjs — is a change only colour, or did something move, appear or disappear?
 *
 * Builds an "ink" mask per image (pixels that differ from the page background, taken from the
 * corner) and compares the masks colour-blind, forgiving 2 px of edge growth so anti-aliasing and
 * text that crosses the threshold after a contrast bump do not count. A recolour keeps its ink
 * where it was; moved, added or removed content does not. A size change is always `shape`.
 *
 * Tuned to over-report: a false `shape` costs one look, a false `colour` approves a regression.
 * The 2026-10-17 colour re-baseline: every recolour scored < 0.1 %; the Switch thumb 7–16 %,
 * a one-line copy edit 0.33 %, a dot grid crossing the threshold 0.9 %.
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const SHAPE_PCT = 0.2; // % of the baseline's ink
const SHAPE_PX = 20;
const DILATE = 2;
const INK_TOLERANCE = 24; // summed RGB distance from the background

/** `src` is a path or PNG bytes (a `.psig`'s image section). */
function ink(src) {
  const img = PNG.sync.read(Buffer.isBuffer(src) ? src : readFileSync(src));
  const { width: w, height: h, data } = img;
  const o = (2 * w + 2) * 4;
  const bg = [data[o], data[o + 1], data[o + 2]];
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const d =
      Math.abs(data[i * 4] - bg[0]) +
      Math.abs(data[i * 4 + 1] - bg[1]) +
      Math.abs(data[i * 4 + 2] - bg[2]);
    m[i] = d > INK_TOLERANCE ? 1 : 0;
  }
  return { w, h, m };
}

function dilate({ w, h, m }) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      for (let dy = -DILATE; dy <= DILATE; dy++)
        for (let dx = -DILATE; dx <= DILATE; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w) out[yy * w + xx] = 1;
        }
    }
  return out;
}

/** `base` and `latest` are paths or PNG bytes. → { kind: 'colour' | 'shape', reason, added, removed, inkPx, shapePct } */
export function classify(base, latest) {
  const a = ink(base);
  const b = ink(latest);
  if (a.w !== b.w || a.h !== b.h)
    return {
      kind: 'shape',
      reason: `size ${a.w}×${a.h} → ${b.w}×${b.h}`,
      added: null,
      removed: null,
      inkPx: null,
      shapePct: null,
    };
  const da = dilate(a);
  const db = dilate(b);
  let added = 0;
  let removed = 0;
  let inkPx = 0;
  for (let i = 0; i < a.m.length; i++) {
    inkPx += a.m[i];
    if (b.m[i] && !da[i]) added++;
    if (a.m[i] && !db[i]) removed++;
  }
  const shapePct = Math.round(((added + removed) / Math.max(inkPx, 1)) * 10000) / 100;
  const shape = shapePct >= SHAPE_PCT || added + removed >= SHAPE_PX;
  return {
    kind: shape ? 'shape' : 'colour',
    reason: shape
      ? `${added} px of content added, ${removed} removed (${shapePct}% of the ink)`
      : 'content in place; colour only',
    added,
    removed,
    inkPx,
    shapePct,
  };
}
