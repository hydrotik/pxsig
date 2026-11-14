/**
 * dashboard-check/alignment.mjs — two layout rules measured from what renders, not from the styles:
 *
 *   aligned      a dot or an icon is centred on its label's capitals, within ALIGN_TOLERANCE: the
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
 * (the screen's `alignment`), and advisory: no exit code changes on them, `--strict` included.
 * `data-layout-allow` opts an element out, as for the other layout rules.
 *
 * `alignmentTargets` runs in the page (`page.evaluate`) and is self-contained; `inkOffsets` reads the
 * screenshot in Node.
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
/** @import { Page } from 'playwright' */
/** @import { LayoutFinding } from '../types/t4.js' */
/** @import { AlignmentPair, AlignmentTargets, InkBand, InkOffset } from '../types/parity.js' */

/** A dot or icon further than this from its label's capitals' centre is a finding (CSS px). */
export const ALIGN_TOLERANCE = 0.5;
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
      !el.closest('[data-layout-allow], [inert]') &&
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
    for (let e = el; e && e.parentElement && e !== document.body; e = e.parentElement) {
      const p = e.parentElement;
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
      const prev = e.previousElementSibling;
      if (prev) {
        const b = prev.getBoundingClientRect();
        if (frac(b[size])) return `${where}: after ${name(prev)}, ${r1(b[size])}px`;
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
    const cause = causeOf(el, 'y') ?? 'its own size is fractional';
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
    if (!row || row === document.body) continue;
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
    const half = frac(rr.top) || frac(rr.bottom) ? causeOf(row, 'y') : null;
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
 * The background of a box: its most common colour (quantised to 4 bits a channel).
 * @param {PNG} png
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 device px, end exclusive
 * @returns {[number, number, number]}
 */
function backdrop(png, x0, y0, x1, y1) {
  /** @type {Map<number, { n: number, c: [number, number, number] }>} */
  const seen = new Map();
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * png.width + x) * 4;
      const c = /** @type {[number, number, number]} */ ([
        png.data[i],
        png.data[i + 1],
        png.data[i + 2],
      ]);
      const k = ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4);
      const s = seen.get(k) ?? { n: 0, c };
      s.n++;
      seen.set(k, s);
    }
  let best = { n: -1, c: /** @type {[number, number, number]} */ ([0, 0, 0]) };
  for (const s of seen.values()) if (s.n > best.n) best = s;
  return best.c;
}

/**
 * The ink band of some columns over some rows: its top and bottom edges in device px, sub-pixel by
 * coverage (a row's coverage: its most covered pixel, against the backdrop and the inkiest pixel).
 * Null when there is no ink.
 * @param {PNG} png
 * @param {[number, number][]} cols device-px column ranges, end exclusive
 * @param {number} y0 @param {number} y1 device px rows, end exclusive
 * @param {[number, number, number]} bg
 * @returns {InkBand | null}
 */
export function inkBand(png, cols, y0, y1, bg) {
  const dist = (/** @type {number} */ i) =>
    (Math.abs(png.data[i] - bg[0]) +
      Math.abs(png.data[i + 1] - bg[1]) +
      Math.abs(png.data[i + 2] - bg[2])) /
    3;
  /** @type {number[]} */
  const rows = [];
  let ink = 0;
  for (let y = y0; y < y1; y++) {
    let m = 0;
    for (const [a, b] of cols)
      for (let x = a; x < b; x++) m = Math.max(m, dist((y * png.width + x) * 4));
    rows.push(m);
    ink = Math.max(ink, m);
  }
  if (ink < 24) return null;
  const cov = rows.map((v) => Math.min(1, v / ink));
  const first = cov.findIndex((c) => c > 0.08);
  let last = cov.length - 1;
  while (last > first && !(cov[last] > 0.08)) last--;
  return { top: y0 + first + (1 - cov[first]), bottom: y0 + last + cov[last] };
}

/**
 * Each pair's offset, measured on the screenshot: the capitals' centre minus the graphic's, in CSS
 * px (positive: the capitals sit lower). A pair whose ink cannot be read is left out.
 * @param {PNG} png
 * @param {AlignmentTargets} t
 * @returns {InkOffset[]}
 */
export function inkOffsets(png, t) {
  const d = t.dpr;
  /** @type {InkOffset[]} */
  const out = [];
  for (const p of t.pairs) {
    const [rx, ry, rw, rh] = p.row.map((v) => v * d);
    const x0 = Math.max(0, Math.floor(rx));
    const y0 = Math.max(0, Math.floor(ry));
    const x1 = Math.min(png.width, Math.ceil(rx + rw));
    const y1 = Math.min(png.height, Math.ceil(ry + rh));
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    const bg = backdrop(png, x0, y0, x1, y1);
    /** @param {number} a @param {number} b */
    const span = (a, b) =>
      /** @type {[number, number]} */ ([
        Math.max(x0, Math.round(a * d)),
        Math.min(x1, Math.round(b * d)),
      ]);
    const caps = inkBand(
      png,
      p.caps.map(([a, b]) => span(a, b)),
      y0,
      y1,
      bg
    );
    const g = inkBand(png, [span(p.box[0], p.box[0] + p.box[2])], y0, y1, bg);
    // A capitals band outside 0.45–1 em is not text read right (a glyph cut off, an overlay).
    const capsHeight = caps ? (caps.bottom - caps.top) / d : 0;
    if (!caps || !g || capsHeight < 0.45 * p.fontSize || capsHeight > p.fontSize) continue;
    const capsCentre = (caps.top + caps.bottom) / 2 / d;
    const graphicCentre = (g.top + g.bottom) / 2 / d;
    out.push({
      pair: p,
      caps,
      graphic: g,
      offset: capsCentre - graphicCentre,
      capsCentre,
      graphicCentre,
    });
  }
  return out;
}

/**
 * The `aligned` finding for a measured pair, or null within ALIGN_TOLERANCE.
 * @param {InkOffset} m
 * @param {number} dpr
 * @returns {LayoutFinding | null}
 */
export function alignedFinding(m, dpr) {
  // To the hundredth of a pixel the measure reads: "within 0.5 px" holds at 0.50.
  if (Math.round(Math.abs(m.offset) * 100) / 100 <= ALIGN_TOLERANCE) return null;
  const r = (/** @type {number} */ n) => Math.round(n * 100) / 100;
  const p = m.pair;
  const band = (/** @type {InkBand} */ b) => `${r(b.top / dpr)}–${r(b.bottom / dpr)}`;
  const cause = p.half
    ? `the row is on a half pixel (${p.half}), so the ${p.graphic} and the text snap apart`
    : Math.abs(p.boxCentre - p.lineCentre) < 0.25
      ? `the ${p.graphic} is centred on the line box (line-height ${p.lineHeight}), not on the capitals`
      : `the ${p.graphic}'s box is centred ${r(p.boxCentre - p.lineCentre)}px off the line box: its margin or alignment`;
  return {
    rule: 'aligned',
    text: `${p.name}: its ${p.graphic} is ${r(Math.abs(m.offset))}px ${m.offset > 0 ? 'above' : 'below'} the capitals' centre (capitals ${band(m.caps)}, ${p.graphic} ${band(m.graphic)}): ${cause}`,
  };
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
