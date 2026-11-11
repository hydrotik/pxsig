/**
 * mask-measure.mjs — the masks of a capture as it is about to be taken (lib/capture/render.mjs):
 * which apply, what each covers inside the frame, which elements to paint (mask-paint.mjs), and
 * what may not be masked as asked. The record of it is masks.mjs `writeMasks`.
 */
import { ATTRIBUTE, MARK, OVERLAY, unionPx } from './masks.mjs';
import { unmarkMasks } from './mask-paint.mjs';
/** @import { Page } from 'playwright' */
/** @import { AppliedMask, Mask, MaskProblem, MeasuredMasks, Rect } from './masks.mjs' */

/** At most this many boxes are counted per mask (the overlap count is quadratic in them). */
const MAX_BOXES = 500;

/**
 * What a `data-volatile` element may contain: text and these inline formatting elements only. Any
 * other element child makes it a container, which the attribute may not mark.
 */
export const INLINE = [
  'span',
  'b',
  'i',
  'em',
  'strong',
  'code',
  'time',
  'abbr',
  'sub',
  'sup',
  'small',
  'mark',
  'br',
  'wbr',
];

/**
 * A value as a CSS string, for an attribute selector.
 * @param {string} v
 */
const cssString = (v) => `"${v.replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ')}"`;

/**
 * Each element a selector matches, in the page: its attribute value, its box, the elements inside
 * it that are not inline formatting (open shadow roots included), whether it covers the story root
 * (it is the root, or holds it, or is the root's whole content: every element from the root down
 * to it is its parent's only element, with no text beside it), and a short name for it.
 * @param {Element[]} els
 * @param {{ attr: string, root: string, inline: string[] }} o
 */
function inPage(els, { attr, root, inline }) {
  const top = document.querySelector(root);
  /** @param {Element | ShadowRoot} n @returns {string[]} */
  const others = (n) =>
    [...n.querySelectorAll('*')].flatMap((c) => [
      ...(inline.includes(c.localName) ? [] : [c.localName]),
      ...(c.shadowRoot ? others(c.shadowRoot) : []),
    ]);
  /** @param {Element} el */
  const coversRoot = (el) => {
    if (!top) return false;
    if (el === top || el.contains(top)) return true;
    if (!top.contains(el)) return false;
    for (let n = el; n !== top;) {
      const p = /** @type {Element} */ (n.parentElement);
      const text = [...p.childNodes].some((c) => c.nodeType === 3 && c.textContent?.trim());
      if (p.children.length !== 1 || text) return false;
      n = p;
    }
    return true;
  };
  /** @param {Element} el */
  const name = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = [...el.classList]
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join('');
    const v = el.getAttribute(attr);
    const a = v == null ? '' : `[${attr}${v ? `="${v}"` : ''}]`;
    return `${el.localName}${id}${cls}${a}`.slice(0, 120);
  };
  return els.map((el) => {
    const r = el.getBoundingClientRect();
    return {
      v: el.getAttribute(attr),
      r: [r.left, r.top, r.right, r.bottom],
      bad: [...new Set([...others(el), ...(el.shadowRoot ? others(el.shadowRoot) : [])])],
      root: coversRoot(el),
      name: name(el),
    };
  });
}

/**
 * Which masks apply to the page as it is about to be captured: each mask's elements, grouped by
 * the attribute's value for `data-volatile`, with the pixels their boxes cover inside the frame
 * (`frame`, the captured element's box; null: the viewport). A mask with no pixel there does not
 * apply. Each element that applies is marked for painting (mask-paint.mjs `MARK`): only what was
 * measured is ever painted. What may not be masked is a problem instead, and is never painted:
 *   container   a `data-volatile` element with element children other than `INLINE` ones
 *   reason      a `data-volatile` element with no reason (an empty value)
 *   unmeasured  a mask on more than `MAX_BOXES` elements (the rest would go unweighed)
 * An invalid selector throws, as the screenshot's mask would.
 * @param {Page} page
 * @param {Mask[]} masks
 * @param {{ x: number, y: number, width: number, height: number } | null} frame
 * @param {string} [root] the capture's root (the story root, or the entry's target)
 * @returns {Promise<MeasuredMasks>}
 */
