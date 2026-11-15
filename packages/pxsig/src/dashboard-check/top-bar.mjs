/**
 * dashboard-check/top-bar.mjs — the `top-bar` rule of `pxsig dashboard check`: the top bar swept
 * over widths, from 1440 down to 390 CSS px and back up, in a few scenarios (docs/ui/build-adapter.md,
 * "Top bar"). At each width:
 *
 *   - one line: the bar's controls on one line, and each label (a link, the More trigger, a button,
 *     a badge, the select's value, the heading) one line box;
 *   - the kept link (Help) and the More trigger in the bar, neither clipped nor covered, and no
 *     clipped control left in the tab order;
 *   - More shows only while it holds a link, and holds exactly the sections the bar does not show,
 *     in the bar's order, with nothing but those links in its menu; it sits after the last link shown
 *     and before the kept one; every section is in the bar or the menu, once;
 *   - the end details (the last check, the modes tag, the review status beside the review button)
 *     go before any link moves into More;
 *   - the page does not scroll sideways;
 *
 * and across the widths: a wider bar never shows fewer links or end controls, and widening shows
 * the same bar at each width as narrowing did. It reads roles, the box model, `pxsig-ui-TopNav`
 * (which the dashboard adds to TopNav's className) and the dashboard's own `data-top-bar` marks,
 * never an adapter's class names. Each finding fails the check.
 *
 * `probeTopBar` runs in the page (`page.evaluate`), so it is self-contained.
 */
/** @import { Browser, Page } from 'playwright' */
/** @import { TopBarFinding, TopBarSample, TopBarProbe } from '../types/top-bar.js' */
import { screenContext } from './capture.mjs';

/** The widths swept, widest first: the working width (1280), the supported minimum (640), 390. */
export const TOP_BAR_WIDTHS = [
  1440, 1360, 1280, 1200, 1120, 1024, 960, 880, 800, 720, 640, 560, 480, 430, 390,
];
/** The scenarios swept: the fewest end controls, a review waiting, a project picker, a long label. */
export const TOP_BAR_SCENARIOS = ['clean', 'changed', 'several-projects', 'long-label'];
/** The kept link: the one section link that never moves into More. */
export const KEPT = '#help';

/**
 * The bar as it is now. Self-contained: runs in the page.
 * @param {string} kept the kept link's href
 * @returns {TopBarProbe}
 */
