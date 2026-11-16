/**
 * mask-paint.mjs — painting the masks of a capture (lib/capture/masks.mjs measures and marks them):
 * only the masked element itself, at its own place in the page's paint order, so whatever sits
 * above it (an open popover, a tooltip) is still captured and compared.
 *
 * Each marked element (`MARK`) gets an opaque `#FF00FF` box over each of its client rects, as its
 * own last child, and `isolation: isolate` (plus `position: relative` when it is static) so the box
 * paints above the element's content and below anything painted after it. Where that cannot be
 * exact (a replaced element, a transform that scales, opacity or a filter on the way up, a static
 * element with offsets or absolutely positioned descendants), the element is marked `over` and
 * painted the way Playwright's `mask` paints: over everything, as before. Never less than the
 * element's box. Everything is put back after the screenshot; the marks stay until the text
 * record has been read, so only text under a painted mask is left out of it.
 *
 * Every box covers each whole pixel the element's box touches on the image's grid (masks.mjs
 * `snapRect`), the pixels the record counts: a box placed at a fractional edge would be painted on
 * the rounded pixel, leaving a part-covered one unpainted. Playwright's `mask` paints the element's
 * own box, so each `over` element also gets a box of pxsig's own at those pixels, in the top layer,
 * above everything, as Playwright's is. An element that clips its own content also clips the box
 * in its place, so a pixel its edge only partly covers stays unpainted: nothing of the element shows
 * there either (its content and background share the clip), so the pixel is stable and compared.
 */

import { COLOR, MARK, OVERLAY } from './masks.mjs';
/** @import { Page, PageScreenshotOptions } from 'playwright' */
/** @import { Grid } from './masks.mjs' */

/**
 * Paint every marked element; the screenshot's options for those marked `over`. `grid` is the
 * image's pixel grid (mask-measure.mjs measured the masks on it).
 * @param {Page} page
 * @param {Grid} grid
 * @returns {Promise<Pick<PageScreenshotOptions, 'mask' | 'maskColor'>>}
 */
