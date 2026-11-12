/**
 * dashboard-check/fidelity.mjs — the region rules an adapter may not change (R1 to R4 in the UI
 * contract; docs/ui/build-adapter.md, "Region rules"), measured in the page after it renders.
 * Unlike the layout findings (layout.mjs), each one fails `pxsig dashboard check`:
 *
 *   one-line  the top bar's links and controls, a toolbar's controls, or a row of actions (two or
 *             more controls side by side in one flex row) take more than one line
 *   size      the controls on one line of a toolbar or a row of actions differ in height; a
 *             table's controls differ in height, or are taller than the page's small size (its
 *             smallest control outside the tables: the dashboard draws its toolbars, the top bar's
 *             buttons and a card's actions at `sm`, the size of a table's actions)
 *   casing    a column header, heading, top-bar link, button, badge or field label is drawn in
 *             another case than its text (`text-transform`), or its text is the copy's in another
 *             case; stat labels are the contract's own micro labels and are not measured, and a
 *             badge may be drawn in capitals (`uppercase`: micro caps), its text still the copy's
 *   tone      a stat card, badge or status badge shows its tone as a border, an edge or a wash
 *             (a border, background or ::before / ::after in a tone colour): the contract shows it
 *             as the colour of the value, the text or the glyph
 *
 * The rules read roles and the box model, and the `pxsig-ui-<name>` classes the dashboard adds to
 * a contract component's root (src/ui/index.ts); never an adapter's own class names. An element
 * opts out with `data-layout-allow="<reason>"`, as for the layout rules. While a modal `<dialog>`
 * is open, only what is inside it is measured.
 *
 * `inspectFidelity` runs in the page (`page.evaluate`), so it is self-contained.
 */
/** @import { FidelityFinding } from '../types/t4.js' */

/**
 * Every fidelity finding on the page as it is. `copy`: every string of the dashboard's copy
 * (src/copy/en.json), placeholders as `{name}`. Self-contained: runs in the page.
 * @param {{ max: number, copy: string[] }} opts
 * @returns {FidelityFinding[]}
 */
