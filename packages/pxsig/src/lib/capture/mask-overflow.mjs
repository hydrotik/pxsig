/**
 * mask-overflow.mjs — a `data-volatile` element whose content paints outside its box (the
 * `overflow` mask problem). A mask paints its element's box (mask-paint.mjs), never more, so
 * whatever the value paints outside the box would be compared: the check would pass or fail by
 * which value rendered. Measured on the pixels, after the capture's screenshot and text record (so
 * neither is touched), with the masks put back: the frame with every such element's content
 * hidden, then shown again; a pixel outside every painted box that differs is content outside its
 * box. The painted boxes are the pixels the paint covers (masks.mjs `snapRect`: every whole pixel
 * an element's box touches, on the image's grid), so a pixel is weighed exactly when it is not
 * painted. The masks themselves are never changed: what is painted and recorded stays the
 * element's box.
 *
 * Hidden: the element's own text (transparent, no text shadow) and every element inside it
 * (`visibility: hidden`), inline and important, put back after. Its own background, border,
 * outline and shadow stay: they do not depend on the value, except through the box, which "masks
 * changed" weighs. Neither changes layout. Both images are taken after a style change, so
 * Chromium's partial re-raster treats them alike. Only `data-volatile` (a leaf whose content is the
 * value); selector masks may match a container whose overflow is not the value.
 */
import { PNG } from 'pngjs';
import { ATTRIBUTE, MARK, snapRect } from './masks.mjs';
/** @import { Page } from 'playwright' */
/** @import { MeasuredMasks } from './masks.mjs' */

/** A channel may differ by this much and still be the same pixel (the engine's mask tolerance). */
export const TOLERANCE = 8;
/** At most this many elements are tried one by one to name those whose content leaks. */
const NAMED = 20;

/**
 * Hide the content of the elements at `at` among the painted `data-volatile` elements (all when
 * null), or show it again (`at` undefined).
 * @param {Page} page
 * @param {number[] | null} [at]
 */
const hide = (page, at) =>
  page.evaluate(
    ({ sel, at }) => {
      /** @type {Window & { __pxsigShow?: () => void }} */
      const w = window;
      w.__pxsigShow?.();
      delete w.__pxsigShow;
      if (at === undefined) return;
      /** @type {(() => void)[]} */
      const undo = [];
      /** @param {HTMLElement} el @param {string} p @param {string} v */
      const set = (el, p, v) => {
        const was = el.style.getPropertyValue(p);
        const pr = el.style.getPropertyPriority(p);
        el.style.setProperty(p, v, 'important');
        undo.push(() => (was ? el.style.setProperty(p, was, pr) : el.style.removeProperty(p)));
      };
      const els = [...document.querySelectorAll(sel)];
      for (const [i, el] of els.entries()) {
        if ((at && !at.includes(i)) || !(el instanceof HTMLElement)) continue;
        set(el, 'color', 'transparent');
        set(el, '-webkit-text-fill-color', 'transparent');
        set(el, 'text-shadow', 'none');
        for (const c of el.querySelectorAll('*'))
          if (c instanceof HTMLElement || c instanceof SVGElement)
            set(/** @type {HTMLElement} */ (c), 'visibility', 'hidden');
      }
      w.__pxsigShow = () => undo.reverse().forEach((u) => u());
    },
    { sel: `[${ATTRIBUTE}][${MARK}]`, at }
  );

/**
 * Pixels outside `boxes` (whole pixels: one a box touches at all is inside) where `a` and `b`
 * differ by more than `TOLERANCE` in a channel, and how far the farthest is from the nearest box.
 * @param {Buffer} a
 * @param {Buffer} b
 * @param {number[][]} boxes CSS px, in the frame (the capture passes the painted pixels: masks.mjs `snapRect`)
 * @param {number} scale image pixels per CSS px
 */
export function outside(a, b, boxes, scale) {
  const A = PNG.sync.read(a);
  const B = PNG.sync.read(b);
  if (A.width !== B.width || A.height !== B.height) return { px: 0, past: 0 };
  const px = boxes.map((r) => [
    Math.floor(r[0] * scale),
    Math.floor(r[1] * scale),
    Math.ceil(r[2] * scale),
    Math.ceil(r[3] * scale),
  ]);
  let n = 0;
  let past = 0;
  for (let y = 0; y < A.height; y++)
    for (let x = 0; x < A.width; x++) {
      const i = (y * A.width + x) * 4;
      let d = 0;
      for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(A.data[i + k] - B.data[i + k]));
      if (d <= TOLERANCE) continue;
      if (px.some((r) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3])) continue;
      n++;
      const far = Math.min(
        ...px.map((r) => Math.max(r[0] - x, x + 1 - r[2], 0, r[1] - y, y + 1 - r[3]))
      );
      past = Math.max(past, far);
    }
  return { px: n, past: Math.ceil(past / scale) };
}

/**
 * Add an `overflow` problem to `measured` for each painted `data-volatile` element whose content
 * paints outside its box. Run after the capture's screenshot and `unpaintMasks`, while the marks
 * `measureMasks` set are still there, and before `writeMasks`; `shoot` takes the capture's
 * screenshot (the element's or the page's), on the grid `measureMasks` measured on.
 * @param {Page} page
 * @param {MeasuredMasks} measured
 * @param {() => Promise<Buffer>} shoot
 */
export async function overflowMasks(page, measured, shoot) {
  if (!measured.applied.some((m) => m.source === 'attribute')) return;
  const { grid } = measured;
  const info = await page.evaluate(
    ({ sel, mark, attr }) => {
      /** @param {Element} el */
      const name = (el) => {
        const cls = [...el.classList]
          .slice(0, 2)
          .map((c) => `.${c}`)
          .join('');
        const v = el.getAttribute(attr);
        return `${el.localName}${el.id ? `#${el.id}` : ''}${cls}[${attr}${v ? `="${v}"` : ''}]`.slice(
          0,
          120
        );
      };
      return {
        // Every element a mask paints, as it is painted (mask-paint.mjs): each client rect, or
        // for one painted over everything, its box. Content under any of them is masked.
        boxes: [...document.querySelectorAll(`[${mark}]`)].flatMap((el) =>
          (el.getAttribute(mark) === 'over'
            ? [el.getBoundingClientRect()]
            : [...el.getClientRects()]
          )
            .filter((r) => r.width > 0 && r.height > 0)
            .map((r) => [r.left, r.top, r.right, r.bottom])
        ),
        names: [...document.querySelectorAll(sel)].map(name),
      };
    },
    { sel: `[${ATTRIBUTE}][${MARK}]`, mark: MARK, attr: ATTRIBUTE }
  );
  if (!info.names.length) return;
  const boxes = info.boxes.map((r) => snapRect(r, grid));
  /** @param {number[] | null} at */
  const leak = async (at) => {
    try {
      await hide(page, at);
      const hidden = await shoot();
      await hide(page);
      const shown = await shoot();
      const scale = grid.width ? PNG.sync.read(shown).width / grid.width : 1;
      return outside(hidden, shown, boxes, scale);
    } finally {
      await hide(page);
    }
  };
  const all = await leak(null);
  if (!all.px) return;
  const named = [];
  for (const [i, n] of info.names.slice(0, NAMED).entries()) {
    const one = info.names.length === 1 ? all : await leak([i]);
    if (one.px) named.push(`${n}: ${one.px} px outside, up to ${one.past} px past its box`);
  }
  if (!named.length || info.names.length > NAMED)
    named.push(`${info.names.length} data-volatile elements: ${all.px} px outside their boxes`);
  for (const element of named) measured.problems.push({ kind: 'overflow', element });
}
