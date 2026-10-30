/** The in-page helpers (capture.mjs): the render sentinel, settling, the freeze, tokens and axe. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolvePeer } from '../workspace.mjs';
/** @import { Page } from 'playwright' */
/** @import { PeerBase } from '../../types.js' */
/** @import { TokenValue } from '../../types/t4.js' */

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
export const storybookSentinel = (/** @type {string | { id: string, root?: string }} */ arg) => {
  const { id, root = '#storybook-root' } = typeof arg === 'string' ? { id: arg } : arg;
  const b = document.body;
  const pv = window.__STORYBOOK_PREVIEW__;
  const overlay = document.querySelector('vite-error-overlay');
  if (overlay) {
    // Vite sends a transform error to every page on the dev server, so a story that rendered
    // can carry another file's overlay: drop it from this page. Only a story that did not render
    // is the error.
    const cur = pv?.currentRender;
    const rendered =
      cur?.id === id &&
      // `phase` may be missing: then it is not one of these.
      /** @type {(string | undefined)[]} */ (['finished', 'completed']).includes(cur.phase) &&
      (document.querySelector(root)?.childElementCount ?? 0) > 0;
    if (rendered) overlay.remove();
    else {
      const box =
        overlay.shadowRoot?.querySelector('.message-body') ??
        overlay.shadowRoot?.querySelector('.message');
      const msg = (box?.textContent ?? '').trim().split('\n')[0].slice(0, 200);
      return `Vite error overlay${msg ? `: ${msg}` : ''}`;
    }
  }
  if (!pv) return 'the Storybook preview did not start';
  if (b?.classList.contains('sb-show-errordisplay')) {
    const msg = (document.querySelector('#error-message')?.textContent ?? '')
      .trim()
      .split('\n')[0]
      .slice(0, 200);
    return `Storybook error page${msg ? `: ${msg}` : ''}`;
  }
  if (b?.classList.contains('sb-show-nopreview'))
    return 'Storybook shows "no preview" (story missing from the index?)';
  if (pv?.currentRender?.id && pv.currentRender.id !== id)
    return `Storybook rendered ${pv.currentRender.id}, not ${id}`;
  return null;
};

/**
 * Wait until the geometry under `sel` (every element's box, plus the body's portal
 * count) is unchanged for 300 ms, and at least `minMs` has passed. Polls every
 * 100 ms, gives up after 8 s.
 * @param {Page} page
 * @param {string} sel
 * @param {{ minMs?: number }} [opts]
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
        // Set with the signature, which this poll found unchanged.
        return now - /** @type {number} */ (window.__pxStableSince) >= 300;
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
 * @param {Page} page
 * @param {string} sel
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
        else {
          w.__pxsigMarkup = html;
          w.__pxsigStable = 0;
        }
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

/** axe-core's browser bundle, resolved like Playwright, injected per page for the a11y pass. */
/** @type {string | null} */
let axeSource = null;
/**
 * @param {PeerBase} project
 * @returns {string}
 */
export function axeScript(project) {
  if (axeSource != null) return axeSource;
  try {
    axeSource = readFileSync(
      join(dirname(resolvePeer(project, 'axe-core/package.json')), 'axe.min.js'),
      'utf8'
    );
  } catch {
    axeSource = '';
  }
  return axeSource;
}

/**
 * Override design tokens in the page (the research harness's `tokens`, tools/scenarios.mjs).
 * vanilla-extract names every token `--<path>__<hash>`, so tokens are given by path prefix
 * (`color-primary`) and resolved against the page's stylesheets. A value is a literal, or one of
 * two fixed transforms of the current value: `{ scale: n }` multiplies its leading number (unit
 * kept), `{ mix: colour, amount: pct }` mixes it with a colour. Nothing is evaluated as code.
 * Runs in the page, through `page.evaluate`.
 * @param {Record<string, TokenValue>} want
 * @returns {number}
 */
export function applyTokenOverrides(want) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    // A style rule (and @page, @font-face …) has `style`; @media, @import and the like do not.
    for (const r of /** @type {Iterable<CSSRule & { style?: CSSStyleDeclaration }>} */ (rules))
      if (r.style) for (const n of r.style) if (n.startsWith('--')) names.add(n);
  }
  const probe = getComputedStyle(
    document.querySelector('[data-theme]') || document.documentElement
  );
  const next = (/** @type {TokenValue} */ spec, /** @type {string} */ current) => {
    if (spec && typeof spec === 'object') {
      if (typeof spec.scale === 'number') {
        const m = /^(-?[\d.]+)(.*)$/.exec(current);
        return m ? `${Number(m[1]) * spec.scale}${m[2]}` : current;
      }
      if (typeof spec.mix === 'string')
        return `color-mix(in srgb, ${current} ${100 - (spec.amount ?? 50)}%, ${spec.mix})`;
      return current;
    }
    return String(spec);
  };
  /** @type {string[]} */
  const decls = [];
  for (const [path, spec] of Object.entries(want)) {
    for (const n of names) {
      if (!n.startsWith('--' + path + '__')) continue;
      decls.push(n + ':' + next(spec, probe.getPropertyValue(n).trim()) + ' !important');
    }
  }
  const el = document.createElement('style');
  el.textContent = '*,:root{' + decls.join(';') + '}';
  document.head.appendChild(el);
  return decls.length;
}

/**
 * Load axe-core's bundle into the page once (a page is reused across stories).
 * @param {Page} page
 * @param {string} src
 */
export async function injectAxe(page, src) {
  if (!(await page.evaluate(() => typeof window.axe !== 'undefined')))
    await page.addScriptTag({ content: src });
}
