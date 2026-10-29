/**
 * sentinel.test.mjs — the render sentinel (lib/capture.mjs): Storybook error pages, the Vite overlay
 * and wrong stories.
 *
 *   node --test packages/pxsig/test/sentinel.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storybookSentinel } from '../src/lib/capture.mjs';

/** @typedef {{ document?: unknown, window?: unknown }} StubGlobals */
test('the render sentinel recognises Storybook error pages, the Vite overlay and wrong stories', () => {
  let removed = false;
  /**
   * @param {string[]} classes
   * @param {{ msg?: string, current?: string, overlay?: string | null, preview?: boolean, phase?: string, children?: number }} [opts]
   */
  const page = (
    classes,
    {
      msg = '',
      current = 'a--b',
      overlay = null,
      preview = true,
      phase = 'loading',
      children = 0,
    } = {}
  ) => {
    removed = false;
    const overlayEl =
      overlay === null
        ? null
        : {
            remove: () => (removed = true),
            shadowRoot: {
              querySelector: (/** @type {string} */ q) =>
                q === '.message-body' ? { textContent: overlay } : null,
            },
          };
    const query = (/** @type {string} */ q) =>
      q === 'vite-error-overlay' && !removed
        ? overlayEl
        : q === '#error-message'
          ? { textContent: msg }
          : q === '#storybook-root'
            ? { childElementCount: children }
            : null;
    // Stand-ins with only what storybookSentinel reads from the page.
    /** @type {StubGlobals} */ (globalThis).document = {
      body: { classList: { contains: (/** @type {string} */ c) => classes.includes(c) } },
      querySelector: query,
    };
    /** @type {StubGlobals} */ (globalThis).window = preview
      ? { __STORYBOOK_PREVIEW__: { currentRender: { id: current, phase } } }
      : {};
  };
  try {
    page(['sb-show-main']);
    assert.equal(storybookSentinel('a--b'), null);
    page(['sb-show-errordisplay'], { msg: 'Unable to index files:\n- ./X.stories.tsx' });
    assert.equal(storybookSentinel('a--b'), 'Storybook error page: Unable to index files:');
    page(['sb-show-nopreview']);
    assert.match(/** @type {string} */ (storybookSentinel('a--b')), /no preview/);
    page(['sb-show-main'], { current: 'c--d' });
    assert.match(/** @type {string} */ (storybookSentinel('a--b')), /rendered c--d, not a--b/);
    // A module that failed to load: Vite's overlay over an empty root, and no preview at all.
    page(['sb-show-main'], {
      overlay: 'Failed to resolve import "./X.stories.tsx"\n  at …',
      preview: false,
    });
    assert.equal(
      storybookSentinel('a--b'),
      'Vite error overlay: Failed to resolve import "./X.stories.tsx"'
    );
    page(['sb-show-main'], { preview: false });
    assert.match(/** @type {string} */ (storybookSentinel('a--b')), /preview did not start/);
    // Another page's error, broadcast over Vite's socket, over a story that rendered: not this
    // story's error, and the overlay is taken off the page.
    page(['sb-show-main'], {
      overlay: 'Failed to resolve import "./Other.stories.tsx"',
      phase: 'finished',
      children: 1,
    });
    assert.equal(storybookSentinel({ id: 'a--b', root: '#storybook-root' }), null);
    assert.equal(removed, true);
    page(['sb-show-main'], {
      overlay: 'Failed to resolve import "./X.stories.tsx"',
      phase: 'finished',
      children: 0,
    });
    assert.match(
      /** @type {string} */ (storybookSentinel('a--b')),
      /Vite error overlay/,
      'an empty root under an overlay did not render'
    );
  } finally {
    delete (/** @type {StubGlobals} */ (globalThis).document);
    delete (/** @type {StubGlobals} */ (globalThis).window);
  }
});
