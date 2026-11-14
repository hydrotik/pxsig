/**
 * Source parity (packages/pxsig/src/dashboard-check/parity.mjs): the pairs a conformance file
 * declares, Storybook's URL args, the comparison, and a whole run in Chromium. The run builds the
 * parity page (test/harness/parity) with the plain adapter, and stands a "Storybook" up from it:
 * the same page as iframe.html draws the same component, so nothing differs; a hand-written story
 * with another padding and line height differs in exactly those. Skips the run when no Chromium is
 * available (PXSIG_CHROMIUM names an executable).
 */
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { noChromium } from './flows-helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const require = createRequire(path.join(here, '../../pxsig/package.json'));
const { argsParam, compareSides, parityPairs, paritySummary, runParity, storyUrl } =
  await import('../../pxsig/src/dashboard-check/parity.mjs');
const { CHROMIUM_ARGS } = await import('../../pxsig/src/lib/capture/browser.mjs');

const out = mkdtempSync(path.join(tmpdir(), 'pxsig-parity-'));
let browser = null;
let skip = false;
before(async () => {
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({
      args: [...CHROMIUM_ARGS],
      ...(process.env.PXSIG_CHROMIUM ? { executablePath: process.env.PXSIG_CHROMIUM } : {}),
    });
  } catch (e) {
    skip = noChromium(e);
  }
});
after(async () => {
  await browser?.close();
  rmSync(out, { recursive: true, force: true });
});

test('parityPairs: every declared pair, and what is malformed', () => {
  const { pairs, problems } = parityPairs({
    components: {
      Badge: {
        status: 'full',
        parity: [
          { story: 'components-badge--live', props: { tone: 'success' } },
          { story: 'Badge Live' },
          { story: 'components-badge--new', expect: [{ property: 'height' }] },
        ],
      },
      Kbd: { status: 'full' },
    },
  });
  assert.deepEqual(pairs, [
    { component: 'Badge', story: 'components-badge--live', props: { tone: 'success' } },
  ]);
  assert.deepEqual(problems, [
    'Badge.parity[1]: story must be a Storybook story id',
    'Badge.parity[2]: each expect entry needs a property and a reason',
  ]);
});