export async function measureMasks(page, masks, frame, root = '#storybook-root') {
  const vp = page.viewportSize() ?? { width: 0, height: 0 };
  const f = frame ?? { x: 0, y: 0, width: vp.width, height: vp.height };
  const clip = (/** @type {number} */ v, /** @type {number} */ max) =>
    Math.min(max, Math.max(0, Math.round(v)));
  /** @type {AppliedMask[]} */
  const applied = [];
  /** @type {MaskProblem[]} */
  const problems = [];
  /** @type {number[]} */
  const counts = [];
  // A page can show the next story without a reload: no mark of an earlier capture is painted.
  await unmarkMasks(page);
  for (const m of masks) {
    const loc = page.locator(m.selector);
    const found = await loc.evaluateAll(inPage, { attr: ATTRIBUTE, root, inline: INLINE });
    counts.push(found.length);
    /** @type {Map<string, { rects: Rect[], at: number[], root: boolean }>} */
    const groups = new Map();
    for (const [i, { v, r, bad, root: atRoot, name }] of found.entries()) {
      const rect = /** @type {Rect} */ ([
        clip(r[0] - f.x, f.width),
        clip(r[1] - f.y, f.height),
        clip(r[2] - f.x, f.width),
        clip(r[3] - f.y, f.height),
      ]);
      const shows = rect[2] > rect[0] && rect[3] > rect[1];
      if (m.source === 'attribute' && shows && bad.length) {
        problems.push({
          kind: 'container',
          element: `${name}: element children ${bad.join(', ')}`,
        });
        continue;
      }
      if (m.source === 'attribute' && shows && !v?.trim()) {
        problems.push({ kind: 'reason', element: name });
        continue;
      }
      const key = m.source === 'attribute' ? (v ?? '') : '';
      const g = groups.get(key) ?? { rects: [], at: [], root: false };
      g.rects.push(rect);
      if (shows) g.at.push(i);
      g.root ||= shows && atRoot;
      groups.set(key, g);
    }
    for (const [v, g] of groups) {
      const kept = g.rects.filter((r) => r[2] > r[0] && r[3] > r[1]);
      if (kept.length > MAX_BOXES)
        problems.push({
          kind: 'unmeasured',
          element: `${m.selector}: ${kept.length} elements, over ${MAX_BOXES}`,
        });
      const rects = kept.slice(0, MAX_BOXES);
      const px = unionPx(rects);
      if (!px) continue;
      const reason = v.trim();
      applied.push({
        selector: v ? `[${ATTRIBUTE}=${cssString(v)}]` : m.selector,
        source: m.source,
        ...(reason ? { reason } : {}),
        count: g.rects.length,
        px,
        rects,
        ...(g.root ? { root: /** @type {const} */ (true) } : {}),
      });
      // Only what was measured is painted (mask-paint.mjs).
      await loc.evaluateAll(
        (els, { at, mark }) => at.forEach((i) => els[i]?.setAttribute(mark, 'self')),
        { at: g.at.slice(0, MAX_BOXES), mark: MARK }
      );
    }
  }
  return { applied, problems, masks, counts };
}

/**
 * Elements a mask matches at the screenshot that it did not when it was measured (they appeared
 * since): a problem each, so the entry fails instead of being captured beside a mask that never
 * weighed them. The boxes the paint added are not the page's elements.
 * @param {Page} page
 * @param {MeasuredMasks} measured
 */
export async function lateMasks(page, measured) {
  for (const [i, m] of measured.masks.entries()) {
    const now = await page
      .locator(m.selector)
      .evaluateAll((els, box) => els.filter((e) => !e.hasAttribute(box)).length, OVERLAY);
    if (now > measured.counts[i])
      measured.problems.push({
        kind: 'unmeasured',
        element: `${m.selector}: ${now} matched at the screenshot, ${measured.counts[i]} measured`,
      });
  }
}
