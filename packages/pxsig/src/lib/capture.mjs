/**
 * capture.mjs — deterministic Storybook rendering with a pool of pages.
 *
 * Determinism: fixed viewport, DPR 1, reduced motion, a freeze stylesheet, pinned
 * Math.random, fonts.ready + settle, an element shot with a full-viewport fallback.
 * `concurrency` browser contexts work the story queue in parallel, and a scenario
 * can inject CSS / token overrides / Storybook globals to simulate a change without
 * editing source.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolvePeer } from './workspace.mjs';
import { collectEnv, playwrightVersion } from './env.mjs';

export { CAPTURE_PIPELINE } from './env.mjs';

/** SMIL (<animate>, <animateMotion>) ignores the freeze CSS: pin every SVG's clock to 0. */
export const PAUSE_SVG = () =>
  document.querySelectorAll('svg').forEach((svg) => {
    svg.pauseAnimations?.();
    svg.setCurrentTime?.(0);
  });

/** Prefix of render errors that mean "Storybook showed its error page", not a story problem. */
export const STORYBOOK_ERROR = 'storybook-error:';

/**
 * In-page check after a story renders: null when the preview shows the story, else why not —
 * Vite's error overlay (a module that failed to load or transform: the story never ran), a
 * preview that never started, Storybook's error display (`sb-show-errordisplay`: a story that
 * threw, or "Unable to index files"), its no-preview screen, or a different story than the one
 * asked for.
 */
export const storybookSentinel = (arg) => {
  const { id, root = '#storybook-root' } = typeof arg === 'string' ? { id: arg } : arg;
  const b = document.body;
  const pv = window.__STORYBOOK_PREVIEW__;
  const overlay = document.querySelector('vite-error-overlay');
  if (overlay) {
    // Vite sends a transform error to every page on the dev server, so a story that rendered
    // can carry another file's overlay: drop it from this page. Only a story that did not render
    // is the error.
    const cur = pv?.currentRender;
    const rendered = cur?.id === id && ['finished', 'completed'].includes(cur.phase) && (document.querySelector(root)?.childElementCount ?? 0) > 0;
    if (rendered) overlay.remove();
    else {
      const box = overlay.shadowRoot?.querySelector('.message-body') ?? overlay.shadowRoot?.querySelector('.message');
      const msg = (box?.textContent ?? '').trim().split('\n')[0].slice(0, 200);
      return `Vite error overlay${msg ? `: ${msg}` : ''}`;
    }
  }
  if (!pv) return 'the Storybook preview did not start';
  if (b?.classList.contains('sb-show-errordisplay')) {
    const msg = (document.querySelector('#error-message')?.textContent ?? '').trim().split('\n')[0].slice(0, 200);
    return `Storybook error page${msg ? `: ${msg}` : ''}`;
  }
  if (b?.classList.contains('sb-show-nopreview')) return 'Storybook shows "no preview" (story missing from the index?)';
  if (pv?.currentRender?.id && pv.currentRender.id !== id) return `Storybook rendered ${pv.currentRender.id}, not ${id}`;
  return null;
};

/**
 * Wait until the geometry under `sel` (every element's box, plus the body's portal
 * count) is unchanged for 300 ms, and at least `minMs` has passed. Polls every
 * 100 ms, gives up after 8 s.
 */
export async function waitLayoutStable(page, sel, { minMs = 0 } = {}) {
  const t0 = Date.now();
  await page.evaluate(() => {
    window.__pxStableSig = null;
  });
  await page
    .waitForFunction(
      (root) => {
        const el = document.querySelector(root) || document.body;
        const all = el.querySelectorAll('*');
        let sig = `${all.length}|${document.body.childElementCount}|`;
        for (let i = 0; i < all.length && i < 4000; i++) {
          const r = all[i].getBoundingClientRect();
          sig += `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)};`;
        }
        const now = performance.now();
        if (window.__pxStableSig !== sig) {
          window.__pxStableSig = sig;
          window.__pxStableSince = now;
          return false;
        }
        return now - window.__pxStableSince >= 300;
      },
      sel,
      { polling: 100, timeout: 8000 }
    )
    .catch(() => {});
  const left = minMs - (Date.now() - t0);
  if (left > 0) await page.waitForTimeout(left);
}

/**
 * Wait until the markup under `sel` is unchanged across three polls 150 ms apart (up to 8 s).
 * For content animated by JS on its own clock (a chart library's entry animation), which the
 * freeze stylesheet cannot stop; a fixed delay stretches under load when pages share the CPU.
 */
