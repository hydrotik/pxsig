/**
 * dashboard-check/alignment.mjs — two layout rules measured from what renders, not from the styles:
 *
 *   aligned      a dot or an icon is centred on its label's capitals, within ALIGN_TOLERANCE (plus
 *                MEASURE_PRECISION, what the measure can tell apart): the
 *                capitals' ink and the graphic's ink, read from the screenshot (sub-pixel, by
 *                coverage), not their boxes. A label with no capital or digit is not measured.
 *   whole-pixel  a small component that draws an edge (a border, a background, a shadow) has its
 *                top and bottom edges on whole device pixels: off them, the browser snaps its
 *                border, its background and its text each its own way. Along a line a box after
 *                text starts where the text's advances end, fractional in any design system, so
 *                the inline edges are not measured.
 *
 * Each finding names the cause it can see: where a half pixel comes from (centred in an odd space,
 * a fractional margin or padding, an earlier sibling of fractional size), or that a graphic is
 * centred on its line box rather than on the capitals. They are listed beside the layout findings
 * (the screen's `alignment`): advisory, but `--strict` and pxsig's own screens fail on them.
 * `data-layout-allow` opts an element out, as for the other layout rules.
 *
 * `alignmentTargets` runs in the page (`page.evaluate`) and is self-contained; `inkOffsets`
 * (alignment-ink.mjs) reads the screenshot in Node.
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { alignedFinding, inkOffsets } from './alignment-ink.mjs';
export { alignedFinding, inkBand, inkOffsets } from './alignment-ink.mjs';
/** @import { Page } from 'playwright' */
/** @import { LayoutFinding } from '../types/t4.js' */
/** @import { AlignmentPair, AlignmentTargets } from '../types/parity.js' */

/** A dot or icon further than this from its label's capitals' centre is a finding (CSS px). */
export const ALIGN_TOLERANCE = 0.5;
/**
 * How finely the ink measure reads an edge (CSS px): sub-pixel edges come from anti-aliasing,
 * whose coverage is good to about a tenth of a pixel. An offset is a finding only beyond the
 * tolerance by more than this, so a row the layout centres exactly, whose text the browser snaps
 * half a pixel to its baseline, is not one.
 */
export const MEASURE_PRECISION = 0.1;
/** An edge further than this from a whole device pixel is a finding (device px). */
export const EDGE_TOLERANCE = 0.01;
/** The largest graphic measured as a dot or an icon, each way (CSS px). */
export const GRAPHIC_MAX = 16;
/** A component at most this tall and this wide is small (CSS px). */
export const SMALL = Object.freeze({ height: 32, width: 320 });

/**
 * The pairs to measure (a graphic and its label's capitals, by their columns) and the whole-pixel
 * findings, with the cause of each half pixel. Self-contained: runs in the page.
 * @param {{ max: number, graphicMax: number, small: { height: number, width: number }, edgeTolerance: number, within?: string | null }} opts
 *   `within`: a selector; measure only inside what it matches (the parity check's component),
 *   else the whole page
 * @returns {AlignmentTargets}
 */
