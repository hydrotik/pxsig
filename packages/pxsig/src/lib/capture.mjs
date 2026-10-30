/**
 * capture.mjs — deterministic Storybook rendering with a pool of pages.
 *
 * Determinism: fixed viewport, DPR 1, reduced motion, a freeze stylesheet, pinned
 * Math.random, fonts.ready + settle, an element shot with a full-viewport fallback.
 * `concurrency` browser contexts work the story queue in parallel, and a scenario
 * can inject CSS / token overrides / Storybook globals to simulate a change without
 * editing source.
 */
/** @typedef {NonNullable<Window['axe']>} Axe */

export { CAPTURE_PIPELINE } from './env.mjs';
export {
  applyTokenOverrides,
  axePackage,
  axeScript,
  axeVersion,
  FREEZE_CSS,
  injectAxe,
  PAUSE_SVG,
  STORYBOOK_ERROR,
  storybookSentinel,
  waitLayoutStable,
  waitMarkupStable,
} from './capture/page.mjs';
export { browserPool, browserRecord, connectBrowser, launchBrowser } from './capture/browser.mjs';
export { renderStories } from './capture/render.mjs';
