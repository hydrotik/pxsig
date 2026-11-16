/**
 * Masks (lib/capture/render.mjs): what a capture paints over, where each mask comes from, and the
 * record of the masks that applied, `<id>.masks.json` beside `<id>.png`. Measuring them as the
 * capture is taken: mask-measure.mjs; painting them: mask-paint.mjs.
 *
 * Sources, in this order (a selector counts once, from its first source):
 *   attribute  every element with `data-volatile`, in every project; its value is the reason
 *   story      the entry's `ignore` (parameters.pxsig.ignore)
 *   project    `capture.ignore` / `capture.addIgnore` in pxsig.config.json
 *   workspace  the same keys in the workspace file's `defaults`
 *
 * A mask paints the inside of each element's box, at the element's own place in the paint order
 * (mask-paint.mjs), so the box itself (its size, its position) and whatever sits above it are still
 * compared. `data-volatile` marks a leaf only (text and `INLINE` formatting), with a reason. Text
 * under a painted mask is left out of the text record; the a11y pass still sees it. The record
 * names selectors, sources, reasons, pixel counts and short element names: never a path.
 */
import { rmSync, writeFileSync } from 'node:fs';
/** @import { RenderEntry } from '../../types/t4.js' */

/** The attribute a component sets on an element whose content varies from run to run. */
export const ATTRIBUTE = 'data-volatile';
/** Where a mask comes from. */
/** @typedef {'attribute' | 'story' | 'project' | 'workspace'} MaskSource */
/** A mask to apply: a selector and its source. */
/** @typedef {{ selector: string, source: MaskSource }} Mask */
/** A box, `[x0, y0, x1, y1]` in CSS px. */
/** @typedef {[number, number, number, number]} Rect */
/**
 * A mask that applied to a render: its elements (`count`), its boxes inside the frame (`rects`)
 * and the pixels they cover (`px`). The engine counts `rects` again inside the trimmed PNG, so a
 * mask's area is its share of the image that is compared.
 */
/** @typedef {Mask & { reason?: string, count: number, px: number, rects: Rect[], root?: true }} AppliedMask */
/** What may not be masked as asked (the engine fails the entry with it, and writes no baseline). */
/** @typedef {{ kind: 'container' | 'reason' | 'unmeasured' | 'overflow', element: string }} MaskProblem */
/**
 * A capture's masks: those that apply, the problems found, and each mask asked for with the
 * number of elements it matched when measured.
 */
/** @typedef {{ applied: AppliedMask[], problems: MaskProblem[], masks: Mask[], counts: number[], grid: Grid }} MeasuredMasks */
/**
 * The captured image's pixel grid, in the viewport's CSS px: where its first pixel starts and how
 * many CSS px it spans. Masks are measured, painted and weighed on it (`pixelGrid`, `snapRect`).
 */
/** @typedef {{ x: number, y: number, width: number, height: number }} Grid */

/**
 * The capture's masks file beside `png`.
 * @param {string} png
 */
export const masksFile = (png) => png.replace(/\.png$/i, '.masks.json');

/**
 * The config masks across layers, lowest first: `capture.ignore` replaces the list inherited from
 * the layers below (as arrays do), `capture.addIgnore` adds to it. Each selector keeps its layer.
 * Throws when either key is not an array of selectors.
 * @param {{ source: 'project' | 'workspace', value: unknown }[]} layers
 * @returns {Mask[]}
 */
export function configMasks(layers) {
  /** @type {Mask[]} */
  let out = [];
  for (const { source, value } of layers) {
    const c = /** @type {{ capture?: Record<string, unknown> } | null} */ (value)?.capture;
    if (!c || typeof c !== 'object') continue;
    /** @param {string} key */
    const list = (key) => {
      const v = c[key];
      if (v === undefined) return null;
      if (!Array.isArray(v) || v.some((s) => typeof s !== 'string' || !s.trim()))
        throw new Error(`capture.${key} must be an array of selectors`);
      return /** @type {string[]} */ (v).map((selector) => ({ selector, source }));
    };
    out = list('ignore') ?? out;
    out = [...out, ...(list('addIgnore') ?? [])];
  }
  return out;
}

/**
 * The masks to apply to an entry: the attribute, the story's, then the project's (`P.masks`, from
 * the config layers; a bare `{ config }` reads its `capture` as the project's).
 * @param {unknown} project the render's `project` option
 * @param {Pick<RenderEntry, 'ignore'>} e
 * @returns {Mask[]}
 */
