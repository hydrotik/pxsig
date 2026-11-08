/**
 * lib/capture/boxes.mjs — the text record of a render (text-aware diffs): every Text node the
 * screenshot draws, with its line boxes and font facts, and the painted element boxes around them
 * (backgrounds, borders, shadows, svg, img), read in one `page.evaluate` right after the
 * screenshot. Written beside the PNG as `<id>.boxes.json` (types/text.d.ts `TextRecord`); a
 * baseline approved from that render stores it as its `boxes` section (docs/spec.md section 5).
 *
 * Reading changes no pixel and no DOM: the render is the same with text capture on or off. Only
 * text the page draws in the frame is recorded: a run needs a box of at least 2×2 px inside the
 * frame and inside every overflow ancestor's clip, must be visible (`checkVisibility`), and must not
 * lie under an open dialog it is not part of. Form fields (input, textarea, select, option,
 * contenteditable) are never read, nor text under the entry's `ignore` masks or `text.ignore`.
 */
import { rmSync, writeFileSync } from 'node:fs';
/** @import { Page } from 'playwright' */
/** @import { TextCapture, TextRecord } from '../../types/text.js' */

/** The most runs, and the most element boxes, a record holds (`truncated` past it). */
export const MAX_RECORDED = 5000;

/**
 * The text record's file for a render: `<id>.boxes.json` beside `<id>.png`.
 * @param {string} png
 */
export const boxesFile = (png) => png.replace(/\.png$/i, '.boxes.json');

/**
 * In the page: the text record of the frame. Self-contained, as page.evaluate serialises it.
 * `root`: the captured element's selector, or null for the viewport.
 * @param {{ root: string | null, ignore: string[], max: number }} o
 * @returns {TextRecord | { error: string }}
 */