export function probeTopBar(kept) {
  const doc = document.scrollingElement ?? document.documentElement;
  const overflow = Math.max(0, doc.scrollWidth - doc.clientWidth);
  const nav = document.querySelector('.pxsig-ui-TopNav');
  if (!nav) return { mark: false, overflow };
  const away = (/** @type {CSSStyleDeclaration} */ cs) =>
    cs.display === 'none' ||
    cs.visibility === 'hidden' ||
    /^inset\((5\d|[6-9]\d|100)(\.\d+)?%\)$/.test(cs.clipPath);
  const hidden = (/** @type {Element} */ el) => {
    for (let e = /** @type {Element | null} */ (el); e && e !== document.body; e = e.parentElement)
      if (away(getComputedStyle(e)) || e.getAttribute('aria-hidden') === 'true') return true;
    return false;
  };
  const shown = (/** @type {Element} */ el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0.5 && r.height > 0.5 && !hidden(el);
  };
  const label = (/** @type {Element} */ el) =>
    (el.getAttribute('aria-label') ?? el.textContent ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 32);
  const name = (/** @type {Element} */ el) =>
    `<${el.tagName.toLowerCase()}${label(el) ? ` "${label(el)}"` : ''}>`;
  const inMenu = (/** @type {Element} */ el) => !!el.closest('[role="menu"]');
  const box = (/** @type {Element} */ el) => {
    const r = el.getBoundingClientRect();
    return /** @type {[number, number]} */ ([r.left, r.right]);
  };
  // Line boxes of an element's drawn text: a rect that starts below the line so far starts another.
  const lineBoxes = (/** @type {Element} */ el) => {
    /** @type {DOMRect[]} */
    const rects = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.textContent?.trim() || !n.parentElement || hidden(n.parentElement)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      rects.push(...[...range.getClientRects()].filter((q) => q.width > 0 && q.height > 0));
    }
    rects.sort((a, b) => a.top - b.top);
    let lines = 0;
    let bottom = -Infinity;
    for (const q of rects)
      if (q.top >= bottom - 1) {
        lines++;
        bottom = q.bottom;
      } else bottom = Math.max(bottom, q.bottom);
    return lines;
  };
  const LABELS =
    'a[href], button, select, [role="combobox"], .pxsig-ui-Badge, .pxsig-ui-StatusBadge, h1';
  const wrapped = [...nav.querySelectorAll(LABELS)]
    .filter((el) => !inMenu(el) && shown(el) && lineBoxes(el) > 1)
    .map((el) => `${name(el)} takes ${lineBoxes(el)} lines`);
  // The bar's controls on one line: each starts above the shortest bottom of the line so far.
  const tops = [...nav.querySelectorAll('a[href], button, select, [role="combobox"]')]
    .filter((el) => !inMenu(el) && shown(el))
    .map((el) => el.getBoundingClientRect())
    .sort((a, b) => a.top - b.top);
  let rows = 0;
  let floor = -Infinity;
  for (const r of tops)
    if (r.top >= floor - 0.5) {
      rows++;
      floor = r.bottom;
    } else floor = Math.min(floor, r.bottom);
  // Cut off: past an ancestor (up to the bar) that clips, the bar's own edges, or the window.
  const cut = (/** @type {Element} */ el) => {
    const [l, r] = box(el);
    for (let e = el.parentElement; e; e = e.parentElement) {
      if (e === nav || /(hidden|clip|auto|scroll)/.test(getComputedStyle(e).overflowX)) {
        const [pl, pr] = box(e);
        if (l < pl - 1 || r > pr + 1) return `cut off by ${name(e)}`;
      }
      if (e === nav) break;
    }
    return l < -1 || r > innerWidth + 1 ? 'outside the window' : null;
  };
  const covered = (/** @type {Element} */ el) => {
    const q = el.getBoundingClientRect();
    const at = document.elementFromPoint(
      Math.min(innerWidth - 1, q.left + q.width / 2),
      q.top + q.height / 2
    );
    return at && !el.contains(at) && !at.contains(el) ? `covered by ${name(at)}` : null;
  };
  const links = [...nav.querySelectorAll('a[href^="#"]')].filter((a) => !inMenu(a) && shown(a));
  const trigger = [...nav.querySelectorAll('[aria-haspopup="menu"]')].find(
    (b) => !inMenu(b) && shown(b)
  );
  const keep = links.find((a) => a.getAttribute('href') === kept);
  const mark = (/** @type {string} */ k) => {
    const el = nav.querySelector(`[data-top-bar="${k}"]`);
    return !!el && shown(el);
  };
  const end = /** @type {const} */ ([
    ['review', ['review-full', 'review-compact']],
    ['picker', ['picker']],
    ['modes', ['modes']],
    ['connection', ['connection-full', 'connection-compact']],
    ['last check', ['last-check']],
    ['status', ['status-beside', 'status-full', 'status-compact']],
  ])
    .filter(([, ks]) => ks.some(mark))
    .map(([k]) => /** @type {string} */ (k));
  return {
    mark: true,
    overflow,
    rows,
    wrapped,
    links: links.map((a) => /** @type {string} */ (a.getAttribute('href'))),
    linkBoxes: links.map(box),
    trigger: trigger ? { box: box(trigger), problem: cut(trigger) ?? covered(trigger) } : null,
    kept: keep ? { box: box(keep), problem: cut(keep) ?? covered(keep) } : null,
    tabbable: [...nav.querySelectorAll('a[href], button, select, input, [tabindex]')]
      .filter(
        (el) => !inMenu(el) && /** @type {HTMLElement} */ (el).tabIndex >= 0 && shown(el) && cut(el)
      )
      .map((el) => `${name(el)} is in the tab order but ${cut(el)}`),
    end,
    details: ['last check', 'modes']
      .filter((k) => end.includes(k))
      .concat(mark('status-beside') ? ['status beside the review button'] : []),
  };
}

/**
 * What the More menu holds once opened: its items' hrefs in order, and any text in it outside an
 * item. Closes it again with Escape, and says whether focus went back to the trigger.
 * @param {Page} page
 */
