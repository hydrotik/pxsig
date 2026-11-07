/**
 * dashboard-check/capture.mjs — rendering one screen in one theme for `pxsig dashboard check`
 * (dashboard-check.mjs): the viewport, the fixed clock, the frozen motion, and the runner pool.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { injectAxe } from '../lib/capture.mjs';
import { navErrorCode, retryOnce } from '../lib/retry.mjs';
import { inspectLayout, MAX_PER_RULE, NARROW_WIDTH, pageOverflow } from './layout.mjs';
/** @import { Browser, Page } from 'playwright' */
/** @import { LayoutFinding, Screen, ScreenCapture, ScreenTarget, ScreenViolation } from '../types/t4.js' */

export const VIEWPORT = { width: 1280, height: 900 };
/** The clock every screen sees, so relative times ("2 days ago") are the same on every run. */
export const FIXED_TIME = '2026-10-25T12:00:00.000Z';
/** …in the same time zone and locale on every machine, so a time on a screen reads the same too. */
export const TIMEZONE = 'UTC';
export const LOCALE = 'en-US';
export const LANDMARK_MS = 10_000;
/** The screenshot waits until no element's box has moved for this many frames in a row… */
export const SETTLE_FRAMES = 6;
/** …or this long, whichever comes first (a page that never stops moving is captured anyway). */
export const SETTLE_MS = 2_000;
/** Windows' WSAENOBUFS: the OS ran out of socket buffers while several screens loaded at once. */
export const NO_BUFFER_SPACE = 'ERR_NO_BUFFER_SPACE';
/** The pause before the one retry of a page load that failed with NO_BUFFER_SPACE. */
export const RETRY_MS = 500;
export const FREEZE =
  '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';

/**
 * Wait until the layout holds still: every element's box unchanged for SETTLE_FRAMES animation
 * frames, or SETTLE_MS. An adapter's chart can resize a moment after it first draws (a debounced
 * resize observer), and a screenshot taken before that shows it at its first size.
 * @param {Page} page
 * @returns {Promise<boolean>} false when SETTLE_MS ran out first
 */
export function settle(page) {
  return page.evaluate(
    ({ frames, cap }) =>
      new Promise((done) => {
        const start = performance.now();
        let last = '';
        let same = 0;
        const tick = () => {
          let boxes = '';
          for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            boxes += `${r.x},${r.y},${r.width},${r.height};`;
          }
          same = boxes === last ? same + 1 : 0;
          last = boxes;
          if (same >= frames) done(true);
          else if (performance.now() - start >= cap) done(false);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { frames: SETTLE_FRAMES, cap: SETTLE_MS }
  );
}

/**
 * Load `url`, retrying once after RETRY_MS when the load failed with NO_BUFFER_SPACE (not a page
 * defect). Any other error, or a second failure, is thrown.
 * @param {Pick<Page, 'goto'>} page
 * @param {string} url
 * @returns {Promise<typeof NO_BUFFER_SPACE | null>} what was retried, or null
 */
export async function load(page, url) {
  const { retried } = await retryOnce(() => page.goto(url, { waitUntil: 'load' }), {
    when: (e) => navErrorCode(e) === NO_BUFFER_SPACE,
    delayMs: RETRY_MS,
  });
  return retried ? NO_BUFFER_SPACE : null;
}

/**
 * A screen's target: `{ role, name?, exact? }` or `{ text, exact? }`.
 * @param {Page} page
 * @param {ScreenTarget} t
 */
export function locate(page, t) {
  if (t.role)
    return page
      .getByRole(
        // screens.json names an ARIA role.
        /** @type {Parameters<Page['getByRole']>[0]} */ (t.role),
        { ...(t.name != null ? { name: t.name } : {}), exact: t.exact ?? false }
      )
      .first();
  // A target without a role has its text (screens.json).
  return page.getByText(/** @type {string} */ (t.text), { exact: t.exact ?? false }).first();
}
/**
 * Wait for what a screenshot waits for: the inspector's stage no longer aria-busy, images decoded,
 * fonts loaded.
 * @param {Page} page
 */
async function ready(page) {
  // The inspector marks its stage aria-busy until its images are drawn, analysed and fitted.
  await page
    .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, {
      timeout: LANDMARK_MS,
    })
    .catch(() => {});
  await page.evaluate(() =>
    Promise.all([...document.images].map((i) => i.decode().catch(() => {})))
  );
  await page.evaluate(() => document.fonts?.ready);
}

/**
 * A `scroll` action: once the layout is stable, set scrollTop on the target's nearest scrollable
 * ancestor so the target sits at its top. Only that container moves (not scrollIntoView, which
 * also scrolls the dialog and the page). Throws (the capture fails) when nothing scrolled, the
 * scroll did not hold, or the dialog or page moved.
 * @param {Page} page
 * @param {ScreenTarget} t
 */
export async function scrollTo(page, t) {
  await ready(page);
  await settle(page);
  const el = locate(page, t);
  await el.waitFor({ state: 'attached', timeout: LANDMARK_MS });
  /**
   * @param {Element} target
   * @param {string} phase `set` scrolls; anything else only reads
   * @returns {{ error?: string, inView?: boolean, scrollTop?: number, at?: string }}
   */
  const run = (target, phase) => {
    let box = target.parentElement;
    while (
      box &&
      !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))
    )
      box = box.parentElement;
    // No scroll container (an adapter whose panel grows with its content): nothing to scroll
    // when the target is already in the viewport, a failure when it is not.
    if (!box) {
      const r = target.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight
        ? { inView: true }
        : { error: 'no scrollable ancestor, and the target is outside the viewport' };
    }
    const frame = (target.closest('[role="dialog"]') ?? document.body).getBoundingClientRect();
    const at = `${Math.round(frame.x)},${Math.round(frame.y)},${Math.round(frame.width)},${Math.round(frame.height)},${window.scrollX},${window.scrollY}`;
    if (phase === 'set')
      box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top;
    return { scrollTop: box.scrollTop, at };
  };
  const before = await el.evaluate(run, 'read');
  if (before.inView) return;
  const set = await el.evaluate(run, 'set');
  await settle(page);
  const after = await el.evaluate(run, 'read');
  const problem =
    before.error ??
    (!((set.scrollTop ?? 0) > 0)
      ? 'its scroll container did not scroll'
      : after.scrollTop !== set.scrollTop
        ? `its scroll container did not hold (${set.scrollTop} → ${after.scrollTop})`
        : after.at !== before.at
          ? 'the dialog or page moved'
          : null);
  if (problem) throw new Error(`scroll to ${describe(t)}: ${problem}`);
}

