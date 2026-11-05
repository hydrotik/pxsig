/**
 * react-renders.test.mjs — render counting (`react.renders`): the settings and off switches
 * (lib/react/config.mjs), the row shape (lib/capture/react-hook.mjs `rowRenders`, rows.mjs), and
 * the hook itself on React 19's own development and production builds in a real Chromium.
 *
 *   node --test packages/pxsig/test/react-renders.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  READ_RENDERS,
  RESET_RENDERS,
  STAYED_QUIET,
  reactHook,
  rowRenders,
} from '../src/lib/capture/react-hook.mjs';
import { reactSettings } from '../src/lib/react/config.mjs';
import { buildRow, summarize } from '../src/lib/rows.mjs';
import { flagLayer } from '../src/lib/workspace/layers.mjs';
import { skipUnless } from './strict.mjs';
/** @import { Browser, Page } from 'playwright' */
/** @import { RenderRead } from '../src/types/react.js' */

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

test('react settings: off by default, the off switches, bad values warn once and turn it off', () => {
  /** @type {string[]} */
  const lines = [];
  const warn = (/** @type {string} */ l) => lines.push(l);
  const env = {};
  const s = (/** @type {unknown} */ react, e = env) => reactSettings({ react }, { env: e, warn });
  assert.deepEqual(s(undefined), { off: null, renders: false });
  assert.deepEqual(s({}), { off: null, renders: false });
  assert.deepEqual(s({ renders: true }), { off: null, renders: true });
  assert.deepEqual(s(false), { off: 'react: false', renders: false });
  assert.deepEqual(s('off'), { off: 'react: false', renders: false });
  assert.deepEqual(s({ renders: true }, { PXSIG_REACT: 'off' }), {
    off: 'PXSIG_REACT=off',
    renders: false,
  });
  assert.deepEqual(s({ renders: true }, { PXSIG_REACT: 'on' }), { off: null, renders: true });
  assert.equal(lines.length, 0);
  assert.deepEqual(s({ renders: 'yes' }), { off: null, renders: false });
  assert.deepEqual(s({ renders: 'yes' }), { off: null, renders: false });
  assert.deepEqual(s(42), { off: 'a bad react value', renders: false });
  assert.deepEqual(lines, [
    '[pxsig] react.renders must be true or false: render counting is off for this run',
    '[pxsig] react must be false or an object: React features are off for this run',
  ]);
  // --no-react is a config flag: it sets `react: false` over every config layer.
  assert.deepEqual(flagLayer({ 'no-react': true }), { react: false });
  assert.deepEqual(flagLayer({}), {});
});

test('a row carries renders only when they were counted; the summary counts the alerts', () => {
  /** @type {RenderRead} */
  const read = {
    build: 'development',
    react: '19.3.1',
    phase: { commits: 2, rendered: 5, mounted: 5 },
    top: [{ name: 'Leaf', renders: 3, compiled: false }],
    ms: 1.5,
    settled: true,
  };
  assert.equal(rowRenders(undefined), undefined);
  assert.equal(rowRenders(null), null);
  assert.deepEqual(rowRenders(read), {
    v: 1,
    build: 'development',
    react: '19.3.1',
    mount: { commits: 2, rendered: 5, mounted: 5 },
    top: [{ name: 'Leaf', renders: 3, compiled: false }],
    ms: 1.5,
    settled: true,
  });
  const after = { ...read, phase: { commits: 1, rendered: 1, mounted: 0 }, settled: false };
  const both = rowRenders(read, after);
  assert.deepEqual(both?.interaction, { commits: 1, rendered: 1 });
  assert.equal(both?.settled, false);
  // A production build reports no time.
  assert.equal(rowRenders({ ...read, build: 'production' })?.ms, undefined);

  const m = { defaultMode: 'dark' };
  const plain = buildRow({ id: 'a--b@dark' }, { pass: true }, { ms: 1 }, null, m);
  assert.equal('renders' in plain, false);
  assert.equal('renderAlerts' in summarize([plain]), false);
  const counted = buildRow({ id: 'a--c@dark' }, { pass: true }, { ms: 1, renders: both }, null, m);
  const none = buildRow({ id: 'a--d@dark' }, { pass: true }, { ms: 1, renders: null }, null, m);
  assert.deepEqual(counted.renders, both);
  assert.equal(none.renders, null);
  assert.equal(summarize([plain, counted, none]).renderAlerts, 1);
});

