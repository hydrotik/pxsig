/**
 * dashboard-check/layout.mjs — the layout findings `pxsig dashboard check` records for each screen
 * (capture.mjs), measured in the page after it renders:
 *
 *   overflow  the page scrolls sideways at a width the dashboard supports (1280 and 900 CSS px)
 *   clipped   content cut off by `overflow: hidden` / `clip`; text truncated on purpose (an
 *             ellipsis, a line clamp) passes when its full text is in a `title` or an `aria-label`
 *   controls  in a row of controls (`role="toolbar"`, `data-toolbar`, `data-control-row`), the
 *             controls on one line differ in height or bottom edge, or the labels of its fields
 *             (`data-toolbar-field`) differ in top edge
 *   edge      text or a control within 2px of a drawn border of the region that frames it
 *   overlap   two controls drawn over each other, or a control covered by another one
 *
 * The rules follow the design system's own layout checks (controls in one row share one size and
 * one line; content clears its frame), written for any adapter: they read roles and the box
 * model, not an adapter's class names. An element opts out with `data-layout-allow="<reason>"`.
 *
 * `inspectLayout` and `pageOverflow` run in the page (`page.evaluate`), so each is self-contained.
 */
/** @import { LayoutFinding } from '../types/t4.js' */

/** The narrower width the overflow rule also measures. */
export const NARROW_WIDTH = 900;
/** At most this many findings per rule and screen; the rest are counted in one more line. */
export const MAX_PER_RULE = 12;

/**
 * Elements that overflow the page sideways at the current width: the outermost ones whose right
 * edge passes it (an element inside a scroller is that scroller's business, not the page's).
 * Self-contained: runs in the page.
 * @returns {LayoutFinding[]}
 */
export function pageOverflow() {
  const doc = document.scrollingElement ?? document.documentElement;
  const width = doc.clientWidth;
  if (doc.scrollWidth <= width + 1) return [];
  const name = (/** @type {Element} */ el) => {
    const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 32);
    const role = el.getAttribute('role');
    return `<${el.tagName.toLowerCase()}${role ? ` role=${role}` : ''}${label ? ` "${label}"` : ''}>`;
  };
  const scrolls = (/** @type {Element} */ el) => {
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement)
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(e).overflowX)) return true;
    return false;
  };
  /** @type {Element[]} */
  const wide = [];
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.right <= width + 1 || r.width < 1 || el.closest('[data-layout-allow]') || scrolls(el))
      continue;
    const parent = el.parentElement;
    if (parent && parent !== document.body && parent.getBoundingClientRect().right > width + 1)
      continue;
    wide.push(el);
  }
  return [
    {
      rule: 'overflow',
      text: `the page scrolls sideways at ${width}px wide (content is ${doc.scrollWidth}px)${wide.length ? `: ${wide.slice(0, 3).map(name).join(', ')}${wide.length > 3 ? ` and ${wide.length - 3} more` : ''}` : ''}`,
    },
  ];
}

/**
 * Every layout finding on the page as it is, but the narrow-width overflow (`pageOverflow` after a
 * resize). Self-contained: runs in the page.
 * @param {{ max: number }} opts
 * @returns {LayoutFinding[]}
 */