export function inspectFidelity({ max, copy }) {
  /** @type {FidelityFinding[]} */
  const out = [];
  const TOL = 0.5;
  const CONTROL =
    '[data-control], button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="combobox"], [role="tab"], [role="checkbox"], [role="switch"], [role="radio"], [role="menuitem"], [role="link"], [role="slider"]';
  const ROW = '[role="toolbar"], [data-toolbar], [data-control-row]';
  const TABLE = 'table, [role="table"], [role="grid"], [role="treegrid"]';
  /** A link drawn as text (no padding, no fill); a link drawn as a button is a control. */
  const textLink = (/** @type {Element} */ el) => {
    if (!el.matches('a[href], [role="link"]')) return false;
    const cs = getComputedStyle(el);
    return (
      (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) < 2 &&
      (cs.backgroundColor === 'transparent' || /,\s*0\)$/.test(cs.backgroundColor))
    );
  };
  const px = (/** @type {number} */ n) => `${Math.round(n * 10) / 10}px`;
  const allowed = (/** @type {Element} */ el) => !!el.closest('[data-layout-allow]');
  const modal = document.querySelector('dialog:modal');
  const visible = (/** @type {Element} */ el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return (
      r.width > 1 &&
      r.height > 1 &&
      cs.visibility !== 'hidden' &&
      cs.opacity !== '0' &&
      !el.closest('[inert], [aria-hidden="true"]') &&
      (!modal || modal.contains(el))
    );
  };
  const clean = (/** @type {string | null | undefined} */ s) =>
    (s ?? '').trim().replace(/\s+/g, ' ');
  const name = (/** @type {Element} */ el) => {
    const field = el instanceof HTMLInputElement || el instanceof HTMLSelectElement ? el : null;
    const by = el.getAttribute('aria-labelledby');
    // A label's own text, without the control it wraps.
    const own = (/** @type {Element | undefined} */ l) =>
      l
        ? [...l.childNodes]
            .filter((n) => !n.contains(el))
            .map((n) => n.textContent)
            .join(' ')
        : null;
    const label = clean(
      el.getAttribute('aria-label') ??
        (by ? document.getElementById(by.split(' ')[0])?.textContent : null) ??
        own(field?.labels?.[0]) ??
        (field instanceof HTMLSelectElement
          ? field.selectedOptions[0]?.text
          : field?.placeholder) ??
        el.textContent
    ).slice(0, 32);
    const role = el.getAttribute('role');
    return `<${el.tagName.toLowerCase()}${role ? ` role=${role}` : ''}${label ? ` "${label}"` : ''}>`;
  };
  /** The outermost visible controls under `root`, not opted out. */
  const controlsIn = (/** @type {Element} */ root) =>
    [...root.querySelectorAll(CONTROL)].filter(
      (el) =>
        visible(el) && !allowed(el) && !(el.parentElement && el.parentElement.closest(CONTROL))
    );
  /**
   * Boxes in lines, top to bottom, each line left to right: a box joins the line when it starts
   * above the line's shortest bottom, so a tall control beside two lines of links does not join
   * them into one.
   */
  const linesOf = (/** @type {Element[]} */ els) => {
    const boxes = els
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .sort((a, b) => a.r.top - b.r.top);
    /** @type {{ el: Element, r: DOMRect }[][]} */
    const lines = [];
    let bottom = -Infinity;
    for (const b of boxes) {
      if (lines.length && b.r.top < bottom - TOL) {
        lines[lines.length - 1].push(b);
        bottom = Math.min(bottom, b.r.bottom);
      } else {
        lines.push([b]);
        bottom = b.r.bottom;
      }
    }
    // Each line in reading order, for the messages.
    for (const line of lines) line.sort((a, b) => a.r.left - b.r.left);
    return lines;
  };

  // --- one-line --------------------------------------------------------------------------------
  /** The rows of controls measured here, for the size rule below. @type {[string, Element[]][]} */
  const sized = [];
  const oneLine = (/** @type {string} */ where, /** @type {Element[]} */ els, size = true) => {
    if (size) sized.push([where, els]);
    const lines = linesOf(els);
    if (lines.length > 1)
      out.push({
        rule: 'one-line',
        text: `${where} takes ${lines.length} lines: ${name(lines[1][0].el)} starts line 2`,
      });
  };
  for (const nav of document.querySelectorAll('.pxsig-ui-TopNav')) {
    if (!visible(nav) || allowed(nav)) continue;
    const label = nav.getAttribute('aria-label');
    // Links, menus and toggles: one line, each at its own height.
    oneLine(`the top bar${label ? ` "${label}"` : ''}`, controlsIn(nav), false);
  }
  document.querySelectorAll(ROW).forEach((row, ri) => {
    if (!visible(row) || allowed(row)) return;
    const own = controlsIn(row).filter((el) => el.closest(ROW) === row);
    const label = row.getAttribute('aria-label');
    if (own.length > 1) oneLine(`toolbar ${ri + 1}${label ? ` "${label}"` : ''}`, own);
  });
  // A row of actions: two or more controls, each a child of one flex row (or the only control of
  // a child), and none in a table, a toolbar or the top bar (measured above or below).
  /** @type {Map<Element, Element[]>} */
  const rows = new Map();
  for (const el of controlsIn(document.body)) {
    if (el.closest(`${TABLE}, ${ROW}, .pxsig-ui-TopNav`) || textLink(el)) continue;
    const parent = el.parentElement;
    if (!parent) continue;
    const ps = getComputedStyle(parent);
    const flexRow = (/** @type {CSSStyleDeclaration} */ cs) =>
      cs.display.endsWith('flex') && cs.flexDirection.startsWith('row');
    let holder = flexRow(ps) ? parent : null;
    if (!holder && parent.parentElement && controlsIn(parent).length === 1) {
      const gs = getComputedStyle(parent.parentElement);
      if (flexRow(gs)) holder = parent.parentElement;
    }
    if (!holder || allowed(holder)) continue;
    rows.set(holder, [...(rows.get(holder) ?? []), el]);
  }
  for (const els of rows.values()) {
    // Tiles (a card that is a button) wrap as a grid of figures; actions are control-sized.
    if (els.length < 2 || els.some((el) => el.getBoundingClientRect().height > 48)) continue;
    oneLine(`the actions ${els.map(name).slice(0, 3).join(', ')}`, els);
  }

  // --- size ------------------------------------------------------------------------------------
  /** Controls on one line of a row differ in height: the row's first finding only. */
  const oneSize = (/** @type {string} */ where, /** @type {Element[]} */ els) => {
    for (const line of linesOf(els)) {
      const hs = line.map((b) => b.r.height);
      if (Math.max(...hs) - Math.min(...hs) <= TOL) continue;
      out.push({
        rule: 'size',
        text: `${where}: controls differ in height: ${line.map((b) => `${name(b.el)} ${px(b.r.height)}`).join(', ')}`,
      });
      return;
    }
  };
  for (const [where, els] of sized) oneSize(where, els);
  // The page's small size: its smallest control outside the tables and the stat cards. The
  // dashboard draws its toolbars, the top bar's buttons and a card's actions at `sm`.
  const small = controlsIn(document.body)
    .filter((el) => !textLink(el) && !el.closest(`${TABLE}, .pxsig-ui-StatGroup`))
    .map((el) => el.getBoundingClientRect().height)
    .filter((h) => h >= 20);
  const smHeight = small.length ? Math.min(...small) : null;
  document.querySelectorAll(TABLE).forEach((table, ti) => {
    if (!visible(table) || allowed(table) || table.parentElement?.closest(TABLE)) return;
    const label =
      table.getAttribute('aria-label') ??
      clean(table.querySelector('th, [role="columnheader"]')?.textContent);
    const where = `table ${ti + 1}${label ? ` "${label.slice(0, 32)}"` : ''}`;
    // A table's actions: its controls outside the header row, but links in its text.
    const actions = controlsIn(table).filter(
      (c) =>
        c.closest(TABLE) === table && !c.closest('thead, th, [role="columnheader"]') && !textLink(c)
    );
    if (!actions.length) return;
    const hs = actions.map((c) => c.getBoundingClientRect().height);
    if (Math.max(...hs) - Math.min(...hs) > TOL) {
      const lo = actions[hs.indexOf(Math.min(...hs))];
      const hi = actions[hs.indexOf(Math.max(...hs))];
      out.push({
        rule: 'size',
        text: `${where}: its controls differ in height: ${name(lo)} ${px(Math.min(...hs))}, ${name(hi)} ${px(Math.max(...hs))}`,
      });
    }
    const big = actions.find((c, i) => smHeight != null && hs[i] > smHeight + TOL);
    if (big && smHeight != null)
      out.push({
        rule: 'size',
        text: `${where}: ${name(big)} is ${px(big.getBoundingClientRect().height)} tall, above the page's small size (${px(smHeight)}, its smallest control outside the tables): a table's actions are small`,
      });
  });

  // --- casing ----------------------------------------------------------------------------------
  // Each copy string as a pattern, its placeholders matching anything; one with no words of its own
  // ("{name}") would match every text, so it is left out.
  const holes = copy
    .map((s) => s.split(/\{[^}]+\}/))
    .filter((parts) => parts.join('').replace(/[^a-z]/gi, '').length >= 2)
    .map((parts) => {
      const body = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+?');
      return { exact: new RegExp(`^${body}$`), loose: new RegExp(`^${body}$`, 'i') };
    });
  const CASED =
    'th, [role="columnheader"], h1, h2, h3, h4, h5, h6, [role="heading"], .pxsig-ui-TopNav a, .pxsig-ui-Badge, .pxsig-ui-StatusBadge, button, label';
  /** @type {Set<string>} */
  const said = new Set();
  for (const el of document.querySelectorAll(CASED)) {
    if (!visible(el) || allowed(el) || el.closest('.pxsig-ui-StatGroup')) continue;
    const badge = el.matches('.pxsig-ui-Badge, .pxsig-ui-StatusBadge');
    if (el.parentElement?.closest(CASED) && !badge) continue;
    const text = clean(el.textContent);
    if (!text || !/[a-z]/i.test(text)) continue;
    // The element and every element between it and its text: the first one that re-cases it.
    /** @type {Element | null} */
    let cased = null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n && !cased; n = walker.nextNode()) {
      if (!n.textContent?.trim() || !/[a-z]/i.test(n.textContent)) continue;
      // A badge inside a header or a button is measured on its own.
      const inner = n.parentElement?.closest('.pxsig-ui-Badge, .pxsig-ui-StatusBadge');
      if (!badge && inner && el.contains(inner)) continue;
      for (let e = n.parentElement; e && !cased; e = e === el ? null : e.parentElement) {
        const tt = getComputedStyle(e).textTransform;
        // A badge may be micro caps: capitals drawn from the copy's text, which stays its own.
        if (tt !== 'none' && visible(e) && !(badge && tt === 'uppercase')) cased = e;
      }
    }
    const key = `${el.tagName}|${text}`;
    if (said.has(key)) continue;
    if (cased) {
      said.add(key);
      out.push({
        rule: 'casing',
        text: `${name(el)} is drawn ${getComputedStyle(cased).textTransform} (text-transform on ${name(cased).slice(0, 40)}): its case is the copy's`,
      });
    } else if (!holes.some((h) => h.exact.test(text)) && holes.some((h) => h.loose.test(text))) {
      said.add(key);
      out.push({
        rule: 'casing',
        text: `${name(el)} has the copy's text in another case`,
      });
    }
  }

  // --- tone ------------------------------------------------------------------------------------
  /**
   * A colour as [r, g, b, a] (0–255, alpha 0–1), from a computed `rgb()` / `rgba()`, or the
   * `color(srgb …)` a `color-mix()` computes to.
   */
  const rgba = (/** @type {string} */ c) => {
    const m = c.match(/(rgba?|color)\((?:srgb\s+)?([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = '1'] = m[2]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    const k = m[1] === 'color' ? 255 : 1;
    return [r * k, g * k, b * k, Number(a)];
  };
  const probe = document.createElement('span');
  document.body.append(probe);
  /** @type {Record<string, number[]>} */
  const tones = {};
  for (const [tone, token] of [
    ['info', 'accent'],
    ['success', 'success'],
    ['warning', 'warning'],
    ['danger', 'danger'],
  ]) {
    probe.style.color = `var(--pxsig-color-${token})`;
    const c = rgba(getComputedStyle(probe).color);
    if (c) tones[tone] = c;
  }
  probe.remove();
  /** The opaque colour behind `el`: the nearest ancestor background with alpha, else white. */
  const backdrop = (/** @type {Element} */ el) => {
    for (let e = el.parentElement; e; e = e.parentElement) {
      const c = rgba(getComputedStyle(e).backgroundColor);
      if (c && c[3] > 0.5) return c;
    }
    return [255, 255, 255, 1];
  };
  /** The tone a colour is drawn in, over `back`: on the line from the backdrop to the tone. */
  const toneOf = (/** @type {string} */ css, /** @type {number[]} */ back) => {
    const c = rgba(css);
    if (!c || c[3] < 0.05) return null;
    const mixed = [0, 1, 2].map((i) => c[3] * c[i] + (1 - c[3]) * back[i]);
    for (const [tone, t] of Object.entries(tones)) {
      const d = [0, 1, 2].map((i) => t[i] - back[i]);
      const len = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
      if (len < 900) continue;
      const v = [0, 1, 2].map((i) => mixed[i] - back[i]);
      const k = (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / len;
      const off = Math.hypot(...[0, 1, 2].map((i) => v[i] - k * d[i]));
      // Visibly away from the backdrop, and towards the tone itself: a grey is off the line.
      if (k > 0.05 && Math.hypot(...v) > 6 && off < Math.max(2, 0.1 * Math.hypot(...v)))
        return tone;
    }
    return null;
  };
  const SIDES = ['top', 'right', 'bottom', 'left'];
  for (const root of document.querySelectorAll(
    '.pxsig-ui-StatGroup, .pxsig-ui-Badge, .pxsig-ui-StatusBadge'
  )) {
    if (!visible(root) || allowed(root)) continue;
    const kind = root.matches('.pxsig-ui-StatGroup')
      ? 'stat card'
      : root.matches('.pxsig-ui-Badge')
        ? 'badge'
        : 'status badge';
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (el !== root && !visible(el)) continue;
      // A selected filter tile shows that it is selected, not a tone.
      if (el.closest('[aria-pressed="true"], [aria-current], [aria-selected="true"]')) continue;
      const back = backdrop(el);
      /** @type {string[]} */
      const how = [];
      for (const pseudo of [null, '::before', '::after']) {
        const cs = getComputedStyle(el, pseudo);
        if (pseudo && (cs.content === 'none' || cs.content === 'normal')) continue;
        const at = pseudo ?? '';
        const bg = toneOf(cs.backgroundColor, back);
        if (bg) how.push(`a ${bg} background${at}`);
        for (const k of SIDES) {
          const w = parseFloat(cs.getPropertyValue(`border-${k}-width`)) || 0;
          if (w <= 0 || cs.getPropertyValue(`border-${k}-style`) === 'none') continue;
          const t = toneOf(cs.getPropertyValue(`border-${k}-color`), back);
          if (t) how.push(`a ${t} ${k} border${at}`);
        }
        const shadow = cs.boxShadow;
        if (shadow && shadow !== 'none') {
          const t = toneOf((shadow.match(/(rgba?|color)\([^)]+\)/) ?? [''])[0], back);
          if (t) how.push(`a ${t} shadow${at}`);
        }
      }
      if (!how.length) continue;
      // A stat card names the tile (or part of it) that shows the tone; a badge names itself.
      const item = kind === 'stat card' ? el : root;
      out.push({
        rule: 'tone',
        text: `${kind} ${name(item).slice(0, 48)} shows its tone as ${[...new Set(how)].join(', ')}: the contract shows a tone as the colour of its ${kind === 'stat card' ? 'value' : kind === 'badge' ? 'text' : 'glyph'}`,
      });
      if (kind !== 'stat card') break;
    }
  }

  // At most `max` per rule: the rest as one count.
  /** @type {Record<string, number>} */
  const per = {};
  /** @type {FidelityFinding[]} */
  const kept = [];
  for (const f of out) {
    per[f.rule] = (per[f.rule] ?? 0) + 1;
    if (per[f.rule] <= max) kept.push(f);
  }
  for (const [rule, n] of Object.entries(per))
    if (n > max)
      kept.push({ rule: /** @type {FidelityFinding['rule']} */ (rule), text: `${n - max} more` });
  return kept;
}