// React 19's CommonJS builds, from the dashboard's own dependencies, loaded into a page with a
// small module table (no bundler, no network).
const react = (() => {
  try {
    const dash = createRequire(join(here, '..', '..', 'dashboard', 'package.json'));
    const dir = (/** @type {NodeJS.Require} */ r, /** @type {string} */ p) =>
      dirname(r.resolve(`${p}/package.json`));
    const reactDir = dir(dash, 'react');
    const domDir = dir(dash, 'react-dom');
    const schedDir = dir(createRequire(join(domDir, 'package.json')), 'scheduler');
    /** @param {'development' | 'production'} build */
    const files = (build) => ({
      react: join(reactDir, 'cjs', `react.${build}.js`),
      'react/compiler-runtime': join(reactDir, 'cjs', `react-compiler-runtime.${build}.js`),
      scheduler: join(schedDir, 'cjs', `scheduler.${build}.js`),
      'react-dom': join(domDir, 'cjs', `react-dom.${build}.js`),
      'react-dom/client': join(domDir, 'cjs', `react-dom-client.${build}.js`),
    });
    /** @param {'development' | 'production'} build */
    return (build) =>
      `(() => { const process = { env: { NODE_ENV: ${JSON.stringify(build)} } }; const defs = {}; const cache = {};
const require = (n) => { if (cache[n]) return cache[n].exports; const m = { exports: {} }; cache[n] = m; defs[n](m, m.exports); return m.exports; };
${Object.entries(files(build))
  .map(
    ([n, f]) =>
      `defs[${JSON.stringify(n)}] = function (module, exports) {\n${readFileSync(f, 'utf8')}\n};`
  )
  .join('\n')}
window.__require = require; })();`;
  } catch {
    return null;
  }
})();

// The stories: plain functions and createElement, as a story's bundle would render them.
const STORIES = `(() => {
  const React = window.__require('react');
  const { createRoot } = window.__require('react-dom/client');
  const { c } = window.__require('react/compiler-runtime');
  const h = React.createElement;
  const Leaf = ({ n }) => h('li', null, 'item ' + n);
  const List = ({ size }) => h('ul', null, Array.from({ length: size }, (_, i) => h(Leaf, { key: i, n: i })));
  const Static = () => h('div', null, h(List, { size: 3 }));
  const Effect = () => {
    const [n, setN] = React.useState(0);
    React.useEffect(() => setN(1), []);
    return h('p', null, 'n=' + n);
  };
  const Ticking = () => {
    const [n, setN] = React.useState(0);
    React.useEffect(() => { const t = setInterval(() => setN((x) => x + 1), 40); return () => clearInterval(t); }, []);
    return h('p', null, 'tick ' + n);
  };
  const Counter = () => {
    const [n, setN] = React.useState(0);
    return h('button', { id: 'go', onClick: () => setN(n + 1) }, 'clicked ' + n);
  };
  // What the React Compiler emits for a component: a memo cache from react/compiler-runtime.
  const Compiled = () => {
    const $ = c(1);
    let t;
    if ($[0] === Symbol.for('react.memo_cache_sentinel')) { t = h('b', null, 'compiled'); $[0] = t; } else t = $[0];
    return t;
  };
  const Both = () => h('div', null, h(Compiled), h(Leaf, { n: 0 }));
  const Grid = () => h('div', null, Array.from({ length: 1000 }, (_, r) =>
    h('div', { key: r }, Array.from({ length: 5 }, (_, k) => h(Leaf, { key: k, n: r * 5 + k })))));
  const stories = { Static, Effect, Ticking, Counter, Both, Grid };
  let root = null;
  window.mount = (name) => { root ??= createRoot(document.getElementById('root')); React.startTransition(() => root.render(h(stories[name]))); };
})();`;