export function inspectLayout({ max }) {
  /** @type {LayoutFinding[]} */
  const out = [];
  const TOL = 0.5;
  const MIN = 2;
  const CONTROL =
    '[data-control], button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="combobox"], [role="tab"], [role="checkbox"], [role="switch"], [role="radio"], [role="menuitem"], [role="link"], [role="slider"]';
  const ROW = '[role="toolbar"], [data-toolbar], [data-control-row]';
  /** @typedef {'top' | 'right' | 'bottom' | 'left'} Side */
  /** @type {Side[]} */
  const SIDES = ['top', 'right', 'bottom', 'left'];
  const px = (/** @type {number} */ n) => `${Math.round(n * 10) / 10}px`;
  const allowed = (/** @type {Element} */ el) => !!el.closest('[data-layout-allow]');
  const visible = (/** @type {Element} */ el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return (
      r.width > 1 &&
      r.height > 1 &&
      cs.visibility !== 'hidden' &&
      cs.opacity !== '0' &&
      !el.closest('[inert], [aria-hidden="true"]')
    );
  };
  const name = (/** @type {Element} */ el) => {
    const input = el instanceof HTMLInputElement ? el : null;
    const by = el.getAttribute('aria-labelledby');
    const label = (
      el.getAttribute('aria-label') ??
      (by ? document.getElementById(by.split(' ')[0])?.textContent : null) ??
      input?.labels?.[0]?.textContent ??
      input?.placeholder ??
      el.textContent ??
      ''
    )
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 32);
    const role = el.getAttribute('role');
    return `<${el.tagName.toLowerCase()}${role ? ` role=${role}` : ''}${label ? ` "${label}"` : ''}>`;
  };
  const transparent = (/** @type {string} */ c) =>
    c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
  /** The outermost visible controls under `root`, not opted out. */
  const controlsIn = (/** @type {Element} */ root) =>
    [...root.querySelectorAll(CONTROL)].filter(
      (el) =>
        visible(el) && !allowed(el) && !(el.parentElement && el.parentElement.closest(CONTROL))
    );

  // --- clipped ---------------------------------------------------------------------------------
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    const clipX = /(hidden|clip)/.test(cs.overflowX);
    const clipY = /(hidden|clip)/.test(cs.overflowY);
    if ((!clipX && !clipY) || !visible(el) || allowed(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const overX = clipX && el.scrollWidth - el.clientWidth > 2;
    const overY = clipY && el.scrollHeight - el.clientHeight > 2;
    if (!overX && !overY) continue;
    // Media panned or zoomed inside a frame (the inspector's stage) is clipped on purpose.
    if (el.querySelector('img, canvas, video, svg[width], [style*="transform"]')) continue;
    const truncated =
      cs.textOverflow === 'ellipsis' ||
      (cs.getPropertyValue('-webkit-line-clamp') || 'none') !== 'none';
    if (truncated) {
      const full = el.closest('[title], [aria-label]');
      if (full) continue;
      out.push({
        rule: 'clipped',
        text: `${name(el)} is truncated with no title or aria-label holding its full text`,
      });
    } else
      out.push({
        rule: 'clipped',
        text: `${name(el)} cuts off its content (${overX ? `${el.scrollWidth - el.clientWidth}px wide` : ''}${overX && overY ? ', ' : ''}${overY ? `${el.scrollHeight - el.clientHeight}px tall` : ''})`,
      });
  }

  // --- controls --------------------------------------------------------------------------------
  document.querySelectorAll(ROW).forEach((row, ri) => {
    const own = (/** @type {Element} */ el) => el.closest(ROW) === row;
    const where = `toolbar ${ri + 1}${row.getAttribute('aria-label') ? ` "${row.getAttribute('aria-label')}"` : ''}`;
    const boxes = controlsIn(row)
      .filter(own)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .sort((a, b) => a.r.top - b.r.top);
    if (boxes.length < 2) return;
    /** @type {{ el: Element, r: DOMRect }[][]} */
    const lines = [];
    let bottom = -Infinity;
    for (const b of boxes) {
      if (lines.length && b.r.top < bottom - TOL) {
        lines[lines.length - 1].push(b);
        bottom = Math.max(bottom, b.r.bottom);
      } else {
        lines.push([b]);
        bottom = b.r.bottom;
      }
    }
    lines.forEach((line, li) => {
      const at = lines.length > 1 ? `${where}, line ${li + 1}` : where;
      const hs = line.map((b) => b.r.height);
      if (Math.max(...hs) - Math.min(...hs) > TOL)
        out.push({
          rule: 'controls',
          text: `${at}: controls differ in height: ${line.map((b) => `${name(b.el)} ${px(b.r.height)}`).join(', ')}`,
        });
      const bs = line.map((b) => b.r.bottom);
      if (Math.max(...bs) - Math.min(...bs) > TOL)
        out.push({
          rule: 'controls',
          text: `${at}: controls are not on one line (bottom edges ${[...new Set(bs.map(px))].join(', ')})`,
        });
    });
    const tops = [...row.querySelectorAll('[data-toolbar-field] > label')]
      .filter((l) => own(l) && visible(l))
      .map((l) => l.getBoundingClientRect().top);
    if (tops.length > 1 && Math.max(...tops) - Math.min(...tops) > TOL)
      out.push({
        rule: 'controls',
        text: `${where}: field labels are not on one line (top edges ${[...new Set(tops.map(px))].join(', ')})`,
      });
  });

  // --- edge ------------------------------------------------------------------------------------
  /** @type {Map<Element, { inner: Record<Side, number>, drawn: Record<Side, boolean> } | null>} */
  const regions = new Map();
  const regionOf = (/** @type {Element} */ el) => {
    if (regions.has(el)) return regions.get(el) ?? null;
    let reg = null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (
      !cs.display.startsWith('inline') &&
      cs.display !== 'contents' &&
      !el.matches(CONTROL) &&
      !allowed(el) &&
      r.width >= 120 &&
      r.height >= 40
    ) {
      const inner = /** @type {Record<Side, number>} */ ({});
      const drawn = /** @type {Record<Side, boolean>} */ ({});
      for (const k of SIDES) {
        const bw = parseFloat(cs.getPropertyValue(`border-${k}-width`)) || 0;
        inner[k] = k === 'top' || k === 'left' ? r[k] + bw : r[k] - bw;
        drawn[k] =
          bw > 0 &&
          cs.getPropertyValue(`border-${k}-style`) !== 'none' &&
          !transparent(cs.getPropertyValue(`border-${k}-color`));
      }
      if (SIDES.some((k) => drawn[k])) reg = { inner, drawn };
    }
    regions.set(el, reg);
    return reg;
  };
  /** @type {{ label: string, el: Element, r: DOMRect, control: boolean }[]} */
  const items = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (!n.textContent?.trim() || !p || !visible(p) || p.closest(CONTROL) || allowed(p)) continue;
    if (p.closest('svg, script, style')) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects())
      if (r.width > 1)
        items.push({ label: `"${n.textContent.trim().slice(0, 30)}"`, el: p, r, control: false });
  }
  for (const c of controlsIn(document.body))
    items.push({ label: name(c), el: c, r: c.getBoundingClientRect(), control: true });
  const seen = new Set();
  for (const it of items) {
    /** @type {Set<Side>} */
    const done = new Set();
    for (
      let a = it.el.parentElement;
      a && a !== document.body && done.size < 4;
      a = a.parentElement
    ) {
      const reg = regionOf(a);
      if (!reg) continue;
      const g = {
        top: it.r.top - reg.inner.top,
        left: it.r.left - reg.inner.left,
        bottom: reg.inner.bottom - it.r.bottom,
        right: reg.inner.right - it.r.right,
      };
      // A control spanning its region on an axis is a full-bleed part of it (a tab, a row).
      if (it.control && ((g.top < MIN && g.bottom < MIN) || (g.left < MIN && g.right < MIN))) break;
      let scrolled = false;
      for (let /** @type {Element | null} */ e = it.el; e && e !== a; e = e.parentElement) {
        const ec = getComputedStyle(e);
        if (/(auto|scroll)/.test(ec.overflowX + ec.overflowY) || ec.transform !== 'none')
          scrolled = true;
        if (ec.textOverflow === 'ellipsis') scrolled = true;
      }
      for (const k of SIDES) {
        if (done.has(k) || !reg.drawn[k]) continue;
        done.add(k);
        // Past the edge is the clipped or overflow rule's; scrolled or panned content passes.
        if (scrolled || g[k] >= MIN - 0.25 || g[k] < -0.25) continue;
        const key = `${it.label}|${k}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          rule: 'edge',
          text: `${it.control ? 'control' : 'text'} ${it.label} is ${px(g[k])} from the ${k} border of its frame (${name(a).slice(0, 48)})`,
        });
      }
    }
  }

  // --- overlap ---------------------------------------------------------------------------------
  const controls = controlsIn(document.body);
  /** @type {Set<Element>} */
  const covered = new Set();
  const pairs = new Set();
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    const hit = document.elementFromPoint(x, y);
    if (!hit || el.contains(hit) || hit.contains(el)) continue;
    const other = hit.closest(CONTROL);
    // Under an overlay (a dialog's backdrop): not reachable, and not this rule's business.
    covered.add(el);
    if (other && controls.includes(other) && !other.contains(el)) {
      pairs.add(`${name(other)}|${name(el)}`);
      out.push({ rule: 'overlap', text: `${name(el)} is covered by ${name(other)}` });
    }
  }
  for (let i = 0; i < controls.length; i++)
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i];
      const b = controls[j];
      if (covered.has(a) || covered.has(b) || a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 1 && h > 1 && !pairs.has(`${name(a)}|${name(b)}`))
        out.push({
          rule: 'overlap',
          text: `${name(a)} and ${name(b)} overlap (${px(w)} × ${px(h)})`,
        });
    }

  // At most `max` per rule: the rest as one count.
  /** @type {Record<string, number>} */
  const per = {};
  /** @type {LayoutFinding[]} */
  const kept = [];
  for (const f of out) {
    per[f.rule] = (per[f.rule] ?? 0) + 1;
    if (per[f.rule] <= max) kept.push(f);
  }
  for (const [rule, n] of Object.entries(per))
    if (n > max)
      kept.push({ rule: /** @type {LayoutFinding['rule']} */ (rule), text: `${n - max} more` });
  return kept;
}