export async function waitMarkupStable(page, sel) {
  await page.evaluate(() => {
    window.__pxsigMarkup = null;
    window.__pxsigStable = 0;
  });
  await page
    .waitForFunction(
      (q) => {
        const html = [...document.querySelectorAll(q)].map((s) => s.innerHTML).join('|');
        const w = window;
        if (w.__pxsigMarkup === html) w.__pxsigStable = (w.__pxsigStable ?? 0) + 1;
        else ((w.__pxsigMarkup = html), (w.__pxsigStable = 0));
        return w.__pxsigStable >= 3;
      },
      sel,
      { polling: 150, timeout: 8000 }
    )
    .catch(() => {});
}

export const FREEZE_CSS =
  '*,*::before,*::after{animation:none!important;transition:none!important;' +
  'animation-play-state:paused!important;caret-color:transparent!important;scroll-behavior:auto!important}' +
  // An overlay arriving after the render check (another page's error, over Vite's socket) never
  // reaches a screenshot.
  'vite-error-overlay{display:none!important}';

/** Playwright, resolved the way the project would resolve it (see lib/workspace.mjs). */
async function playwright(project) {
  const pw = await import(pathToFileURL(resolvePeer(project, 'playwright')).href);
  return pw.chromium ? pw : pw.default;
}

