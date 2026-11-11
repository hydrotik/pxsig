/**
 * Masks (lib/capture/render.mjs): what a capture paints over, where each mask comes from, and the
 * record of the masks that applied, `<id>.masks.json` beside `<id>.png`.
 *
 * Sources, in this order (a selector counts once, from its first source):
 *   attribute  every element with `data-volatile`, in every project; its value is the reason
 *   story      the entry's `ignore` (parameters.pxsig.ignore)
 *   project    `capture.ignore` / `capture.addIgnore` in pxsig.config.json
 *   workspace  the same keys in the workspace file's `defaults`
 *
 * A mask paints the inside of each element's box, so the box itself (its size, its position) is
 * still compared. Text under a mask is left out of the text record; the a11y pass still sees it.
 * The record names selectors, sources, reasons and pixel counts: never a path.
 */
import { rmSync, writeFileSync } from 'node:fs';
/** @import { Page, PageScreenshotOptions } from 'playwright' */
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
/** @typedef {Mask & { reason?: string, count: number, px: number, rects: Rect[] }} AppliedMask */

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

/** At most this many boxes are counted per mask (the overlap count is quadratic in them). */
const MAX_BOXES = 500;

/**
 * A value as a CSS string, for an attribute selector.
 * @param {string} v
 */
const cssString = (v) => `"${v.replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ')}"`;

/**
 * Which masks apply to the page as it is about to be captured: each mask's elements, grouped by
 * the attribute's value for `data-volatile`, with the pixels their boxes cover inside the frame
 * (`frame`, the captured element's box; null: the viewport). A mask with no pixel there does not
 * apply. An invalid selector throws, as the screenshot's mask would.
 * @param {Page} page
 * @param {Mask[]} masks
 * @param {{ x: number, y: number, width: number, height: number } | null} frame
 * @returns {Promise<{ applied: AppliedMask[], selectors: string[] }>}
 */
export async function measureMasks(page, masks, frame) {
  const vp = page.viewportSize() ?? { width: 0, height: 0 };
  const f = frame ?? { x: 0, y: 0, width: vp.width, height: vp.height };
  const clip = (/** @type {number} */ v, /** @type {number} */ max) =>
    Math.min(max, Math.max(0, Math.round(v)));
  /** @type {AppliedMask[]} */
  const applied = [];
  for (const m of masks) {
    const found = await page.locator(m.selector).evaluateAll(
      (els, attr) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { v: el.getAttribute(attr), r: [r.left, r.top, r.right, r.bottom] };
        }),
      ATTRIBUTE
    );
    /** @type {Map<string, Rect[]>} */
    const groups = new Map();
    for (const { v, r } of found) {
      const key = m.source === 'attribute' ? (v ?? '') : '';
      const rect = /** @type {Rect} */ ([
        clip(r[0] - f.x, f.width),
        clip(r[1] - f.y, f.height),
        clip(r[2] - f.x, f.width),
        clip(r[3] - f.y, f.height),
      ]);
      groups.set(key, [...(groups.get(key) ?? []), rect]);
    }
    for (const [v, rects] of groups) {
      const kept = rects.filter((r) => r[2] > r[0] && r[3] > r[1]).slice(0, MAX_BOXES);
      const px = unionPx(kept);
      if (!px) continue;
      const reason = v.trim();
      applied.push({
        selector: v ? `[${ATTRIBUTE}=${cssString(v)}]` : m.selector,
        source: m.source,
        ...(reason ? { reason } : {}),
        count: rects.length,
        px,
        rects: kept,
      });
    }
  }
  return { applied, selectors: masks.map((m) => m.selector) };
}

/**
 * The screenshot's mask options for the masks that apply; none when nothing does.
 * @param {Page} page
 * @param {{ applied: AppliedMask[] }} masks
 * @returns {Pick<PageScreenshotOptions, 'mask' | 'maskColor'>}
 */
export const maskShot = (page, { applied }) =>
  applied.length
    ? { mask: applied.map((m) => page.locator(m.selector)), maskColor: '#FF00FF' }
    : {};

/**
 * Write the record of the masks that applied beside `png` (version 1); none when nothing applied,
 * and never an earlier render's.
 * @param {string} png
 * @param {{ applied: AppliedMask[] }} masks
 */
export function writeMasks(png, { applied }) {
  const file = masksFile(png);
  rmSync(file, { force: true });
  if (applied.length) writeFileSync(file, JSON.stringify({ v: 1, masks: applied }));
}