async function readMenu(page) {
  const trigger = page.locator('.pxsig-ui-TopNav [aria-haspopup="menu"]:visible').first();
  await trigger.click({ timeout: 2_000 });
  const menu = page.locator('[role="menu"]:visible').first();
  await menu.waitFor({ state: 'visible', timeout: 2_000 });
  const held = await menu.evaluate((m) => ({
    items: [...m.querySelectorAll('[role="menuitem"]')].map(
      (i) =>
        (i.matches('a') ? i : i.querySelector('a'))?.getAttribute('href') ??
        `<${i.tagName.toLowerCase()}>`
    ),
    loose: [...m.childNodes].some(function text(/** @type {Node} */ n) {
      if (n.nodeType === Node.TEXT_NODE) return !!n.textContent?.trim();
      return (
        n instanceof Element &&
        !n.matches('[role="menuitem"], [role="separator"]') &&
        [...n.childNodes].some(text)
      );
    }),
  }));
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden', timeout: 2_000 }).catch(() => {});
  const back = await trigger.evaluate(
    (t) => t === document.activeElement || t.contains(document.activeElement)
  );
  return { ...held, back };
}

/**
 * Wait until the bar holds still: the same probe six times in a row, 40ms apart (an adapter moves
 * links into More a frame or more after a resize, later on a loaded machine), or about 5 s.
 * @param {Page} page
 */
async function steady(page) {
  let last = '';
  let same = 0;
  /** @type {TopBarProbe} */
  let m = { mark: false, overflow: 0 };
  for (let i = 0; i < 125 && same < 6; i++) {
    await page.waitForTimeout(40);
    m = await page.evaluate(probeTopBar, KEPT);
    const k = JSON.stringify(m);
    same = k === last ? same + 1 : 0;
    last = k;
  }
  return m;
}

/**
 * Sweep one page: each width narrowest last, then back up; the menu read where More shows.
 * @param {Page} page
 * @param {number[]} [widths]
 * @returns {Promise<TopBarSample[]>}
 */
export async function sweepTopBar(page, widths = TOP_BAR_WIDTHS) {
  const down = [...widths].sort((a, b) => b - a);
  /** @type {TopBarSample[]} */
  const out = [];
  for (const [dir, ws] of /** @type {const} */ ([
    ['down', down],
    ['up', [...down].reverse().slice(1)],
  ])) {
    for (const width of ws) {
      await page.setViewportSize({ width, height: 900 });
      let m = await steady(page);
      // Opening More must not change the bar: when it did, the bar was still moving; look again.
      for (let tries = 0; tries < 2 && m.mark && m.trigger; tries++) {
        await readMenu(page).catch(() => null);
        const again = await steady(page);
        if (JSON.stringify(again) === JSON.stringify(m)) break;
        m = again;
      }
      const menu =
        m.mark && m.trigger
          ? await readMenu(page).catch((e) => ({
              error: String(/** @type {Error} */ (e).message ?? e).split('\n')[0],
            }))
          : null;
      out.push({ width, dir, m, menu });
      if (!m.mark) return out;
    }
  }
  return out;
}

/**
 * The findings of one scenario's sweep (pure: the tests feed it samples).
 * @param {string} scenario
 * @param {TopBarSample[]} samples
 * @returns {TopBarFinding[]}
 */