export const describe = (/** @type {ScreenTarget} */ t) =>
  t.role ? `${t.role}${t.name != null ? ` "${t.name}"` : ''}` : `text "${t.text}"`;

/**
 * The layout findings (layout.mjs) at VIEWPORT, then the page's overflow at NARROW_WIDTH. Leaves
 * the page at NARROW_WIDTH: run it last.
 * @param {Page} page
 * @returns {Promise<LayoutFinding[]>}
 */
export async function measureLayout(page) {
  const found = [
    ...(await page.evaluate(inspectLayout, { max: MAX_PER_RULE })),
    ...(await page.evaluate(pageOverflow)),
  ];
  await page.setViewportSize({ width: NARROW_WIDTH, height: VIEWPORT.height });
  await settle(page);
  return [...found, ...(await page.evaluate(pageOverflow))];
}

/**
 * A browser context as every screen sees it: VIEWPORT, reduced motion, the theme's colour scheme,
 * TIMEZONE and LOCALE, and FREEZE's style added to every page (no animation, transition or caret).
 * `bypassCSP`: axe-core is injected as a script, which a served page's policy refuses (the real
 * server's, scripts/live/run.mjs); the page renders the same.
 * @param {Browser} browser
 * @param {'light' | 'dark'} colorScheme
 * @param {{ bypassCSP?: boolean }} [opts]
 */
export async function screenContext(browser, colorScheme, { bypassCSP = false } = {}) {
  const context = await browser.newContext({
    ...(bypassCSP ? { bypassCSP } : {}),
    viewport: VIEWPORT,
    reducedMotion: 'reduce',
    colorScheme,
    timezoneId: TIMEZONE,
    locale: LOCALE,
  });
  await context.addInitScript((css) => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = css;
      document.head.append(s);
    });
  }, FREEZE);
  return context;
}

/**
 * Capture a page already showing its screen (its landmark visible): wait until its images are
 * drawn, its fonts loaded and its layout still, then take the screenshot, the accessibility
 * snapshot (`aria`), the anchors' boxes, axe's violations and (`layout`) the layout findings.
 * Never throws for a page error (`errors`, collected by the caller): the result says it.
 * `restore`: after the layout measure, put the page back at VIEWPORT and let it settle, so a flow
 * goes on on the same page (scripts/live/run.mjs).
 * @param {Page} page
 * @param {{ shot: string, axe: string, layout?: boolean, aria?: boolean, anchors?: { name: string, target: ScreenTarget }[], errors: string[], restore?: boolean }} opts
 * @returns {Promise<Omit<ScreenCapture, 'ms' | 'retried'>>}
 */
