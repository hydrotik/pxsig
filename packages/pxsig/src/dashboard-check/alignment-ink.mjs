/**
 * dashboard-check/alignment-ink.mjs — the ink half of the `aligned` rule (alignment.mjs): from a
 * screenshot, where a label's capitals and its dot or icon are drawn, to sub-pixel edges by
 * coverage, and the finding when they are not centred on each other. Runs in Node (pngjs).
 */
import { ALIGN_TOLERANCE, MEASURE_PRECISION } from './alignment.mjs';
/** @import { PNG } from 'pngjs' */
/** @import { LayoutFinding } from '../types/t4.js' */
/** @import { AlignmentTargets, InkBand, InkOffset } from '../types/parity.js' */

/**
 * The background of a box: its most common colour (quantised to 4 bits a channel).
 * @param {PNG} png
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 device px, end exclusive
 * @returns {[number, number, number]}
 */
function backdrop(png, x0, y0, x1, y1) {
  /** @type {Map<number, { n: number, c: [number, number, number] }>} */
  const seen = new Map();
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * png.width + x) * 4;
      const c = /** @type {[number, number, number]} */ ([
        png.data[i],
        png.data[i + 1],
        png.data[i + 2],
      ]);
      const k = ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4);
      const s = seen.get(k) ?? { n: 0, c };
      s.n++;
      seen.set(k, s);
    }
  let best = { n: -1, c: /** @type {[number, number, number]} */ ([0, 0, 0]) };
  for (const s of seen.values()) if (s.n > best.n) best = s;
  return best.c;
}

/**
 * The ink band of some columns over some rows: its top and bottom edges in device px, sub-pixel by
 * coverage (a row's coverage: its most covered pixel, against the backdrop and the inkiest pixel).
 * Null when there is no ink.
 * @param {PNG} png
 * @param {[number, number][]} cols device-px column ranges, end exclusive
 * @param {number} y0 @param {number} y1 device px rows, end exclusive
 * @param {[number, number, number]} bg
 * @returns {InkBand | null}
 */
export function inkBand(png, cols, y0, y1, bg) {
  const dist = (/** @type {number} */ i) =>
    (Math.abs(png.data[i] - bg[0]) +
      Math.abs(png.data[i + 1] - bg[1]) +
      Math.abs(png.data[i + 2] - bg[2])) /
    3;
  /** @type {number[]} */
  const rows = [];
  let ink = 0;
  for (let y = y0; y < y1; y++) {
    let m = 0;
    for (const [a, b] of cols)
      for (let x = a; x < b; x++) m = Math.max(m, dist((y * png.width + x) * 4));
    rows.push(m);
    ink = Math.max(ink, m);
  }
  if (ink < 24) return null;
  const cov = rows.map((v) => Math.min(1, v / ink));
  const first = cov.findIndex((c) => c > 0.08);
  let last = cov.length - 1;
  while (last > first && !(cov[last] > 0.08)) last--;
  return { top: y0 + first + (1 - cov[first]), bottom: y0 + last + cov[last] };
}

/**
 * Each pair's offset, measured on the screenshot: the capitals' centre minus the graphic's, in CSS
 * px (positive: the capitals sit lower). A pair whose ink cannot be read is left out.
 * @param {PNG} png
 * @param {AlignmentTargets} t
 * @returns {InkOffset[]}
 */
export function inkOffsets(png, t) {
  const d = t.dpr;
  /** @type {InkOffset[]} */
  const out = [];
  for (const p of t.pairs) {
    const [rx, ry, rw, rh] = p.row.map((v) => v * d);
    const x0 = Math.max(0, Math.floor(rx));
    const y0 = Math.max(0, Math.floor(ry));
    const x1 = Math.min(png.width, Math.ceil(rx + rw));
    const y1 = Math.min(png.height, Math.ceil(ry + rh));
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    const bg = backdrop(png, x0, y0, x1, y1);
    /** @param {number} a @param {number} b */
    const span = (a, b) =>
      /** @type {[number, number]} */ ([
        Math.max(x0, Math.round(a * d)),
        Math.min(x1, Math.round(b * d)),
      ]);
    const caps = inkBand(
      png,
      p.caps.map(([a, b]) => span(a, b)),
      y0,
      y1,
      bg
    );
    const g = inkBand(png, [span(p.box[0], p.box[0] + p.box[2])], y0, y1, bg);
    // A capitals band outside 0.45–1 em is not text read right (a glyph cut off, an overlay).
    const capsHeight = caps ? (caps.bottom - caps.top) / d : 0;
    if (!caps || !g || capsHeight < 0.45 * p.fontSize || capsHeight > p.fontSize) continue;
    const capsCentre = (caps.top + caps.bottom) / 2 / d;
    const graphicCentre = (g.top + g.bottom) / 2 / d;
    out.push({
      pair: p,
      caps,
      graphic: g,
      offset: capsCentre - graphicCentre,
      capsCentre,
      graphicCentre,
    });
  }
  return out;
}

/**
 * The `aligned` finding for a measured pair, or null within ALIGN_TOLERANCE.
 * @param {InkOffset} m
 * @param {number} dpr
 * @returns {LayoutFinding | null}
 */
export function alignedFinding(m, dpr) {
  // "Within 0.5 px", as far as the measure can tell (MEASURE_PRECISION).
  if (Math.abs(m.offset) <= ALIGN_TOLERANCE + MEASURE_PRECISION) return null;
  const r = (/** @type {number} */ n) => Math.round(n * 100) / 100;
  const p = m.pair;
  const band = (/** @type {InkBand} */ b) => `${r(b.top / dpr)}–${r(b.bottom / dpr)}`;
  const cause = p.half
    ? `the row is on a half pixel (${p.half}), so the ${p.graphic} and the text snap apart`
    : Math.abs(p.boxCentre - p.lineCentre) < 0.25
      ? `the ${p.graphic} is centred on the line box (line-height ${p.lineHeight}), not on the capitals`
      : `the ${p.graphic}'s box is centred ${r(p.boxCentre - p.lineCentre)}px off the line box: its margin or alignment`;
  return {
    rule: 'aligned',
    text: `${p.name}: its ${p.graphic} is ${r(Math.abs(m.offset))}px ${m.offset > 0 ? 'above' : 'below'} the capitals' centre (capitals ${band(m.caps)}, ${p.graphic} ${band(m.graphic)}): ${cause}`,
  };
}
