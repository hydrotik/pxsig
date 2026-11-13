/**
 * lib/gate-report/image.mjs — the gate report's one image: the baseline, the render and the diff
 * side by side in a single PNG, cropped to the changed regions with a small margin (or the full
 * capture), so one paste into an issue carries all three. And, for the image-free report, each
 * changed region's average colour in the baseline and in the render.
 *
 * The regions are the engine's `diff` (crates/pxsig-core/src/pixeldiff.rs), as the rejection
 * packet's crops use them (lib/rejections/crops.mjs). The diff panel is the baseline at 30%
 * luminance with the changed pixels in magenta. A crop is upscaled by an integer (nearest
 * neighbour) so a small change stays visible; the full capture is never scaled.
 */
import { PNG } from 'pngjs';
import { scaleFor } from '../rejections/crops.mjs';
/** @import { PixelDiff } from '../../types/rejections.js' */

/** The margin around the changed regions, in px of the capture. */
export const MARGIN = 16;
/** The gap between the three panels, in px of the composite. */
const GAP = 8;
const GAP_RGBA = /** @type {const} */ ([40, 40, 40, 255]);
/** A pixel outside an image (the baseline and the render may differ in size). */
const OUTSIDE = /** @type {const} */ ([128, 128, 128, 255]);
const MAGENTA = /** @type {const} */ ([255, 0, 255, 255]);
/** Regions listed, largest first: the rest are counted, not listed. */
export const MAX_REGIONS = 20;

/** @typedef {{ x: number, y: number, w: number, h: number }} Box */
/** @typedef {PixelDiff['regions'][number]} Region */

/**
 * The box around every changed region, `margin` wider on each side and clamped to the capture;
 * null when nothing changed.
 * @param {Region[]} regions
 * @param {number} W
 * @param {number} H
 * @param {number} [margin]
 * @returns {Box | null}
 */
export function cropBox(regions, W, H, margin = MARGIN) {
  if (!regions.length || W <= 0 || H <= 0) return null;
  const x0 = Math.max(0, Math.min(...regions.map((r) => r.x)) - margin);
  const y0 = Math.max(0, Math.min(...regions.map((r) => r.y)) - margin);
  const x1 = Math.min(W, Math.max(...regions.map((r) => r.x + r.w)) + margin);
  const y1 = Math.min(H, Math.max(...regions.map((r) => r.y + r.h)) + margin);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * The largest regions first, at most MAX_REGIONS.
 * @param {Region[]} regions
 */
export const topRegions = (regions) =>
  [...regions].sort((a, b) => b.px - a.px || a.y - b.y || a.x - b.x).slice(0, MAX_REGIONS);

/**
 * @param {PNG} img
 * @param {number} x
 * @param {number} y
 * @returns {[number, number, number, number]}
 */
const px = (img, x, y) => {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return [...OUTSIDE];
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
};

/**
 * @param {PNG | null} mask
 * @param {number} x
 * @param {number} y
 */
const changedAt = (mask, x, y) =>
  !!mask && x < mask.width && y < mask.height && mask.data[(y * mask.width + x) * 4 + 3] > 0;

/**
 * The composite: baseline | render | diff, each the `box` of the capture upscaled by `scale`.
 * @param {{ baseline: PNG, current: PNG, mask: PNG | null }} images
 * @param {Box} box
 * @param {number} scale
 * @returns {{ png: Buffer, width: number, height: number }}
 */
export function composite({ baseline, current, mask }, box, scale) {
  const pw = box.w * scale;
  const ph = box.h * scale;
  const width = pw * 3 + GAP * 2;
  const out = new PNG({ width, height: ph });
  for (let y = 0; y < ph; y++)
    for (let x = 0; x < width; x++) out.data.set(GAP_RGBA, (y * width + x) * 4);
  /** @type {((x: number, y: number) => readonly number[])[]} */
  const panels = [
    (x, y) => px(baseline, x, y),
    (x, y) => px(current, x, y),
    (x, y) => {
      if (changedAt(mask, x, y)) return MAGENTA;
      const [r, g, b] = px(baseline, x, y);
      const l = Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b) * 0.3);
      return [l, l, l, 255];
    },
  ];
  panels.forEach((at, p) => {
    const left = p * (pw + GAP);
    for (let y = 0; y < ph; y++)
      for (let x = 0; x < pw; x++)
        out.data.set(
          at(box.x + Math.floor(x / scale), box.y + Math.floor(y / scale)),
          (y * width + left + x) * 4
        );
  });
  return { png: PNG.sync.write(out), width, height: ph };
}

/**
 * The upscale of a crop: the short side brought to 160px, at most 4×, the long side within
 * 1,024px; 1 for a crop already larger.
 * @param {Box} box
 */
export const cropScale = (box) => scaleFor(box.w, box.h, 'auto') || 1;

/** @param {number[]} rgb */
const hex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/**
 * Each region's average colour in the baseline and in the render, over its changed pixels (over
 * the whole box when the mask marks none), as `#rrggbb`. Alpha is left out.
 * @param {{ baseline: PNG, current: PNG, mask: PNG | null }} images
 * @param {Region[]} regions
 * @returns {{ baseline: string, render: string }[]}
 */
export function regionColours({ baseline, current, mask }, regions) {
  return regions.map((r) => {
    const sum = { baseline: [0, 0, 0], render: [0, 0, 0] };
    let n = 0;
    /** @param {boolean} onlyChanged */
    const add = (onlyChanged) => {
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) {
          if (onlyChanged && !changedAt(mask, x, y)) continue;
          const a = px(baseline, x, y);
          const b = px(current, x, y);
          for (let k = 0; k < 3; k++) {
            sum.baseline[k] += a[k];
            sum.render[k] += b[k];
          }
          n++;
        }
    };
    add(true);
    if (!n) add(false);
    const d = Math.max(1, n);
    return {
      baseline: hex(sum.baseline.map((v) => v / d)),
      render: hex(sum.render.map((v) => v / d)),
    };
  });
}
