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
 */

import { COLOR, MARK, OVERLAY } from './masks.mjs';
/** @import { Page, PageScreenshotOptions } from 'playwright' */

/**
 * Paint every marked element; the screenshot's options for those marked `over`.
 * @param {Page} page
 * @returns {Promise<Pick<PageScreenshotOptions, 'mask' | 'maskColor'>>}
 */
export async function paintMasks(page) {
  const marked = page.locator(`[${MARK}]`);
  if (!(await marked.count())) return {};
  const over = await marked.evaluateAll(
    (els, { MARK, OVERLAY, COLOR }) => {
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
          const o = document.createElement('div');
          o.setAttribute(OVERLAY, '');
          // Inline and important: no rule of the page's can restyle the box.
          const css = {
            all: 'initial',
            position: 'absolute',
            display: 'block',
            left: '0',
            top: '0',
          };
          for (const [k, v] of Object.entries({
            ...css,
            width: `${cr.width}px`,
            height: `${cr.height}px`,
            background: COLOR,
            'z-index': '2147483647',
            'pointer-events': 'none',
          }))
            o.style.setProperty(k, v, 'important');
          el.appendChild(o);
          undo.push(() => o.remove());
          const r0 = o.getBoundingClientRect();
          if (Math.abs(r0.width - cr.width) > 0.5 || Math.abs(r0.height - cr.height) > 0.5)
            return false;
          o.style.setProperty('left', `${cr.left - r0.left}px`, 'important');
          o.style.setProperty('top', `${cr.top - r0.top}px`, 'important');
          const r = o.getBoundingClientRect();
          if (Math.abs(r.left - cr.left) > 0.5 || Math.abs(r.top - cr.top) > 0.5) return false;
        }
        return true;
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
      return over;
    },
    { MARK, OVERLAY, COLOR }
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