export async function paintMasks(page, grid) {
  const marked = page.locator(`[${MARK}]`);
  if (!(await marked.count())) return {};
  const over = await marked.evaluateAll(
    (els, { MARK, OVERLAY, COLOR, grid }) => {
      const REPLACED =
        /^(img|input|textarea|select|button|video|audio|canvas|iframe|object|embed|picture|br|wbr|hr)$/i;
      /** @type {(() => void)[]} */
      const undo = [];
      /** @type {Window & { __pxsigUnpaint?: () => void }} */ (window).__pxsigUnpaint = () => {
        for (const u of undo.reverse()) u();
      };
      /** @param {HTMLElement} el @param {string} p */
      const keep = (el, p) => {
        const v = el.style.getPropertyValue(p);
        const pr = el.style.getPropertyPriority(p);
        undo.push(() => (v ? el.style.setProperty(p, v, pr) : el.style.removeProperty(p)));
      };
      /**
       * Every whole pixel a box touches, on the image's grid, in the viewport (masks.mjs
       * `snapRect`, not clipped: what lies outside the image is not captured).
       * @param {DOMRectReadOnly} b
       */
      const snap = (b) => {
        const l = grid.x + Math.floor(b.left - grid.x);
        const t = grid.y + Math.floor(b.top - grid.y);
        return {
          l,
          t,
          w: grid.x + Math.ceil(b.right - grid.x) - l,
          h: grid.y + Math.ceil(b.bottom - grid.y) - t,
        };
      };
      /** The box lands on `s`, within half a pixel on each side. @param {DOMRect} r @param {ReturnType<typeof snap>} s */
      const lands = (r, s) =>
        [r.left - s.l, r.top - s.t, r.width - s.w, r.height - s.h].every((d) => Math.abs(d) < 0.5);
      /** Inline and important: no rule of the page's can restyle the box. @param {HTMLElement} o @param {Record<string, string>} css */
      const style = (o, css) => {
        for (const [k, v] of Object.entries(css)) o.style.setProperty(k, v, 'important');
      };
      /** Opacity, a filter or a blend on the way up would tint the box. @param {Element} el */
      const tinted = (el) => {
        for (let n = /** @type {Element | null} */ (el); n; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (Number(s.opacity) < 1 || s.filter !== 'none' || s.mixBlendMode !== 'normal')
            return true;
        }
        return false;
      };
      /** @param {HTMLElement} el */
      const paintSelf = (el) => {
        const s = getComputedStyle(el);
        if (s.display === 'contents' || tinted(el)) return false;
        if (s.position === 'static') {
          const offset = ['top', 'right', 'bottom', 'left'].some(
            (k) => s.getPropertyValue(k) !== 'auto'
          );
          const absolute = [...el.querySelectorAll('*')].some((c) =>
            ['absolute', 'fixed'].includes(getComputedStyle(c).position)
          );
          if (offset || absolute) return false;
          keep(el, 'position');
          el.style.setProperty('position', 'relative', 'important');
        }
        keep(el, 'isolation');
        el.style.setProperty('isolation', 'isolate', 'important');
        for (const cr of el.getClientRects()) {
          if (cr.width <= 0 || cr.height <= 0) continue;
          const s = snap(cr);
          const o = document.createElement('div');
          o.setAttribute(OVERLAY, '');
          style(o, {
            all: 'initial',
            position: 'absolute',
            display: 'block',
            left: '0',
            top: '0',
            width: `${s.w}px`,
            height: `${s.h}px`,
            background: COLOR,
            'z-index': '2147483647',
            'pointer-events': 'none',
          });
          el.appendChild(o);
          undo.push(() => o.remove());
          const r0 = o.getBoundingClientRect();
          if (Math.abs(r0.width - s.w) > 0.5 || Math.abs(r0.height - s.h) > 0.5) return false;
          style(o, { left: `${s.l - r0.left}px`, top: `${s.t - r0.top}px` });
          if (!lands(o.getBoundingClientRect(), s)) return false;
        }
        return true;
      };
      /**
       * A box of pxsig's own over an `over` element, in the top layer, above everything (as
       * Playwright's mask is), at every pixel the element's box touches: Playwright's paints the
       * box itself, rounded. Placed in the document, so it stays on the element when the
       * screenshot scrolls it into view.
       * @param {Element} el
       */
      const paintTop = (el) => {
        const b = el.getBoundingClientRect();
        if (b.width <= 0 || b.height <= 0) return;
        const s = snap(b);
        const o = document.createElement('div');
        o.setAttribute(OVERLAY, '');
        o.setAttribute('popover', 'manual');
        style(o, {
          all: 'initial',
          position: 'absolute',
          display: 'block',
          inset: 'auto',
          left: '0',
          top: '0',
          margin: '0',
          width: `${s.w}px`,
          height: `${s.h}px`,
          background: COLOR,
          'z-index': '2147483647',
          'pointer-events': 'none',
        });
        document.documentElement.appendChild(o);
        undo.push(() => o.remove());
        if (typeof o.showPopover === 'function') o.showPopover();
        const r0 = o.getBoundingClientRect();
        style(o, { left: `${s.l - r0.left}px`, top: `${s.t - r0.top}px` });
        // Fail closed: a box that is not where the record says would leave a pixel unpainted.
        if (!lands(o.getBoundingClientRect(), s)) {
          for (const u of undo.splice(0).reverse()) u();
          throw new Error('a mask box over everything did not land on its element');
        }
      };
      let over = 0;
      for (const el of els) {
        const mark = undo.length;
        const ok = el instanceof HTMLElement && !REPLACED.test(el.tagName) && paintSelf(el);
        if (!ok) {
          // Put back what this element got, and paint it over everything instead.
          for (const u of undo.splice(mark).reverse()) u();
          el.setAttribute(MARK, 'over');
          over++;
        }
      }
      for (const el of els) if (el.getAttribute(MARK) === 'over') paintTop(el);
      return over;
    },
    { MARK, OVERLAY, COLOR, grid }
  );
  return over ? { mask: [page.locator(`[${MARK}="over"]`)], maskColor: COLOR } : {};
}

/**
 * Put the page back after the screenshot: the boxes removed, the styles restored. The marks stay.
 * @param {Page} page
 */
export const unpaintMasks = (page) =>
  page.evaluate(() => {
    const w = /** @type {Window & { __pxsigUnpaint?: () => void }} */ (window);
    w.__pxsigUnpaint?.();
    delete w.__pxsigUnpaint;
  });

/**
 * Remove the marks, once the text record has been read.
 * @param {Page} page
 */
export const unmarkMasks = (page) =>
  page
    .locator(`[${MARK}]`)
    .evaluateAll((els, MARK) => els.forEach((el) => el.removeAttribute(MARK)), MARK);