export async function launchBrowser(project, channel) {
  const chromium = (await playwright(project)).chromium;
  let lastErr;
  for (const ch of channel ? [channel] : [undefined, 'chrome', 'msedge']) {
    try {
      const b = await chromium.launch(ch ? { channel: ch } : {});
      // The channel it launched with is part of the render environment (lib/env.mjs).
      b.__pxsigChannel = ch ?? null;
      return b;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/**
 * Lazily launch one browser per engine (`chromium` | `firefox` | `webkit`), shared by the pool.
 * `env(type)` is that browser's render environment (lib/env.mjs), collected once per launch.
 */
export function browserPool(project, given = {}) {
  const open = new Map(Object.entries(given).map(([k, b]) => [k, Promise.resolve(b)]));
  const envs = new Map();
  return {
    env(type = 'chromium', opts = {}) {
      if (!envs.has(type))
        envs.set(
          type,
          this.get(type).then((b) =>
            collectEnv(b, {
              type,
              channel: b.__pxsigChannel ?? null,
              playwright: project ? playwrightVersion(() => resolvePeer(project, 'playwright/package.json')) : null,
              ...opts,
            })
          )
        );
      return envs.get(type);
    },
    /** The environments of every browser type in `types`: `{ chromium: env, … }`. */
    async envs(types, opts = {}) {
      const out = {};
      for (const t of new Set(types)) out[t] = await this.env(t, opts);
      return out;
    },
    get(type = 'chromium') {
      if (!open.has(type))
        open.set(
          type,
          type === 'chromium'
            ? launchBrowser(project)
            : playwright(project).then((pw) => pw[type].launch())
        );
      return open.get(type);
    },
    async close() {
      for (const [k, b] of open) if (!(k in given)) await (await b).close().catch(() => {});
    },
  };
}

/** axe-core's browser bundle, resolved like Playwright, injected per page for the a11y pass. */
let axeSource = null;
export function axeScript(project) {
  if (axeSource != null) return axeSource;
  try {
    axeSource = readFileSync(join(dirname(resolvePeer(project, 'axe-core/package.json')), 'axe.min.js'), 'utf8');
  } catch {
    axeSource = '';
  }
  return axeSource;
}

/**
 * Build the in-page script that overrides design tokens. vanilla-extract names
 * every token `--<path>__<hash>`, so tokens are given by path prefix
 * (`color-primary`) and resolved against the page's stylesheets. A value can be
 * a literal or `(current) => next` serialised as a function body string.
 */
function tokenOverrideScript(tokens) {
  return `(() => {
    const want = ${JSON.stringify(tokens)};
    const names = new Set();
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) if (r.style) for (const n of r.style) if (n.startsWith('--')) names.add(n);
    }
    const probe = getComputedStyle(document.querySelector('[data-theme]') || document.documentElement);
    const decls = [];
    for (const [path, spec] of Object.entries(want)) {
      for (const n of names) {
        if (!n.startsWith('--' + path + '__')) continue;
        let v = spec;
        if (typeof spec === 'string' && spec.startsWith('fn:')) v = new Function('current', spec.slice(3))(probe.getPropertyValue(n).trim());
        decls.push(n + ':' + v + ' !important');
      }
    }
    const el = document.createElement('style');
    el.textContent = '*,:root{' + decls.join(';') + '}';
    document.head.appendChild(el);
    return decls.length;
  })()`;
}

/** Ask the loaded preview to render another story; resolves false if it does not within 10 s. */
async function switchStory(page, storyId) {
  return page
    .evaluate(
      (id) =>
        new Promise((resolve) => {
          const pv = window.__STORYBOOK_PREVIEW__;
          if (!pv?.channel) return resolve(false);
          if (pv.currentRender?.id === id) return resolve(true);
          const timer = setTimeout(
            () => (pv.channel.off('storyRendered', on), resolve(false)),
            10000
          );
          const on = () => {
            if (pv.currentRender?.id !== id) return;
            clearTimeout(timer);
            pv.channel.off('storyRendered', on);
            resolve(true);
          };
          pv.channel.on('storyRendered', on);
          pv.channel.emit('setCurrentStory', { storyId: id, viewMode: 'story' });
        }),
      storyId
    )
    .catch(() => false);
}

async function resetPage(page) {
  await page.mouse.move(0, 0).catch(() => {});
  await page
    .evaluate(() => {
      document.activeElement?.blur?.();
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
  const pool = typeof browser?.get === 'function' ? browser : { get: async () => browser };
  mkdirSync(outDir, { recursive: true });
  const results = new Array(stories.length);
  const t0 = performance.now();
  const cfgOf = (e) => {
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
  const groupKey = (e) =>
    `${cfgOf(e).key}|${e.importPath ?? e.story ?? e.id}|${e.globals ?? globals}`;
  const groups = new Map();
  stories.forEach((e, i) => {
    const k = groupKey(e);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  });
  const queue = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, idx]) => idx);
  let next = 0;
  const axe = a11y && project ? axeScript(project) : '';

  async function worker() {
    let context = null;
    let page = null;
    let ctxKey = null;
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
              colorScheme: cfg.scheme,
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
                ['finished', 'completed', 'aborted', 'errored'].includes(
                  window.__STORYBOOK_PREVIEW__.currentRender.phase
                ),
              storyId,
              { timeout: e.play ? 20000 : 5000 }
            )
            .catch(() => {});
          // Never record Storybook's own error page as a render (a broken index, an unknown story,
          // a story that threw): that would turn "Unable to index files" into a baseline or a diff.
          const sentinel = await page.evaluate(storybookSentinel, { id: storyId, root: target }).catch(() => null);
          if (sentinel) throw new Error(`${STORYBOOK_ERROR} ${sentinel}`);
          if (!switched) {
            await page.addStyleTag({ content: FREEZE_CSS + css });
            if (tokens) await page.evaluate(tokenOverrideScript(tokens));
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
            else if (it.action === 'rightclick') await loc.click({ button: 'right', timeout: 5000 });
            else if (it.action === 'press') {
              if (it.target) await loc.focus({ timeout: 5000 });
              for (const k of [].concat(it.key ?? 'Tab')) await page.keyboard.press(k);
            }
            if (it.waitFor) await page.waitForSelector(it.waitFor, { timeout: 5000 });
            await page.waitForTimeout(it.settleMs ?? 150);
          }
          await page.evaluate(PAUSE_SVG);
          const sel = e.target ?? target;
          const el = await page.$(sel);
          const box = el ? await el.boundingBox() : null;
          const mask = (e.ignore ?? []).map((q) => page.locator(q));
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
            a11yRes = await page
              .evaluate(
                async ({ src, sel: root }) => {
                  if (!window.axe) new Function(src)();
                  const r = await window.axe.run(document.querySelector(root) ?? document, {
                    resultTypes: ['violations'],
                  });
                  return r.violations.map((v) => ({
                    id: v.id,
                    impact: v.impact,
                    help: v.help,
                    nodes: v.nodes.length,
                    targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
                  }));
                },
                { src: axe, sel }
              )
              .then((violations) => ({ violations }))
              .catch((err) => ({ error: String(err.message).split('\n')[0] }));
          }
          results[i] = { id: e.id, png, ms: performance.now() - t, a11y: a11yRes };
          // Leave nothing behind for the next story on this page: pointer, focus, scroll.
          if (fastSwitch) await resetPage(page);
        } catch (err) {
          results[i] = {
            id: e.id,
            png: null,
            ms: performance.now() - t,
            error: err.message.split('\n')[0],
          };
        }
      }
    }
    await context?.close();
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return { results, wallMs: performance.now() - t0, reloads };
}