/** @type {Browser | null} */
const browser = await (async () => {
  if (!react) return null;
  try {
    return await require('playwright').chromium.launch();
  } catch {
    return null;
  }
})();
const skip = skipUnless(browser, "React's builds or Playwright's Chromium are not available");
after(() => browser?.close());

/**
 * A page with the hook (defined before React loads, as the init script does), React and the
 * stories, in one of React's builds.
 * @param {'development' | 'production'} build
 * @param {(page: Page) => Promise<void>} [before] runs before the hook
 */
async function open(build, before) {
  const page = await /** @type {Browser} */ (browser).newPage();
  await page.setContent('<div id="root"></div>');
  if (before) await before(page);
  await page.evaluate(reactHook);
  await page.addScriptTag({ content: /** @type {NonNullable<typeof react>} */ (react)(build) });
  await page.addScriptTag({ content: STORIES });
  return page;
}

/**
 * Mount a story and wait for React to finish committing, then read.
 * @param {Page} page
 * @param {string} name
 */
async function mountAndRead(page, name) {
  // STORIES defines `mount` on the page.
  await page.evaluate(
    (n) => /** @type {{ mount: (n: string) => void }} */ (/** @type {unknown} */ (window)).mount(n),
    name
  );
  await page.waitForTimeout(400);
  return page.evaluate(READ_RENDERS);
}

test(
  'the hook counts commits and renders on React 19, development and production',
  { skip },
  async (t) => {
    for (const build of /** @type {const} */ (['development', 'production'])) {
      await t.test(build, async () => {
        const page = await open(build);
        try {
          const r = /** @type {RenderRead} */ (await mountAndRead(page, 'Static'));
          assert.equal(r.build, build);
          assert.match(String(r.react), /^19\./);
          // Static, List and three Leafs, all first renders, in one commit.
          assert.deepEqual(r.phase, { commits: 1, rendered: 5, mounted: 5 });
          assert.deepEqual(r.top[0], { name: 'Leaf', renders: 3, compiled: false });
          assert.equal(r.settled, true);
          // Development builds time renders; production builds do not.
          assert.equal(r.ms === null, build === 'production');
          // A read starts the window again.
          assert.deepEqual(/** @type {RenderRead} */ (await page.evaluate(READ_RENDERS)).phase, {
            commits: 0,
            rendered: 0,
            mounted: 0,
          });
        } finally {
          await page.close();
        }
      });
    }
  }
);

test(
  'an effect that sets state is a second commit; a timer that keeps setting it is not settled',
  { skip },
  async () => {
    const page = await open('development');
    try {
      await page.evaluate(RESET_RENDERS);
      const effect = /** @type {RenderRead} */ (await mountAndRead(page, 'Effect'));
      // Mount, then the effect's update: Effect renders twice, once a first render.
      assert.deepEqual(effect.phase, { commits: 2, rendered: 2, mounted: 1 });
      assert.equal(effect.settled, true);
      await page.evaluate(RESET_RENDERS);
      const ticking = /** @type {RenderRead} */ (await mountAndRead(page, 'Ticking'));
      assert.ok(ticking.phase.commits > 3, `${ticking.phase.commits} commits`);
      assert.equal(ticking.settled, false);
      // After the capture it keeps committing: still not settled.
      assert.equal(await page.evaluate(STAYED_QUIET), false);
    } finally {
      await page.close();
    }
  }
);

test(
  'an interaction is its own window; the compiler memo cache marks a component compiled',
  { skip },
  async () => {
    const page = await open('development');
    try {
      const mount = /** @type {RenderRead} */ (await mountAndRead(page, 'Counter'));
      assert.deepEqual(mount.phase, { commits: 1, rendered: 1, mounted: 1 });
      await page.click('#go');
      await page.waitForTimeout(300);
      const after = /** @type {RenderRead} */ (await page.evaluate(READ_RENDERS));
      assert.deepEqual(after.phase, { commits: 1, rendered: 1, mounted: 0 });
      assert.deepEqual(rowRenders(mount, after)?.interaction, { commits: 1, rendered: 1 });
      // A story switch replaces Counter: only the new story's components count.
      await page.evaluate(RESET_RENDERS);
      const both = /** @type {RenderRead} */ (await mountAndRead(page, 'Both'));
      assert.deepEqual(
        both.top
          .map((x) => [x.name, x.compiled])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        [
          ['Both', false],
          ['Compiled', true],
          ['Leaf', false],
        ]
      );
    } finally {
      await page.close();
    }
  }
);