export function masksFor(project, e) {
  const p = /** @type {{ masks?: Mask[], config?: unknown } | null | undefined} */ (project);
  const config = p?.masks ?? configMasks([{ source: 'project', value: p?.config }]);
  /** @type {Mask[]} */
  const all = [
    { selector: `[${ATTRIBUTE}]`, source: 'attribute' },
    ...(e.ignore ?? []).map((selector) => ({ selector, source: /** @type {const} */ ('story') })),
    ...config,
  ];
  const seen = new Set();
  return all.filter((m) => !seen.has(m.selector) && seen.add(m.selector));
}

/**
 * Pixels covered by `rects` (whole pixels, inside the frame), counted once where they overlap.
 * @param {Rect[]} rects
 */
export function unionPx(rects) {
  const xs = [...new Set(rects.flatMap((r) => [r[0], r[2]]))].sort((a, b) => a - b);
  let px = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const spans = rects
      .filter((r) => r[0] <= xs[i] && r[2] >= xs[i + 1])
      .map((r) => [r[1], r[3]])
      .sort((a, b) => a[0] - b[0]);
    let cover = 0;
    let end = -Infinity;
    for (const [y0, y1] of spans) {
      if (y1 <= end) continue;
      cover += y1 - Math.max(y0, end);
      end = y1;
    }
    px += cover * (xs[i + 1] - xs[i]);
  }
  return px;
}

/**
 * The pixel grid of a capture of `box` (the captured element's box in the viewport; null: the
 * viewport). Playwright clips an element's screenshot to the whole CSS px around its box, counted
 * in the document (`scroll`), so the image starts at the floor of the box's left and top, not at
 * the box itself, and ends at the ceiling of its right and bottom (measured: a box at x = 8.5 gives
 * an image whose first pixel is x = 8).
 * @param {{ x: number, y: number, width: number, height: number } | null} box
 * @param {{ width: number, height: number }} viewport
 * @param {{ x: number, y: number }} [scroll]
 * @returns {Grid}
 */
export function pixelGrid(box, viewport, scroll = { x: 0, y: 0 }) {
  if (!box) return { x: 0, y: 0, width: viewport.width, height: viewport.height };
  // Playwright's own rounding of the clip (its 1e-3 keeps a float error from adding a pixel).
  const x = Math.floor(box.x + scroll.x + 1e-3);
  const y = Math.floor(box.y + scroll.y + 1e-3);
  const width = Math.ceil(box.x + scroll.x + box.width - 1e-3) - x;
  const height = Math.ceil(box.y + scroll.y + box.height - 1e-3) - y;
  return { x: x - scroll.x, y: y - scroll.y, width, height };
}

/**
 * The pixels a mask covers: every whole pixel its box `r` touches (`[left, top, right, bottom]`
 * in the viewport's CSS px), on the image's grid `g`: the left and top edges floored, the right and
 * bottom ceiled, then clipped to the image. Never a pixel the box does not touch, and never less
 * than one it does. The record, the paint (mask-paint.mjs) and the overflow check
 * (mask-overflow.mjs) all use it, so what is recorded is what is painted and what is weighed.
 * @param {ArrayLike<number>} r
 * @param {Grid} g
 * @returns {Rect}
 */
export function snapRect(r, g) {
  const clip = (/** @type {number} */ v, /** @type {number} */ max) =>
    Math.min(max, Math.max(0, v));
  // A box with no width or height touches no pixel, wherever it lies.
  if (!(r[2] > r[0] && r[3] > r[1])) {
    const x = clip(Math.floor(r[0] - g.x), g.width);
    const y = clip(Math.floor(r[1] - g.y), g.height);
    return [x, y, x, y];
  }
  return [
    clip(Math.floor(r[0] - g.x), g.width),
    clip(Math.floor(r[1] - g.y), g.height),
    clip(Math.ceil(r[2] - g.x), g.width),
    clip(Math.ceil(r[3] - g.y), g.height),
  ];
}

/** The attribute on each element a mask paints (`self` or `over`: lib/capture/mask-paint.mjs). */
export const MARK = 'data-pxsig-masked';
/** The attribute on each box the paint adds. */
export const OVERLAY = 'data-pxsig-mask-box';
/** The mask colour (the engine's trim and its check of older baselines read it: crates/pxsig-cli). */
export const COLOR = '#FF00FF';
/** What the text record leaves out: only the elements a mask painted. */
export const MASKED = `[${MARK}]`;

/**
 * Write the record of the masks that applied beside `png` (version 1), with the problems found;
 * none when there is neither, and never an earlier render's.
 * @param {string} png
 * @param {Pick<MeasuredMasks, 'applied' | 'problems'>} masks
 */
export function writeMasks(png, { applied, problems }) {
  const file = masksFile(png);
  rmSync(file, { force: true });
  if (applied.length || problems.length)
    writeFileSync(
      file,
      JSON.stringify({ v: 1, masks: applied, ...(problems.length ? { problems } : {}) })
    );
}
