/**
 * lib/rejections/crops.mjs — the rejection packet's crops: full-size cuts of the changed regions
 * of a rejected entry, from the baseline image and the latest render, so a shift of a few pixels
 * is visible (the 512px diff images are the signature's cells upscaled, and cannot show one).
 *
 * The regions and the mask are the engine's `diff` (crates/pxsig-core/src/pixeldiff.rs, the same
 * algorithm as a check row's `pixels.regions`). Each region is padded, clamped to the image and
 * merged with any padded region it overlaps; the largest are kept. A crop is upscaled by an
 * integer (nearest neighbour), never downscaled, and left out when its long side passes 1,024px.
 * `<n>.diff.png` is the baseline at 30% luminance with the changed pixels in magenta; with
 * `annotate`, each changed region is outlined on all three.
 */
import { PNG } from 'pngjs';
/** @import { PacketCrop, PixelDiff } from '../../types/rejections.js' */

/** `auto` scale: the short side at least this, in px. */
const AUTO_SHORT = 160;
/** The largest upscale. */
const MAX_SCALE = 4;
/** A crop whose long side passes this (in px, after scaling) is scaled down to fit, or left out. */
const MAX_LONG = 1024;
/** Regions considered, largest first: noise past this is in mask.png, not in a crop. */
const MAX_REGIONS = 200;

/** @typedef {{ x0: number, y0: number, x1: number, y1: number, px: number, areas: { x: number, y: number, w: number, h: number }[] }} Box */
/** @typedef {[number, number, number, number]} Rgba */

/**
 * The padded, clamped and merged boxes of `regions`, the `max` with the most changed pixels first.
 * @param {PixelDiff['regions']} regions
 * @param {{ pad: number, max: number }} opts
 * @param {number} W the diff's width
 * @param {number} H the diff's height
 * @returns {Box[]}
 */
export function cropBoxes(regions, { pad, max }, W, H) {
  /** @type {Box[]} */
  let boxes = [...regions]
    .sort((a, b) => b.px - a.px)
    .slice(0, MAX_REGIONS)
    .map((r) => ({
      x0: Math.max(0, r.x - pad),
      y0: Math.max(0, r.y - pad),
      x1: Math.min(W, r.x + r.w + pad),
      y1: Math.min(H, r.y + r.h + pad),
      px: r.px,
      areas: [{ x: r.x, y: r.y, w: r.w, h: r.h }],
    }))
    .filter((b) => b.x1 > b.x0 && b.y1 > b.y0);
  /** @param {Box} a @param {Box} b */
  const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  for (let merged = true; merged;) {
    merged = false;
    /** @type {Box[]} */
    const out = [];
    for (const b of boxes) {
      const into = out.find((o) => overlap(o, b));
      if (!into) {
        out.push(b);
        continue;
      }
      into.x0 = Math.min(into.x0, b.x0);
      into.y0 = Math.min(into.y0, b.y0);
      into.x1 = Math.max(into.x1, b.x1);
      into.y1 = Math.max(into.y1, b.y1);
      into.px += b.px;
      into.areas.push(...b.areas);
      merged = true;
    }
    boxes = out;
  }
  return boxes.sort((a, b) => b.px - a.px || a.y0 - b.y0 || a.x0 - b.x0).slice(0, max);
}

/**
 * The integer upscale of a w×h crop: `auto` brings the short side to 160px, at most 4×; a fixed
 * scale is lowered until the long side fits 1,024px. 0: the crop is too large at 1×.
 * @param {number} w
 * @param {number} h
 * @param {'auto' | number} scale
 */
export function scaleFor(w, h, scale) {
  const long = Math.max(w, h);
  if (long > MAX_LONG) return 0;
  let s =
    scale === 'auto'
      ? Math.min(MAX_SCALE, Math.max(1, Math.ceil(AUTO_SHORT / Math.max(1, Math.min(w, h)))))
      : scale;
  while (s > 1 && long * s > MAX_LONG) s--;
  return s;
}

/**
 * Cut `box` out of `img`, upscaled by `s`; a pixel outside the image is transparent.
 * @param {PNG} img
 * @param {Box} box
 * @param {number} s
 * @param {((px: Rgba, x: number, y: number) => Rgba) | null} [map]
 */