test('argsParam and storyUrl: Storybook URL args, refusing what Storybook would drop', () => {
  assert.equal(
    argsParam({ children: 'Read only', pulse: true, size: 'sm', max: 2.5 }),
    'children:Read only;pulse:!true;size:sm;max:2.5'
  );
  assert.throws(() => argsParam({ href: '#' }), /holds characters Storybook's URL args drop/);
  assert.equal(
    storyUrl(
      { component: 'Badge', story: 'components-badge--live', args: { children: 'Live' } },
      'theme:dark'
    ),
    'http://storybook.parity.test/iframe.html?id=components-badge--live&viewMode=story&args=children%3ALive&globals=theme%3Adark'
  );
});

/** A side with one root span and a dot under it. */
const side = (css = {}, box = [0, 0, 40, 20], offset = 0) => ({
  tree: {
    text: 'Live',
    at: [32, 32],
    nodes: [
      {
        path: 'root',
        tag: 'span',
        text: 'Live',
        box,
        css: { 'box-sizing': 'border-box', 'padding-left': '8px', 'line-height': '9px', ...css },
        loaded: true,
      },
      { path: 'root/0', tag: 'span', text: '', box: [8, 8, 4, 4], css: {}, loaded: true },
    ],
  },
  offsets: [{ name: '<span "Live">', graphic: 'dot', offset }],
});

test('compareSides: styles, boxes and rendered offsets past their tolerances, expected ones marked', () => {
  assert.deepEqual(
    compareSides(side(), side({ 'padding-left': '8.005px' }, [0, 0, 40.4, 20], 0.3)),
    []
  );
  const d = compareSides(
    side(),
    side({ 'box-sizing': 'content-box', 'line-height': 'normal' }, [0, 0, 40, 22], 1),
    [{ property: 'height', reason: 'taller on purpose' }]
  );
  assert.deepEqual(
    d.map((x) => [x.element, x.property, x.story, x.adapter, x.expected ?? null]),
    [
      ['root <span>', 'box-sizing', 'border-box', 'content-box', null],
      ['root <span>', 'line-height', '9px', 'normal', null],
      ['root <span>', 'height', '20', '22', 'taller on purpose'],
      ['<span "Live"> dot', 'capitals to graphic', '0px', '1px', null],
    ]
  );
  const missing = side();
  missing.tree.nodes.pop();
  assert.deepEqual(
    compareSides(side(), missing).map((x) => [x.element, x.property, x.story, x.adapter]),
    [['root/0 <span>', 'element', 'span', 'none']]
  );
  assert.match(
    paritySummary(
      [
        {
          component: 'Badge',
          story: 'components-badge--live',
          theme: 'dark',
          rendered: true,
          reason: null,
          differences: d,
          measured: null,
        },
      ],
      []
    ),
    /1 of 1 differ[\s\S]*\| `root <span>` \| box-sizing \| `border-box` \| `content-box` \| \*\*differs\*\* \|[\s\S]*expected: taller on purpose/
  );
});

test('runParity: the same component on both sides matches; another padding and line height differ', async (t) => {
  if (skip) return t.skip(skip);
  const { buildParityPage } = await import('../parity-page.mjs');
  const adapter = path.join(out, 'adapter');
  await buildParityPage({ adapter: 'plain', cwd: repo, outDir: adapter });
  const page = readFileSync(path.join(adapter, 'index.html'), 'utf8');
  // A "Storybook" whose iframe.html is the parity page itself: the story is the adapter's badge.
  const same = path.join(out, 'same');
  mkdirSync(same);
  cpSync(path.join(adapter, 'assets'), path.join(same, 'assets'), { recursive: true });
  writeFileSync(path.join(same, 'iframe.html'), page);
  const conformance = {
    components: {
      Badge: {
        status: 'full',
        parity: [{ story: 'components-badge--new', props: { tone: 'warning' }, children: 'New' }],
      },
    },
    parity: { storyRoot: '[data-parity-frame] > *' },
  };
  const a = await runParity(browser, {
    conformance,
    storybook: same,
    adapter,
    outDir: path.join(out, 'a'),
    themes: ['light'],
  });
  assert.deepEqual(a.problems, []);
  assert.equal(a.results.length, 1);
  assert.equal(a.results[0].rendered, true, a.results[0].reason ?? '');
  assert.deepEqual(a.results[0].differences, []);

  // A hand-written story: the plain badge's markup with its own padding and line height.
  const html = await (async () => {
    const p = await browser.newPage();
    await p.addInitScript(() => {
      /** @type {Window & { __pxsigParity?: unknown }} */ (window).__pxsigParity = {
        component: 'Badge',
        props: { tone: 'warning' },
        children: 'New',
      };
    });
    await p.route('**', (r) => {
      const f = path.join(adapter, new URL(r.request().url()).pathname);
      return r.fulfill({ path: f });
    });
    await p.goto('http://adapter.test/index.html?theme=light');
    await p.waitForSelector('[data-parity-frame] > *');
    const outer = await p.$eval('[data-parity-frame] > *', (el) => {
      const c = /** @type {HTMLElement} */ (el.cloneNode(true));
      const cs = getComputedStyle(el);
      for (const k of [
        'display',
        'align-items',
        'box-sizing',
        'font',
        'letter-spacing',
        'text-transform',
        'border',
        'padding',
        'gap',
      ])
        c.style.setProperty(k, cs.getPropertyValue(k));
      c.style.setProperty('padding-left', '9px');
      c.style.setProperty('line-height', '20px');
      return c.outerHTML;
    });
    await p.close();
    return outer;
  })();
  const hand = path.join(out, 'hand');
  mkdirSync(hand);
  cpSync(path.join(adapter, 'assets'), path.join(hand, 'assets'), { recursive: true });
  // A static page: the parity page's markup without its script (the one tag the build writes).
  const script = '<script defer src="./assets/app.js"></script>';
  assert.ok(page.includes(script), 'the parity page loads its bundle as a classic script');
  writeFileSync(
    path.join(hand, 'iframe.html'),
    page
      .replace(
        '<div id="root"></div>',
        `<div id="storybook-root"><div style="padding:2rem">${html}</div></div>`
      )
      .replace(script, '')
  );
  const b = await runParity(browser, {
    conformance: { ...conformance, parity: { storyRoot: '#storybook-root > div > *' } },
    storybook: hand,
    adapter,
    outDir: path.join(out, 'b'),
    themes: ['light'],
  });
  const props = b.results[0].differences.map((x) => x.property);
  assert.ok(props.includes('padding-left'), JSON.stringify(b.results[0].differences));
  assert.ok(props.includes('line-height'), JSON.stringify(b.results[0].differences));
});
