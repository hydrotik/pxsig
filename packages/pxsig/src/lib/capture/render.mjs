/** Rendering stories on a pool of pages (capture.mjs): switching story, resetting, the queue. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyTokenOverrides,
  axeScript,
  FREEZE_CSS,
  injectAxe,
  PAUSE_SVG,
  STORYBOOK_ERROR,
  storybookSentinel,
  waitLayoutStable,
  waitMarkupStable,
} from './page.mjs';
/** @import { BrowserContext, Page, PageScreenshotOptions } from 'playwright' */
/** @import { RenderResult } from '../../types.js' */
/** @import { BrowserSource, PxsigBrowser, RenderEntry, RenderOptions, RenderOutput, StorybookPreview } from '../../types/t4.js' */
/** @typedef {NonNullable<Window['axe']>} Axe */

/**
 * Ask the loaded preview to render another story; resolves false if it does not within 10 s.
 * @param {Page} page
 * @param {string} storyId
 * @returns {Promise<boolean>}
 */
async function switchStory(page, storyId) {
  return page
    .evaluate(
      (id) =>
        new Promise((/** @type {(rendered: boolean) => void} */ resolve) => {
          const pv = window.__STORYBOOK_PREVIEW__;
          if (!pv?.channel) return resolve(false);
          if (pv.currentRender?.id === id) return resolve(true);
          // `pv.channel` is checked above; Storybook keeps one channel for the page's life.
          /** @typedef {NonNullable<StorybookPreview['channel']>} Channel */
          const timer = setTimeout(
            () =>
              (/** @type {Channel} */ (pv.channel).off('storyRendered', on), resolve(false)),
            10000
          );
          const on = () => {
            if (pv.currentRender?.id !== id) return;
            clearTimeout(timer);
            /** @type {Channel} */ (pv.channel).off('storyRendered', on);
            resolve(true);
          };
          pv.channel.on('storyRendered', on);
          pv.channel.emit('setCurrentStory', { storyId: id, viewMode: 'story' });
        }),
      storyId
    )
    .catch(() => false);
}

/** @param {Page} page */
async function resetPage(page) {
  await page.mouse.move(0, 0).catch(() => {});
  await page
    .evaluate(() => {
      // A focused element is an HTML, SVG or MathML element: each has `blur`.
      /** @type {HTMLOrSVGElement | null} */ (document.activeElement)?.blur?.();
      window.scrollTo(0, 0);
    })
    .catch(() => {});
}

/**
 * Render manifest entries to `<outDir>/<id>.png` on a pool of pages.
 *
 * An entry is `{ id }` (a plain story, using the run options) or a manifest v2
 * entry with its own `story`, `globals`, `colorScheme`, `viewport`, `browser`,
 * `ignore` (masked selectors), `interaction`, `delay`, `target`, `play`, `a11y`.
 * `browser` is a Browser (chromium) or a `browserPool()`.
 *
 * opts: { baseUrl, globals, viewport, colorScheme, settleMs, target, waitFor, concurrency,
 *         css, tokens, a11y, project }
 * Returns [{ id, png, ms, error, a11y }] in input order plus wall-clock ms.
 * @param {PxsigBrowser | BrowserSource} browser
 * @param {RenderEntry[]} stories
 * @param {string} outDir
 * @param {RenderOptions} [opts]
 * @returns {Promise<RenderOutput>}
 */
