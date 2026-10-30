/**
 * dashboard-check/capture.mjs — rendering one screen in one theme for `pxsig dashboard check`
 * (dashboard-check.mjs): the viewport, the fixed clock, the frozen motion, and the runner pool.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { injectAxe } from '../lib/capture.mjs';
/** @import { Browser, Page } from 'playwright' */
/** @import { Screen, ScreenCapture, ScreenTarget, ScreenViolation } from '../types/t4.js' */

export const VIEWPORT = { width: 1280, height: 900 };
/** The clock every screen sees, so relative times ("2 days ago") are the same on every run. */
export const FIXED_TIME = '2026-10-25T12:00:00.000Z';
export const LANDMARK_MS = 10_000;
/** The screenshot waits until no element's box has moved for this many frames in a row… */
export const SETTLE_FRAMES = 6;
/** …or this long, whichever comes first (a page that never stops moving is captured anyway). */
export const SETTLE_MS = 2_000;
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
export const describe = (/** @type {ScreenTarget} */ t) =>
  t.role ? `${t.role}${t.name != null ? ` "${t.name}"` : ''}` : `text "${t.text}"`;

/**
 * Render one screen in one theme; never throws (a failure is the result).
 * @param {Browser} browser
 * @param {{ url: string, screen: Screen, shot: string, axe: string, initScript?: string | null }} opts
 * @returns {Promise<ScreenCapture>}
 */
export async function capture(browser, { url, screen, shot, axe, initScript = null }) {
  const started = Date.now();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    reducedMotion: 'reduce',
    colorScheme: url.includes('theme=light') ? 'light' : 'dark',
  });
  /** @type {string[]} */
  const errors = [];
  try {
    await context.addInitScript((css) => {
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = css;
        document.head.append(s);
      });
    }, FREEZE);
    if (initScript) await context.addInitScript(initScript);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e.message ?? e).split('\n')[0]));
    await page.clock.setFixedTime(new Date(FIXED_TIME));
    await page.goto(url, { waitUntil: 'load' });
    for (const a of screen.actions ?? []) {
      if (a.click) await locate(page, a.click).click({ timeout: LANDMARK_MS });
      else if (a.press) await page.keyboard.press(a.press);
    }
    try {
      await locate(page, screen.wait).waitFor({ state: 'visible', timeout: LANDMARK_MS });
    } catch {
      return {
        rendered: false,
        reason: `landmark missing: ${describe(screen.wait)}`,
        errors,
        axe: [],
        ms: Date.now() - started,
      };
    }
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
    const settled = await settle(page);
    mkdirSync(dirname(shot), { recursive: true });
    await page.screenshot({ path: shot });
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
    if (errors.length)
      return {
        rendered: false,
        reason: `page error: ${errors[0]}`,
        errors,
        axe: violations,
        ms: Date.now() - started,
        ...(settled ? {} : { settled: /** @type {const} */ (false) }),
      };
    return {
      rendered: true,
      reason: null,
      errors,
      axe: violations,
      ms: Date.now() - started,
      ...(settled ? {} : { settled: /** @type {const} */ (false) }),
    };
  } catch (e) {
    return {
      rendered: false,
      // Playwright rejects with an Error; anything else is shown as itself.
      reason: String(/** @type {{ message?: string }} */ (e).message ?? e).split('\n')[0],
      errors,
      axe: [],
      ms: Date.now() - started,
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