test(
  'no React on the page reads null; an existing hook keeps working beside the counts',
  { skip },
  async () => {
    const page = await /** @type {Browser} */ (browser).newPage();
    try {
      await page.setContent('<p>no react</p>');
      await page.evaluate(reactHook);
      assert.equal(await page.evaluate(READ_RENDERS), null);
    } finally {
      await page.close();
    }
    const chained = await open('development', (p) =>
      p.evaluate(() => {
        const seen = { commits: 0, injected: 0 };
        Object.assign(window, { __seen: seen });
        window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
          supportsFiber: true,
          renderers: new Map(),
          inject: () => (seen.injected++, 7),
          onCommitFiberRoot: () => void seen.commits++,
        };
      })
    );
    try {
      const r = /** @type {RenderRead} */ (await mountAndRead(chained, 'Static'));
      assert.deepEqual(r.phase, { commits: 1, rendered: 5, mounted: 5 });
      assert.deepEqual(
        await chained.evaluate(() => /** @type {{ __seen?: unknown }} */ (window).__seen),
        { commits: 1, injected: 1 }
      );
    } finally {
      await chained.close();
    }
  }
);

test('three runs of the same story give the same counts', { skip }, async () => {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const page = await open('development');
    try {
      const r = /** @type {RenderRead} */ (await mountAndRead(page, 'Effect'));
      runs.push({ phase: r.phase, top: r.top, settled: r.settled });
    } finally {
      await page.close();
    }
  }
  assert.deepEqual(runs[1], runs[0]);
  assert.deepEqual(runs[2], runs[0]);
});

test(
  'budget: walking a 1,000-row grid of 5,000 components stays within 5 ms',
  { skip },
  async (t) => {
    const page = await open('production');
    try {
      // Time the hook's own work on each commit, beside React's.
      await page.evaluate(() => {
        const hook = /** @type {NonNullable<Window['__REACT_DEVTOOLS_GLOBAL_HOOK__']>} */ (
          window.__REACT_DEVTOOLS_GLOBAL_HOOK__
        );
        const on = /** @type {NonNullable<typeof hook.onCommitFiberRoot>} */ (
          hook.onCommitFiberRoot
        );
        const spent = { ms: 0 };
        Object.assign(window, { __spent: spent });
        hook.onCommitFiberRoot = (...a) => {
          const t0 = performance.now();
          on(...a);
          spent.ms += performance.now() - t0;
        };
      });
      const r = /** @type {RenderRead} */ (await mountAndRead(page, 'Grid'));
      assert.equal(r.phase.rendered, 5001);
      const ms = await page.evaluate(
        () =>
          /** @type {{ __spent: { ms: number } }} */ (/** @type {unknown} */ (window)).__spent.ms
      );
      t.diagnostic(`the hook took ${ms.toFixed(2)} ms for ${r.phase.rendered} components`);
      assert.ok(ms <= 5, `the hook took ${ms.toFixed(2)} ms`);
    } finally {
      await page.close();
    }
  }
);

test(
  'a commit just before the capture that nothing follows is settled after the capture',
  { skip },
  async () => {
    const page = await open('development');
    try {
      await mountAndRead(page, 'Counter');
      // The capture right after an interaction's answer: the read sees a commit within 250 ms.
      await page.click('#go');
      await page.waitForTimeout(50);
      const r = /** @type {RenderRead} */ (await page.evaluate(READ_RENDERS));
      assert.deepEqual(r.phase, { commits: 1, rendered: 1, mounted: 0 });
      assert.equal(r.settled, false);
      const t0 = Date.now();
      assert.equal(await page.evaluate(STAYED_QUIET), true);
      // It waited only for what was left of the 250 ms after that commit.
      assert.ok(Date.now() - t0 < 400, `${Date.now() - t0} ms`);
    } finally {
      await page.close();
    }
  }
);