export async function renderStories(browser, stories, outDir, opts = {}) {
  const {
    baseUrl = 'http://localhost:6006',
    globals = '',
    viewport = [900, 600],
    colorScheme = 'dark',
    settleMs = 200,
    target = '#storybook-root',
    concurrency = 1,
    css = '',
    tokens = null,
    a11y = false,
    project = null,
    fastSwitch = true,
    waitFor = [],
  } = opts;
  let reloads = 0;
  // A pool has `get`; a Browser does not.
  const pool =
    typeof (/** @type {Partial<BrowserSource>} */ (browser)?.get) === 'function'
      ? /** @type {BrowserSource} */ (browser)
      : { get: async () => /** @type {PxsigBrowser} */ (browser) };
  mkdirSync(outDir, { recursive: true });
  // One slot per entry, each filled by the worker that renders it.
  const results = /** @type {RenderResult[]} */ (Array.from({ length: stories.length }));
  const t0 = performance.now();
  const cfgOf = (/** @type {RenderEntry} */ e) => {
    const vp = e.viewport ?? viewport;
    return {
      browser: e.browser ?? 'chromium',
      vp,
      scheme: e.colorScheme ?? colorScheme,
      key: `${e.browser ?? 'chromium'}|${vp.join('x')}|${e.colorScheme ?? colorScheme}`,
    };
  };
  // Work is handed out per (browser context, story file): a worker renders a whole file's
  // stories on one page, switching in place, and reloads between files. Storybook's dev
  // server injects each component's CSS when it is first rendered, so letting a page carry
  // CSS from other files would make equal-specificity rules resolve by visit order.
  const groupKey = (/** @type {RenderEntry} */ e) =>
    `${cfgOf(e).key}|${e.importPath ?? e.story ?? e.id}|${e.globals ?? globals}`;
  /** @type {Map<string, number[]>} */
  const groups = new Map();
  stories.forEach((e, i) => {
    const k = groupKey(e);
    if (!groups.has(k)) groups.set(k, []);
    // Set on the line above when it was missing.
    /** @type {number[]} */ (groups.get(k)).push(i);
  });
  const queue = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, idx]) => idx);
  let next = 0;
  const axe = a11y && project ? axeScript(project) : '';

  async function worker() {
    /** @type {BrowserContext | null} */
    let context = null;
    // Opened before its first use: `ctxKey` starts null, so the first entry opens a context and page.
    let page = /** @type {Page} */ (/** @type {unknown} */ (null));
    /** @type {string | null} */
    let ctxKey = null;
    /** @type {string | null} */
    let loadedGlobals = null;
    for (;;) {
      const g = next++;
      if (g >= queue.length) break;
      loadedGlobals = null; // a new story file starts on a fresh page load
      for (const i of queue[g]) {
        const e = stories[i];
        const cfg = cfgOf(e);
        const storyId = e.story ?? e.id;
        const png = join(outDir, `${e.id}.png`);
        const t = performance.now();
        try {
          if (ctxKey !== cfg.key) {
            loadedGlobals = null;
            await context?.close();
            const b = await pool.get(cfg.browser);
            context = await b.newContext({
              viewport: { width: cfg.vp[0], height: cfg.vp[1] },
              deviceScaleFactor: 1,
              reducedMotion: 'reduce',
              // `light` or `dark` (schema `$defs/mode`).
              colorScheme: /** @type {'light' | 'dark'} */ (cfg.scheme),
            });
            await context.addInitScript(() => {
              Math.random = () => 0.5;
            });
            page = await context.newPage();
            ctxKey = cfg.key;
          }
          const g = e.globals ?? globals;
          // Switch stories inside the loaded preview (~40 ms) instead of reloading the
          // Storybook bundle (~600 ms). A new page, new globals or a failed switch reloads.
          const switched = fastSwitch && loadedGlobals === g && (await switchStory(page, storyId));
          if (!switched) {
            const resp = await page.goto(
              `${baseUrl}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story${g ? `&globals=${g}` : ''}`,
              { waitUntil: 'networkidle', timeout: 30000 }
            );
            if (resp && !resp.ok()) throw new Error(`HTTP ${resp.status()}`);
            loadedGlobals = g;
            reloads++;
          }
          // Wait for the story (and its play function) to finish rendering.
          await page
            .waitForFunction(
              (id) =>
                window.__STORYBOOK_PREVIEW__?.currentRender?.id === id &&
                // `phase` may be missing: then it is not one of these.
                /** @type {(string | undefined)[]} */ ([
                  'finished',
                  'completed',
                  'aborted',
                  'errored',
                ]).includes(window.__STORYBOOK_PREVIEW__.currentRender.phase),
              storyId,
              { timeout: e.play ? 20000 : 5000 }
            )
            .catch(() => {});
          // Never record Storybook's own error page as a render (a broken index, an unknown story,
          // a story that threw): that would turn "Unable to index files" into a baseline or a diff.
          const sentinel = await page
            .evaluate(storybookSentinel, { id: storyId, root: target })
            .catch(() => null);
          if (sentinel) throw new Error(`${STORYBOOK_ERROR} ${sentinel}`);
          if (!switched) {
            await page.addStyleTag({ content: FREEZE_CSS + css });
            if (tokens) await page.evaluate(applyTokenOverrides, tokens);
          }
          await page.evaluate(() => (document.fonts ? document.fonts.ready : null));
          // Capture once the layout stops moving, not after a fixed delay: components that
          // measure themselves (graphs, grids, overflow menus, charts) settle on their own clock.
          // capture.waitFor rules add a minimum wait and a markup-stability wait for content that
          // animates in JS: [{ selector, minMs?, stableMarkup? }], each applied when its selector matches.
          const rules = [];
          for (const w of waitFor) if (await page.$(w.selector)) rules.push(w);
          await waitLayoutStable(page, e.target ?? target, {
            minMs: Math.max(settleMs, ...rules.map((w) => w.minMs ?? 0)) + (e.delay ?? 0),
          });
          for (const w of rules) if (w.stableMarkup) await waitMarkupStable(page, w.stableMarkup);
          if (e.interaction) {
            const it = e.interaction;
            const loc = page.locator(it.target ?? `${target} *`).first();
            if (it.action === 'hover') await loc.hover({ timeout: 5000 });
            else if (it.action === 'focus') await loc.focus({ timeout: 5000 });
            else if (it.action === 'click') await loc.click({ timeout: 5000 });
            else if (it.action === 'rightclick')
              await loc.click({ button: 'right', timeout: 5000 });
            else if (it.action === 'press') {
              if (it.target) await loc.focus({ timeout: 5000 });
              for (const k of /** @type {string[]} */ ([]).concat(it.key ?? 'Tab'))
                await page.keyboard.press(k);
            }
            if (it.waitFor) await page.waitForSelector(it.waitFor, { timeout: 5000 });
            await page.waitForTimeout(it.settleMs ?? 150);
          }
          await page.evaluate(PAUSE_SVG);
          const sel = e.target ?? target;
          const el = await page.$(sel);
          const box = el ? await el.boundingBox() : null;
          const mask = (e.ignore ?? []).map((q) => page.locator(q));
          /** @type {PageScreenshotOptions} */
          const shot = {
            animations: 'disabled',
            timeout: 10000,
            ...(mask.length ? { mask, maskColor: '#FF00FF' } : {}),
          };
          // An opened popover/menu portals outside the root: capture the viewport for those states.
          const buf =
            el && box && box.width > 1 && box.height > 1 && !e.interaction?.fullPage
              ? await el.screenshot(shot)
              : await page.screenshot(shot);
          writeFileSync(png, buf);
          let a11yRes = null;
          if (axe && e.a11y !== false) {
            a11yRes = await injectAxe(page, axe)
              .then(() =>
                page.evaluate(
                  async ({ sel: root }) => {
                    // injectAxe added axe-core to this page just before.
                    const r = await /** @type {Axe} */ (window.axe).run(
                      document.querySelector(root) ?? document,
                      {
                        resultTypes: ['violations'],
                      }
                    );
                    return r.violations.map((v) => ({
                      id: v.id,
                      impact: v.impact,
                      help: v.help,
                      nodes: v.nodes.length,
                      targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
                    }));
                  },
                  { sel }
                )
              )
              .then((violations) => ({ violations }))
              // Playwright rejects with an Error.
              .catch((/** @type {Error} */ err) => ({ error: String(err.message).split('\n')[0] }));
          }
          results[i] = { id: e.id, png, ms: performance.now() - t, a11y: a11yRes };
          // Leave nothing behind for the next story on this page: pointer, focus, scroll.
          if (fastSwitch) await resetPage(page);
        } catch (err) {
          results[i] = {
            id: e.id,
            png: null,
            ms: performance.now() - t,
            // Playwright and the throws above reject with an Error.
            error: /** @type {Error} */ (err).message.split('\n')[0],
          };
        }
      }
    }
    await context?.close();
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return { results, wallMs: performance.now() - t0, reloads };
}