export function topBarFindings(scenario, samples) {
  /** @type {TopBarFinding[]} */
  const out = [];
  const say = (/** @type {number} */ w, /** @type {string} */ text) =>
    out.push({ rule: 'top-bar', text: `${scenario} at ${w}px: ${text}` });
  if (samples.some((x) => !x.m.mark))
    return [
      {
        rule: 'top-bar',
        text: `${scenario}: no element carries pxsig-ui-TopNav: TopNav must put its className on the bar's root`,
      },
    ];
  const all = samples.map((x) => ({
    ...x,
    p: /** @type {Required<TopBarProbe>} */ (x.m),
  }));
  // Every section, in the bar's order: the widest bar's links, and its menu's.
  const widest = all[0];
  const order = [
    ...widest.p.links,
    ...(widest.menu && 'items' in widest.menu ? widest.menu.items : []),
  ];
  const pos = (/** @type {string} */ h) => order.indexOf(h);
  for (const { width: w, p, menu } of all) {
    if (p.overflow > 1) say(w, `the page scrolls sideways (${Math.round(p.overflow)}px)`);
    if (p.rows > 1) say(w, `the bar takes ${p.rows} lines`);
    for (const x of p.wrapped) say(w, x);
    for (const x of p.tabbable) say(w, x);
    if (!p.kept) say(w, `the kept link (${KEPT}) is not in the bar`);
    else if (p.kept.problem) say(w, `the kept link is ${p.kept.problem}`);
    if (p.trigger?.problem) say(w, `the More trigger is ${p.trigger.problem}`);
    const held = menu && 'items' in menu ? menu.items : [];
    if (menu && 'error' in menu) say(w, `the More menu did not open: ${menu.error}`);
    if (menu && 'items' in menu) {
      if (menu.loose) say(w, 'the More menu holds text outside its items');
      if (!menu.back) say(w, 'Escape did not return focus to the More trigger');
      if (!held.length) say(w, 'More shows with nothing in it');
    }
    const missing = order.filter((h) => !p.links.includes(h) && !held.includes(h));
    if (p.trigger || missing.length) {
      if (missing.length)
        say(
          w,
          `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} in neither the bar nor More`
        );
      const twice = held.filter((h, i) => p.links.includes(h) || held.indexOf(h) !== i);
      if (twice.length) say(w, `${twice.join(', ')} shows twice (bar and More)`);
      const odd = held.filter((h) => pos(h) < 0);
      if (odd.length) say(w, `More holds ${odd.join(', ')}, which is not a section link`);
      const sorted = [...held].filter((h) => pos(h) >= 0).sort((a, b) => pos(a) - pos(b));
      if (sorted.join() !== held.filter((h) => pos(h) >= 0).join())
        say(w, `More holds the links out of the bar's order (${held.join(', ')})`);
    }
    if (p.trigger) {
      const rest = p.linkBoxes.filter((_, i) => p.links[i] !== KEPT);
      const after = rest.length ? Math.max(...rest.map((b) => b[1])) : -Infinity;
      if (p.trigger.box[0] < after - 1 || (p.kept && p.trigger.box[1] > p.kept.box[0] + 1))
        say(w, 'the More trigger is not between the last link shown and the kept link');
      for (const d of p.details)
        say(w, `the ${d} shows while links are in More (end details go first)`);
    }
  }
  // Across widths: never fewer links or end controls on a wider bar; the same bar when widening.
  const down = all.filter((x) => x.dir === 'down');
  for (let i = 1; i < down.length; i++) {
    const [wide, narrow] = [down[i - 1], down[i]];
    if (narrow.p.links.length > wide.p.links.length)
      say(
        narrow.width,
        `${narrow.p.links.length} links in the bar, more than at ${wide.width}px (${wide.p.links.length})`
      );
    if (narrow.p.end.length > wide.p.end.length)
      say(
        narrow.width,
        `${narrow.p.end.length} end controls, more than at ${wide.width}px (${wide.p.end.length}: ${wide.p.end.join(', ')})`
      );
  }
  for (const u of all.filter((x) => x.dir === 'up')) {
    const d = down.find((x) => x.width === u.width);
    const k = (/** @type {typeof u} */ x) => `${x.p.links.join(' ')} | ${x.p.end.join(', ')}`;
    if (d && k(d) !== k(u))
      say(u.width, `widening shows another bar than narrowing did (${k(u)}, against ${k(d)})`);
  }
  return out;
}

/**
 * Sweep each scenario in its own page (dark theme, the clock and motion as the screens have them).
 * @param {Browser} browser
 * @param {{ urlFor: (scenario: string) => Promise<string>, scenarios?: string[], widths?: number[] }} o
 * @returns {Promise<{ widths: number[], scenarios: string[], findings: TopBarFinding[] }>}
 */
export async function checkTopBar(
  browser,
  { urlFor, scenarios = TOP_BAR_SCENARIOS, widths = TOP_BAR_WIDTHS }
) {
  /** @type {TopBarFinding[]} */
  const findings = [];
  for (const scenario of scenarios) {
    const context = await screenContext(browser, 'dark');
    try {
      const page = await context.newPage();
      await page.setViewportSize({ width: widths[0], height: 900 });
      await page.goto(await urlFor(scenario), { waitUntil: 'load' });
      await page.locator('nav').first().waitFor({ state: 'visible', timeout: 10_000 });
      await page.evaluate(() => document.fonts?.ready);
      findings.push(...topBarFindings(scenario, await sweepTopBar(page, widths)));
    } catch (e) {
      findings.push({
        rule: 'top-bar',
        text: `${scenario}: the sweep failed: ${String(/** @type {Error} */ (e).message ?? e).split('\n')[0]}`,
      });
    } finally {
      await context.close().catch(() => {});
    }
  }
  return { widths, scenarios, findings };
}