export async function snap(
  page,
  { shot, axe, layout = false, aria = false, anchors = [], errors, restore = false }
) {
  await ready(page);
  const settled = await settle(page);
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot });
  // Before the layout measure, which leaves the page at another width.
  const structure = aria ? await page.locator('body').ariaSnapshot() : null;
  /** @type {Record<string, [number, number, number, number] | null>} */
  const boxes = {};
  for (const a of anchors) {
    const el = locate(page, a.target);
    const box = (await el.count()) ? await el.boundingBox() : null;
    boxes[a.name] = box
      ? [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)]
      : null;
  }
  /** @type {ScreenViolation[]} */
  let violations = [];
  if (axe) {
    await injectAxe(page, axe);
    violations = await page.evaluate(async () => {
      // injectAxe added axe-core to this page just above.
      const r = await /** @type {NonNullable<Window['axe']>} */ (window.axe).run(document, {
        resultTypes: ['violations'],
      });
      return r.violations.map((v) => ({
        id: v.id,
        impact: v.impact ?? null,
        count: v.nodes.length,
      }));
    });
  }
  const measured = layout && !errors.length;
  const found = measured ? await measureLayout(page) : [];
  if (measured && restore) {
    await page.setViewportSize(VIEWPORT);
    await settle(page);
  }
  const unsettled = settled ? {} : { settled: /** @type {const} */ (false) };
  if (errors.length)
    return {
      rendered: false,
      reason: `page error: ${errors[0]}`,
      errors,
      axe: violations,
      layout: [],
      ...unsettled,
    };
  return {
    rendered: true,
    reason: null,
    errors,
    axe: violations,
    layout: found,
    ...(structure != null ? { aria: structure } : {}),
    ...(anchors.length ? { anchors: boxes } : {}),
    ...unsettled,
  };
}

/**
 * Render one screen in one theme; never throws (a failure is the result). `layout`: also measure
 * the layout findings (the adapter's screens; not the reference's). `aria`: also take the page's
 * accessibility snapshot (Playwright's `ariaSnapshot`), the structure scripts/screens-check.mjs locks.
 * `anchors`: measure these elements' boxes, the geometry it locks.
 * @param {Browser} browser
 * @param {{ url: string, screen: Screen, shot: string, axe: string, initScript?: string | null, layout?: boolean, aria?: boolean, anchors?: { name: string, target: ScreenTarget }[] }} opts
 * @returns {Promise<ScreenCapture>}
 */
export async function capture(
  browser,
  { url, screen, shot, axe, initScript = null, layout = false, aria = false, anchors = [] }
) {
  const started = Date.now();
  const context = await screenContext(browser, url.includes('theme=light') ? 'light' : 'dark');
  /** @type {string[]} */
  const errors = [];
  /** @type {typeof NO_BUFFER_SPACE | null} */
  let retried = null;
  try {
    if (initScript) await context.addInitScript(initScript);
    const page = await context.newPage();
    if (screen.width) await page.setViewportSize({ width: screen.width, height: VIEWPORT.height });
    page.on('pageerror', (e) => errors.push(String(e.message ?? e).split('\n')[0]));
    await page.clock.setFixedTime(new Date(FIXED_TIME));
    retried = await load(page, url);
    for (const a of screen.actions ?? []) {
      if (a.click) await locate(page, a.click).click({ timeout: LANDMARK_MS });
      else if (a.press) await page.keyboard.press(a.press);
      // The target at the top of its scroll container (a section below a panel's fold), as a
      // person scrolls: no click, so nothing is activated or focused.
      else if (a.scroll) await scrollTo(page, a.scroll);
    }
    try {
      await locate(page, screen.wait).waitFor({ state: 'visible', timeout: LANDMARK_MS });
    } catch {
      return {
        rendered: false,
        reason: `landmark missing: ${describe(screen.wait)}`,
        errors,
        axe: [],
        layout: [],
        ms: Date.now() - started,
        ...(retried ? { retried } : {}),
      };
    }
    return {
      ...(await snap(page, { shot, axe, layout, aria, anchors, errors })),
      ms: Date.now() - started,
      ...(retried ? { retried } : {}),
    };
  } catch (e) {
    return {
      rendered: false,
      // Playwright rejects with an Error; anything else is shown as itself.
      reason: String(/** @type {{ message?: string }} */ (e).message ?? e).split('\n')[0],
      errors,
      axe: [],
      layout: [],
      ms: Date.now() - started,
      ...(retried ? { retried } : {}),
    };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Run `fn` over `items`, `n` at a time, keeping the order of the results.
 * @template T, R
 * @param {T[]} items
 * @param {number} n
 * @param {(item: T, i: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function pool(items, n, fn) {
  // One slot per item, each filled by the runner that takes it.
  const out = /** @type {R[]} */ (Array.from({ length: items.length }));
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}