function cut(img, box, s, map = null) {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const out = new PNG({ width: w * s, height: h * s });
  for (let y = 0; y < h * s; y++)
    for (let x = 0; x < w * s; x++) {
      const sx = box.x0 + Math.floor(x / s);
      const sy = box.y0 + Math.floor(y / s);
      const i = (sy * img.width + sx) * 4;
      /** @type {Rgba} */
      let px =
        sx < img.width && sy < img.height
          ? [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]
          : [0, 0, 0, 0];
      if (map) px = map(px, sx, sy);
      out.data.set(px, (y * w * s + x) * 4);
    }
  return out;
}

/**
 * Outline each changed area of `box` just outside it: 1px at 1×, 2px from 2×.
 * @param {PNG} png
 * @param {Box} box
 * @param {number} s
 * @param {[number, number, number]} colour
 */
function outline(png, box, s, colour) {
  const t = s >= 2 ? 2 : 1;
  /** @param {number} x @param {number} y */
  const put = (x, y) => {
    if (x >= 0 && y >= 0 && x < png.width && y < png.height)
      png.data.set([...colour, 255], (y * png.width + x) * 4);
  };
  for (const a of box.areas) {
    const x0 = (a.x - box.x0) * s - t;
    const y0 = (a.y - box.y0) * s - t;
    const x1 = (a.x + a.w - box.x0) * s + t - 1;
    const y1 = (a.y + a.h - box.y0) * s + t - 1;
    for (let k = 0; k < t; k++) {
      for (let x = x0; x <= x1; x++) {
        put(x, y0 + k);
        put(x, y1 - k);
      }
      for (let y = y0; y <= y1; y++) {
        put(x0 + k, y);
        put(x1 - k, y);
      }
    }
  }
}

const MAGENTA = /** @type {const} */ ([255, 0, 255]);
const OUTLINE = /** @type {[number, number, number]} */ ([255, 0, 170]);
const OUTLINE_ON_DIFF = /** @type {[number, number, number]} */ ([0, 229, 255]);

/** @param {Buffer} buf */
export const readPng = (buf) => PNG.sync.read(buf);

/**
 * The crops of one packet: their facts, and the PNG bytes to write under `crops/`.
 * @param {{ baseline: PNG, current: PNG, mask: PNG | null, diff: PixelDiff }} images
 * @param {{ pad: number, max: number, scale: 'auto' | number, annotate: boolean }} opts
 * @returns {{ crops: PacketCrop[], files: Map<string, Buffer> }}
 */
export function makeCrops({ baseline, current, mask, diff }, opts) {
  /** @type {PacketCrop[]} */
  const crops = [];
  /** @type {Map<string, Buffer>} */
  const files = new Map();
  const boxes = cropBoxes(diff.regions ?? [], opts, diff.width, diff.height);
  boxes.forEach((b, i) => {
    const n = i + 1;
    const fact = { n, x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0, px: b.px, areas: b.areas };
    const s = scaleFor(fact.w, fact.h, opts.scale);
    if (!s) return crops.push({ ...fact, tooLarge: true });
    /** @param {number} x @param {number} y */
    const changed = (x, y) =>
      !!mask && x < mask.width && y < mask.height && mask.data[(y * mask.width + x) * 4 + 3] > 0;
    const pngs = {
      baseline: cut(baseline, b, s),
      current: cut(current, b, s),
      diff: cut(baseline, b, s, (px, x, y) => {
        if (changed(x, y)) return [...MAGENTA, 255];
        const l = Math.round((0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]) * 0.3);
        return [l, l, l, 255];
      }),
    };
    if (opts.annotate) {
      outline(pngs.baseline, b, s, OUTLINE);
      outline(pngs.current, b, s, OUTLINE);
      outline(pngs.diff, b, s, OUTLINE_ON_DIFF);
    }
    const names = {
      baseline: `crops/${n}.baseline.png`,
      current: `crops/${n}.current.png`,
      diff: `crops/${n}.diff.png`,
    };
    for (const k of /** @type {const} */ (['baseline', 'current', 'diff']))
      files.set(names[k], PNG.sync.write(pngs[k]));
    crops.push({ ...fact, scale: s, files: names });
  });
  return { crops, files };
}