export function alignmentTargets({ max, graphicMax, small, edgeTolerance, within = null }) {
  const dpr = window.devicePixelRatio || 1;
  const scope = (within ? document.querySelector(within) : null) ?? document.body;
  const modal = document.querySelector('dialog:modal');
  const r1 = (/** @type {number} */ n) => Math.round(n * 100) / 100;
  const frac = (/** @type {number} */ n) => Math.abs(n * dpr - Math.round(n * dpr)) > edgeTolerance;
  const transparent = (/** @type {string} */ c) =>
    c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);
  /** Not under another layer (an overlay, a panel drawn over the page): what is drawn there is it. */
  const uncovered = (/** @type {Element} */ el, /** @type {DOMRect} */ r) => {
    const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
    const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
    const hit = document.elementFromPoint(x, y);
    return !hit || el.contains(hit) || hit.contains(el);
  };
  const shown = (/** @type {Element} */ el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return (
      r.width >= 1 &&
      r.height >= 1 &&
      r.bottom > 0 &&
      r.right > 0 &&
      r.top < innerHeight &&
      r.left < innerWidth &&
      cs.visibility !== 'hidden' &&
      cs.opacity !== '0' &&
      !el.closest('[inert]') &&
      (!modal || modal.contains(el)) &&
      uncovered(el, r)
    );
  };
  const name = (/** @type {Element} */ el) => {
    const label = (el.getAttribute('aria-label') ?? el.textContent ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 32);
    const role = el.getAttribute('role');
    return `<${el.tagName.toLowerCase()}${role ? ` role=${role}` : ''}${label ? ` "${label}"` : ''}>`;
  };
  const num = (/** @type {string} */ v) => parseFloat(v) || 0;
  /**
   * Whether `el` is opted out of `rule`: an ancestor's `data-layout-allow="<reason>"` opts out of
   * every rule, `data-layout-allow="aligned, whole-pixel: <reason>"` out of those named only.
   * @param {Element | null} el
   * @param {string} rule
   */
  const allowedFor = (el, rule) => {
    for (
      let a = el?.closest('[data-layout-allow]');
      a;
      a = a.parentElement?.closest('[data-layout-allow]') ?? null
    ) {
      const m = /^\s*([a-z-]+(?:\s*,\s*[a-z-]+)*)\s*:/.exec(
        a.getAttribute('data-layout-allow') ?? ''
      );
      if (!m || m[1].split(/\s*,\s*/).includes(rule)) return true;
    }
    return false;
  };
  /** The element the last `causeOf` named as the cause (its parent, a sibling, itself). */
  /** @type {Element | null} */
  let culprit = null;
  /**
   * Why `el` is off a whole pixel on `axis`: the nearest element up the tree that is off by itself
   * (its parent is on whole pixels), and what puts it there. Null when nothing up the tree is.
   * @param {Element} el
   * @param {'x' | 'y'} axis
   * @returns {string | null}
   */
  const causeOf = (el, axis) => {
    const start = axis === 'y' ? 'top' : 'left';
    const size = axis === 'y' ? 'height' : 'width';
    const side = axis === 'y' ? ['top', 'bottom'] : ['left', 'right'];
    // The parent that lays it out: a `display: contents` box draws nothing and has no box.
    const up = (/** @type {Element} */ x) => {
      let p = x.parentElement;
      while (p && p !== document.body && getComputedStyle(p).display === 'contents')
        p = p.parentElement;
      return p;
    };
    for (let e = el; e && up(e) && e !== document.body; e = /** @type {Element} */ (up(e))) {
      const p = /** @type {Element} */ (up(e));
      const r = e.getBoundingClientRect();
      const pr = p.getBoundingClientRect();
      if (!frac(r[start])) return null;
      if (frac(pr[start]) && p !== document.body) continue;
      const pcs = getComputedStyle(p);
      const cs = getComputedStyle(e);
      const inner =
        pr[size] -
        num(pcs.getPropertyValue(`border-${side[0]}-width`)) -
        num(pcs.getPropertyValue(`border-${side[1]}-width`)) -
        num(pcs.getPropertyValue(`padding-${side[0]}`)) -
        num(pcs.getPropertyValue(`padding-${side[1]}`));
      const flex = /flex|grid/.test(pcs.display);
      const row = !/column/.test(pcs.flexDirection);
      const cell = axis === 'y' && pcs.display === 'table-cell' && pcs.verticalAlign === 'middle';
      const centred =
        cell ||
        (flex &&
          (axis === 'y'
            ? row
              ? /center/.test(cs.alignSelf === 'auto' ? pcs.alignItems : cs.alignSelf)
              : /center/.test(pcs.justifyContent)
            : row
              ? /center/.test(pcs.justifyContent)
              : /center/.test(cs.alignSelf === 'auto' ? pcs.alignItems : cs.alignSelf)));
      const off = r1(r[start] - pr[start]);
      const where = `${name(e)} at ${off}px in ${name(p)}`;
      culprit = centred || frac(num(pcs.getPropertyValue(`padding-${side[0]}`))) ? p : e;
      if (centred && frac((inner - r[size]) / 2) && !frac(inner - r[size] - 1))
        return `${where}: centred in an odd space, (${r1(inner)} − ${r1(r[size])}) / 2 = ${r1((inner - r[size]) / 2)}`;
      if (centred)
        return `${where}: centred in a ${r1(inner)}px space${frac(inner) ? `, a fractional ${size}` : ''}`;
      const m = /matrix\(([^)]+)\)/.exec(cs.transform);
      const shift = m ? Number(m[1].split(',')[axis === 'y' ? 5 : 4]) : 0;
      if (frac(shift)) return `${where}: its transform moves it ${r1(shift)}px`;
      const margin = num(cs.getPropertyValue(`margin-${side[0]}`));
      if (frac(margin)) return `${where}: its margin-${side[0]} is ${r1(margin)}px`;
      const pad =
        num(pcs.getPropertyValue(`padding-${side[0]}`)) +
        num(pcs.getPropertyValue(`border-${side[0]}-width`));
      if (frac(pad)) return `${where}: its parent's ${side[0]} padding and border are ${r1(pad)}px`;
      // The nearest earlier sibling of fractional size (a gap or margin between is whole).
      for (let prev = e.previousElementSibling; prev; prev = prev.previousElementSibling) {
        const b = prev.getBoundingClientRect();
        if (frac(b[size])) {
          culprit = prev;
          return `${where}: after ${name(prev)}, ${r1(b[size])}px`;
        }
      }
      return `${where}`;
    }
    return null;
  };

  // --- whole-pixel ------------------------------------------------------------------------------
  /** One finding per cause: the components it puts off whole pixels. @type {Map<string, string[]>} */
  const byCause = new Map();
  /** @type {Set<Element>} */
  const half = new Set();
  for (const el of scope.querySelectorAll('*')) {
    if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) continue;
    const r = el.getBoundingClientRect();
    if (r.height > small.height || r.width > small.width || r.height < 2 || r.width < 2) continue;
    const cs = getComputedStyle(el);
    const drawn =
      !transparent(cs.backgroundColor) ||
      cs.backgroundImage !== 'none' ||
      ['top', 'right', 'bottom', 'left'].some(
        (s) =>
          num(cs.getPropertyValue(`border-${s}-width`)) > 0 &&
          cs.getPropertyValue(`border-${s}-style`) !== 'none' &&
          !transparent(cs.getPropertyValue(`border-${s}-color`))
      ) ||
      cs.boxShadow !== 'none';
    if (!drawn || !shown(el)) continue;
    // The block axis only: along a line, a box after text starts where the text's advances end,
    // which is fractional in every design system; across lines, a half pixel is a layout choice.
    const off = [
      ['top', r.top],
      ['bottom', r.bottom],
    ].filter(([, v]) => frac(/** @type {number} */ (v)));
    if (!off.length) continue;
    // The outermost only: a child inherits its parent's half pixel.
    let inside = false;
    for (let a = el.parentElement; a && !inside; a = a.parentElement) inside = half.has(a);
    half.add(el);
    if (inside) continue;
    if (allowedFor(el, 'whole-pixel')) continue;
    culprit = el;
    const cause = causeOf(el, 'y') ?? 'its own size is fractional';
    // A half pixel whose cause is opted out (a design-system component, with its reason) is that
    // component's, not this element's.
    if (allowedFor(culprit, 'whole-pixel')) continue;
    const at = off.map(([s, v]) => `${s} ${r1(/** @type {number} */ (v))}`).join(', ');
    byCause.set(cause, [...(byCause.get(cause) ?? []), `${name(el)} (${at})`]);
  }
  /** @type {LayoutFinding[]} */
  const edges = [...byCause].slice(0, max).map(([cause, els]) => ({
    rule: 'whole-pixel',
    text: `${els.slice(0, 3).join(', ')}${els.length > 3 ? ` and ${els.length - 3} more` : ''} ${els.length === 1 ? 'is' : 'are'} off whole pixels: ${cause}`,
  }));
  if (byCause.size > max)
    edges.push({ rule: 'whole-pixel', text: `and ${byCause.size - max} more causes` });

  // --- aligned: the pairs ------------------------------------------------------------------------
  /** @type {AlignmentPair[]} */
  const pairs = [];
  const graphics = [...scope.querySelectorAll('svg, span, i, div')].filter((g) => {
    if (g instanceof SVGSVGElement && g.parentElement?.closest('svg')) return false;
    const r = g.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.width > graphicMax || r.height > graphicMax) return false;
    if (!(g instanceof SVGSVGElement)) {
      if ((g.textContent ?? '').trim() || g.children.length) return false;
      const cs = getComputedStyle(g);
      if (
        transparent(cs.backgroundColor) &&
        !['top', 'right', 'bottom', 'left'].some(
          (s) => num(cs.getPropertyValue(`border-${s}-width`)) > 0
        )
      )
        return false;
    }
    return shown(g);
  });
  for (const g of graphics) {
    // The row: the nearest ancestor with text of its own beside the graphic, on one line.
    let row = g.parentElement;
    while (row && row !== scope.parentElement && !(row.textContent ?? '').trim())
      row = row.parentElement;
    if (!row || row === document.body || allowedFor(g, 'aligned')) continue;
    const rr = row.getBoundingClientRect();
    if (rr.height > 40 || !shown(row)) continue;
    const gr = g.getBoundingClientRect();
    /** @type {[number, number][]} */
    const caps = [];
    let text = '';
    let fontSize = 0;
    const lines = new Set();
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const host = n.parentElement;
      if (!host || !shown(host)) continue;
      const hcs = getComputedStyle(host);
      const upper = hcs.textTransform === 'uppercase';
      fontSize = Math.max(fontSize, parseFloat(hcs.fontSize) || 0);
      const s = n.textContent ?? '';
      for (let i = 0; i < s.length; i++) {
        const ch = upper ? s[i].toUpperCase() : s[i];
        if (!ch.trim()) continue;
        const range = document.createRange();
        range.setStart(n, i);
        range.setEnd(n, i + 1);
        const cr = range.getBoundingClientRect();
        if (cr.width < 0.5) continue;
        lines.add(Math.round(cr.top));
        text += ch;
        if (/[A-Z0-9]/.test(ch)) caps.push([cr.left, cr.right]);
      }
    }
    if (!caps.length || lines.size !== 1 || text.length > 48) continue;
    // Columns the graphic covers are not the label's.
    const label = caps.filter(([a, b]) => b <= gr.left || a >= gr.right);
    if (!label.length) continue;
    culprit = row;
    const half = frac(rr.top) || frac(rr.bottom) ? causeOf(row, 'y') : null;
    // On a half pixel an opted-out component put it on: that component's finding, not this row's.
    if (half && allowedFor(culprit, 'whole-pixel')) continue;
    const rcs = getComputedStyle(row);
    const lh = rcs.lineHeight;
    // The content box's rows: a border or a wash's edge is not ink of the label.
    const top = rr.top + num(rcs.borderTopWidth) + num(rcs.paddingTop);
    const bottom = rr.bottom - num(rcs.borderBottomWidth) - num(rcs.paddingBottom);
    if (bottom - top < 2) continue;
    pairs.push({
      name: name(row),
      graphic:
        g instanceof SVGSVGElement
          ? 'icon'
          : parseFloat(getComputedStyle(g).borderTopLeftRadius) >= gr.width / 2 - 0.5
            ? 'dot'
            : 'mark',
      text,
      row: [rr.left, top, rr.width, bottom - top],
      box: [gr.left, gr.top, gr.width, gr.height],
      caps: label,
      boxCentre: gr.top + gr.height / 2,
      lineCentre: rr.top + rr.height / 2,
      lineHeight: lh,
      fontSize,
      half: half ?? (frac(rr.top) ? `${name(row)} at y ${r1(rr.top)}` : null),
    });
    if (pairs.length >= max * 4) break;
  }
  return { dpr, pairs, edges };
}

/**
 * Both rules on a page whose screenshot is `shot` (taken just before, nothing moved since).
 * @param {Page} page
 * @param {string} shot
 * @param {{ max: number }} opts
 * @returns {Promise<LayoutFinding[]>}
 */
export async function measureAlignment(page, shot, { max }) {
  const t = await page.evaluate(alignmentTargets, {
    max,
    graphicMax: GRAPHIC_MAX,
    small: SMALL,
    edgeTolerance: EDGE_TOLERANCE,
  });
  const png = PNG.sync.read(readFileSync(shot));
  /** @type {LayoutFinding[]} */
  const aligned = [];
  let more = 0;
  for (const m of inkOffsets(png, t)) {
    const f = alignedFinding(m, t.dpr);
    if (!f) continue;
    if (aligned.length < max) aligned.push(f);
    else more++;
  }
  if (more) aligned.push({ rule: 'aligned', text: `and ${more} more` });
  return [...aligned, ...t.edges];
}