export function collectBoxes({ root, ignore, max }) {
  const rootEl = root ? document.querySelector(root) : document.body;
  if (!rootEl) return { error: `no element matches ${root}` };
  const f = root
    ? rootEl.getBoundingClientRect()
    : { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  const frame = [f.x, f.y, f.x + f.width, f.y + f.height];
  /** @typedef {[number, number, number, number]} Edges left, top, right, bottom */
  /** @type {Edges} */
  const ALL = [-1e9, -1e9, 1e9, 1e9];
  const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100 || 0;
  /** @type {TextRecord['skipped']} */
  const skipped = {
    iframes: 0,
    closedShadow: 0,
    hidden: 0,
    fields: 0,
    ignored: 0,
    clipped: 0,
    covered: 0,
    offFrame: 0,
  };
  /** @type {TextRecord['styles']} */
  const styles = [];
  /** @type {Map<string, number>} */
  const styleIdx = new Map();
  /** @type {Map<Element, CSSStyleDeclaration>} */
  const css = new Map();
  /** @type {Map<Element, number>} */
  const styleOfEl = new Map();
  /** @type {Map<Element, Edges>} */
  const inside = new Map();
  /** @type {(TextRecord['runs'][number] & { el: Element })[]} */
  const runs = [];
  /** @type {TextRecord['elements']} */
  const elements = [];
  let truncated = false;
  const FIELD = 'input,textarea,select,option,[contenteditable]:not([contenteditable="false"])';
  const ign = ignore.filter((s) => s.trim()).join(',');
  const generated = /^(?::r|«r|_r_|radix-|base-ui-)/;
  const cs = (/** @type {Element} */ el) => {
    let s = css.get(el);
    if (!s) css.set(el, (s = getComputedStyle(el)));
    return s;
  };
  const visible = (/** @type {Element} */ el) =>
    typeof el.checkVisibility === 'function'
      ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      : cs(el).visibility !== 'hidden' && el.getClientRects().length > 0;
  /** The element's parent in the flat tree (a slot, a shadow host), or null. */
  const parentOf = (/** @type {Element} */ el) => {
    if (el.assignedSlot) return el.assignedSlot;
    if (el.parentElement) return el.parentElement;
    const r = el.getRootNode();
    return r instanceof ShadowRoot ? r.host : null;
  };
  const within = (/** @type {Element} */ outer, /** @type {Node} */ node) => {
    /** @type {Node | null} */
    let n = node;
    while (n) {
      if (n === outer) return true;
      const r = n.getRootNode();
      n = n.parentNode ?? (r instanceof ShadowRoot ? r.host : null);
    }
    return false;
  };
  /** Makes the containing block of a fixed descendant (transform, filter, perspective, contain). */
  const boxesFixed = (/** @type {Element} */ el) => {
    const s = cs(el);
    return (
      s.transform !== 'none' ||
      s.filter !== 'none' ||
      s.perspective !== 'none' ||
      /paint|layout|strict|content/.test(s.contain)
    );
  };
  /** @returns {Edges} */
  const intersect = (/** @type {Edges} */ a, /** @type {Edges} */ b) => [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ];
  /**
   * The clip on an element's own box: its containing blocks' content clips (an absolute box skips
   * the static ancestors between, a fixed one every ancestor that does not contain it).
   * @param {Element} el
   * @returns {Edges}
   */
  const clipOn = (el) => {
    const pos = cs(el).position;
    let p = parentOf(el);
    if (pos === 'fixed') while (p && !boxesFixed(p)) p = parentOf(p);
    else if (pos === 'absolute')
      while (p && cs(p).position === 'static' && !boxesFixed(p)) p = parentOf(p);
    return p ? clipIn(p) : ALL;
  };
  /**
   * The clip on an element's content: its own padding box when its overflow clips, within the
   * clip on its box. The root element and body never clip here (their overflow is the viewport's).
   * @param {Element} el
   * @returns {Edges}
   */
  const clipIn = (el) => {
    const known = inside.get(el);
    if (known) return known;
    let c = el === document.documentElement || el === document.body ? ALL : clipOn(el);
    const s = cs(el);
    const clips =
      s.overflowX !== 'visible' ||
      s.overflowY !== 'visible' ||
      /paint|strict|content/.test(s.contain);
    if (
      clips &&
      s.display !== 'inline' &&
      el !== document.body &&
      el !== document.documentElement
    ) {
      const b = el.getBoundingClientRect();
      const x = b.x + el.clientLeft;
      const y = b.y + el.clientTop;
      c = intersect(c, [x, y, x + el.clientWidth, y + el.clientHeight]);
    }
    inside.set(el, c);
    return c;
  };
  /**
   * A viewport rect inside the frame and the clip, relative to the frame; null under 2×2 px.
   * @param {DOMRect} r
   * @param {Edges} clip
   * @returns {[number, number, number, number] | 'offFrame' | 'clipped'}
   */
  const place = (r, clip) => {
    const inFrame = intersect(
      [r.x, r.y, r.x + r.width, r.y + r.height],
      /** @type {Edges} */ (frame)
    );
    if (inFrame[2] - inFrame[0] < 2 || inFrame[3] - inFrame[1] < 2) return 'offFrame';
    const v = intersect(inFrame, clip);
    if (v[2] - v[0] < 2 || v[3] - v[1] < 2) return 'clipped';
    return [r2(v[0] - f.x), r2(v[1] - f.y), r2(v[2] - v[0]), r2(v[3] - v[1])];
  };
  // Open dialogs: what lies under one it is not part of is not drawn (a hit test at its centre).
  const dialogs = [
    ...document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"]'),
  ].filter(visible);
  const covered = (/** @type {Node} */ node, /** @type {number[]} */ b) => {
    if (!dialogs.length) return false;
    const x = f.x + b[0] + b[2] / 2;
    const y = f.y + b[1] + b[3] / 2;
    const over = dialogs.filter((d) => {
      if (within(d, node)) return false;
      const r = d.getBoundingClientRect();
      return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
    });
    if (!over.length) return false;
    const hit = document.elementFromPoint(x, y);
    return !!hit && over.some((d) => within(d, hit));
  };
  const transparent = (/** @type {string} */ c) => c === 'transparent' || /,\s*0\)$/.test(c);
  const painted = (/** @type {Element} */ el, /** @type {string} */ tag) => {
    if (['svg', 'img', 'canvas', 'video'].includes(tag)) return true;
    const s = cs(el);
    if (!transparent(s.backgroundColor) || s.backgroundImage !== 'none' || s.boxShadow !== 'none')
      return true;
    return ['Top', 'Right', 'Bottom', 'Left'].some(
      (d) =>
        parseFloat(s.getPropertyValue(`border-${d.toLowerCase()}-width`)) > 0 &&
        !['none', 'hidden'].includes(s.getPropertyValue(`border-${d.toLowerCase()}-style`)) &&
        !transparent(s.getPropertyValue(`border-${d.toLowerCase()}-color`))
    );
  };
  const styleOf = (/** @type {Element} */ el) => {
    const known = styleOfEl.get(el);
    if (known !== undefined) return known;
    const s = cs(el);
    let loaded = null;
    try {
      loaded = document.fonts.check(`${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`);
    } catch {
      loaded = null;
    }
    const st = {
      family: s.fontFamily,
      size: parseFloat(s.fontSize),
      weight: Number(s.fontWeight) || s.fontWeight,
      style: s.fontStyle,
      lineHeight:
        s.lineHeight === 'normal' ? /** @type {const} */ ('normal') : parseFloat(s.lineHeight),
      letterSpacing: s.letterSpacing === 'normal' ? 0 : parseFloat(s.letterSpacing),
      wordSpacing: parseFloat(s.wordSpacing) || 0,
      transform: s.textTransform,
      decoration: s.textDecorationLine,
      color: s.color,
      features: s.fontFeatureSettings,
      variation: s.fontVariationSettings,
      loaded,
    };
    const k = JSON.stringify(st);
    let i = styleIdx.get(k);
    if (i === undefined) {
      i = styles.length;
      styles.push(st);
      styleIdx.set(k, i);
    }
    styleOfEl.set(el, i);
    return i;
  };
  const range = document.createRange();
  /**
   * @param {Element | ShadowRoot} node
   * @param {string} path
   */
  const walk = (node, path) => {
    let ei = 0;
    let ti = 0;
    for (const c of node.childNodes) {
      if (c instanceof Element) {
        const p = `${path}${path ? '/' : ''}${ei++}`;
        const tag = c.localName;
        if (['iframe', 'frame', 'object', 'embed'].includes(tag)) {
          skipped.iframes++;
          continue;
        }
        if (['script', 'style', 'template', 'noscript', 'head'].includes(tag)) continue;
        const inSvg = !!c.parentElement?.closest('svg');
        if (!inSvg && painted(c, tag) && !(ign && c.closest(ign)) && visible(c)) {
          const at = place(c.getBoundingClientRect(), clipOn(c));
          if (Array.isArray(at) && !covered(c, at)) {
            if (elements.length < max) elements.push({ path: p, tag, box: at });
            else truncated = true;
          }
        }
        if (c.shadowRoot) walk(c.shadowRoot, `${p}/^`);
        else if (tag.includes('-') && customElements.get(tag)) skipped.closedShadow++;
        walk(c, p);
      } else if (c instanceof Text) {
        const idx = ti++;
        if (!c.data.trim()) continue;
        const el = c.parentElement;
        if (!el) continue;
        if (el.closest(FIELD)) {
          skipped.fields++;
          continue;
        }
        if (ign && el.closest(ign)) {
          skipped.ignored++;
          continue;
        }
        if (!visible(el)) {
          skipped.hidden++;
          continue;
        }
        range.selectNodeContents(c);
        const clip = clipIn(el);
        /** @type {[number, number, number, number][]} */
        const boxes = [];
        let why = /** @type {'offFrame' | 'clipped'} */ ('offFrame');
        for (const r of range.getClientRects()) {
          const at = place(r, clip);
          if (Array.isArray(at)) boxes.push(at);
          else if (at === 'clipped') why = at;
        }
        if (!boxes.length) {
          skipped[why]++;
          continue;
        }
        if (covered(c, boxes[0])) {
          skipped.covered++;
          continue;
        }
        if (runs.length >= max) {
          truncated = true;
          continue;
        }
        runs.push({
          path: `${path}${path ? '/' : ''}#${idx}`,
          s: c.data,
          st: styleOf(el),
          boxes,
          el,
        });
      }
    }
  };
  walk(rootEl, '');
  // A key is the nearest data-testid, or an id that is not generated, and only when it is unique
  // in the record: a key two runs share (an app's root id) pairs nothing.
  const keyOf = (/** @type {Element} */ el) => {
    const t = el.closest('[data-testid]');
    if (t) return t.getAttribute('data-testid');
    for (let e = /** @type {Element | null} */ (el); e; e = e.parentElement)
      if (e.id && !generated.test(e.id)) return e.id;
    return null;
  };
  const keys = runs.map((r) => keyOf(r.el));
  /** @type {Map<string, number>} */
  const count = new Map();
  for (const k of keys) if (k) count.set(k, (count.get(k) ?? 0) + 1);
  return {
    v: 1,
    frame: { w: r2(f.width), h: r2(f.height) },
    styles,
    runs: runs.map((r, i) => {
      const k = keys[i];
      const { path, s, st, boxes } = r;
      return k && count.get(k) === 1 ? { path, key: k, s, st, boxes } : { path, s, st, boxes };
    }),
    elements,
    skipped,
    truncated,
  };
}

/**
 * Read the text record of what `page` shows and write it to `file`. Never throws: a failure is the
 * result (`{ error }`) and leaves no file, since text capture never fails a render.
 * @param {Page} page
 * @param {string} file
 * @param {{ root?: string | null, ignore?: string[] }} [o]
 * @returns {Promise<TextCapture>}
 */
export async function writeBoxes(page, file, { root = null, ignore = [] } = {}) {
  const t = performance.now();
  try {
    const rec = await page.evaluate(collectBoxes, { root, ignore, max: MAX_RECORDED });
    if ('error' in rec) throw new Error(rec.error);
    const json = JSON.stringify(rec);
    writeFileSync(file, json);
    return {
      runs: rec.runs.length,
      elements: rec.elements.length,
      bytes: Buffer.byteLength(json),
      ms: performance.now() - t,
    };
  } catch (e) {
    rmSync(file, { force: true });
    // Playwright and the throw above reject with an Error.
    const error = String(/** @type {Error} */ (e).message).split('\n')[0];
    return { error, ms: performance.now() - t };
  }
}
