#!/usr/bin/env node
/// <reference lib="dom" />
/// <reference path="../packages/pxsig/src/vendor.d.ts" />
// (The DOM lib: `page.evaluate`'s callback runs in the page. vendor.d.ts: pngjs's types.)
/**
 * showcase-shots.mjs — the README's product shots, from mock data: the built dashboard served with
 * a design system mid-review (scripts/lib/showcase-data.mjs), shot and cropped.
 *
 *   node scripts/showcase-shots.mjs [--serve] [--out docs/product-shots] [--raw]
 *
 * 1. Renders the sample component the inspector compares: a project card, and the same card after
 *    a change (its status badge and buttons moved), with Playwright. The diff image
 *    and the changed regions are worked out from the two renders.
 * 2. Serves the built dashboard (packages/pxsig/dist/dashboard) on 127.0.0.1 with that data, the
 *    way `pxsig dashboard check` serves a scenario: nothing is read from or written to a store,
 *    and every POST (approve, reject, check) is answered and dropped. The page can approve.
 * 3. --serve: prints the URL and keeps serving until Ctrl+C, for shooting by hand. Otherwise, in
 *    the light theme, at 1560 CSS px wide and 2x:
 *      overview.png    the Overview, cropped to its content
 *      inspector.png   the review's first change, side by side, cropped to the dialog
 *    and compresses each losslessly with oxipng or zopflipng when one is on the PATH (--raw: no).
 *    shots.json records the version shot, which a minor or major release checks
 *    (scripts/check-shots.mjs, docs/releasing.md "Product shots").
 *
 * Needs the built dashboard (`pnpm build:dashboard`) and Playwright's Chromium. No Rust binary,
 * no example project, no network.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenarioServer } from '../packages/pxsig/src/dashboard-check/server.mjs';
import { FIRST_CHANGE, LABEL, showcaseData } from './lib/showcase-data.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const usage = () => {
  console.error('usage: node scripts/showcase-shots.mjs [--serve] [--out <dir>] [--raw]');
  process.exit(2);
};
const outAt = argv.indexOf('--out');
if (outAt >= 0 && !argv[outAt + 1]) usage();
for (const a of argv) if (a.startsWith('--') && !['--serve', '--out', '--raw'].includes(a)) usage();
const out = resolve(outAt >= 0 ? argv[outAt + 1] : join(repo, 'docs', 'product-shots'));
const dist = join(repo, 'packages', 'pxsig', 'dist', 'dashboard');
if (!existsSync(join(dist, 'index.html')))
  throw new Error('build the dashboard first: pnpm build:dashboard');
// pxsig's own Playwright and pngjs (its dependencies), required from its package.
const fromPxsig = createRequire(join(repo, 'packages', 'pxsig', 'package.json'));
const { chromium } = /** @type {import('./types-release.js').ShotsPlaywright} */ (
  fromPxsig('playwright')
);
const { PNG } = /** @type {typeof import('pngjs')} */ (fromPxsig('pngjs'));
const log = (/** @type {string} */ m) => console.log(`[showcase] ${m}`);
const VIEW = { width: 1560, height: 1000 };

const browser = await chromium.launch();
try {
  const images = await sampleImages();
  const server = await scenarioServer({
    dir: dist,
    scenario: 'showcase',
    // The fields scenarioServer reads, for the one showcase scenario.
    fixtures: /** @type {import('../packages/pxsig/src/types/t4.js').DashboardFixtures} */ (
      /** @type {unknown} */ (fixtures(images.pixels))
    ),
    images,
    posts: [],
  });
  const url = `${server.base}/report/`;
  if (argv.includes('--serve')) {
    log(`dashboard with mock data: ${url}  (Ctrl+C to stop)`);
    log('approve, reject and check are answered and dropped: nothing is stored');
    await new Promise(() => {});
  }
  try {
    await shoot(url);
  } finally {
    server.close();
  }
  // What a minor or major release checks (scripts/check-shots.mjs): the version these shots show.
  const { version } = /** @type {{ version: string }} */ (
    JSON.parse(readFileSync(join(repo, 'packages', 'pxsig', 'package.json'), 'utf8'))
  );
  const record = {
    version,
    files: ['overview.png', 'inspector.png'],
    by: 'scripts/showcase-shots.mjs',
  };
  // One line per key, as the formatter (oxfmt) keeps it.
  const lines = Object.entries(record).map(
    ([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v).replaceAll('","', '", "')}`
  );
  writeFileSync(join(out, 'shots.json'), `{\n${lines.join(',\n')}\n}\n`);
  log(`shots.json: version ${version}`);
} finally {
  await browser.close();
}

/** What scenarioServer reads from the dashboard's fixtures, for the one showcase scenario. */
function fixtures(/** @type {Parameters<typeof showcaseData>[0]} */ pixels) {
  const d = showcaseData(pixels);
  return {
    SCENARIOS: { showcase: true },
    SERVER_STATES: [],
    LOAD_ERROR: '',
    scenarioData: () => d,
    approvingOf: () => ({ allowed: true, folder: 'design-system', command: 'pxsig serve --link' }),
    projectsOf: () => [
      { name: d.project, label: LABEL, root: '.', entries: d.check.rows.length, integrity: null },
    ],
  };
}

/**
 * The inspector's images: the card, the changed card, the diff, and the changed regions.
 */
async function sampleImages() {
  const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
  const shot = async (/** @type {boolean} */ after) => {
    await page.setContent(card(after));
    return PNG.sync.read(await page.locator('#frame').screenshot());
  };
  const base = await shot(false);
  const next = await shot(true);
  await page.close();
  const { width, height } = next;
  const diff = new PNG({ width, height });
  const cell = 8;
  const cols = Math.ceil(width / cell);
  /** @type {number[]} */
  const marked = Array.from({ length: cols * Math.ceil(height / cell) }, () => 0);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inBase = y < base.height && x < base.width;
      const j = (y * base.width + x) * 4;
      const delta = inBase
        ? Math.max(...[0, 1, 2].map((k) => Math.abs(next.data[i + k] - base.data[j + k])))
        : 255;
      const hit = delta > 16;
      if (hit) marked[Math.floor(y / cell) * cols + Math.floor(x / cell)]++;
      const v = 0.25 * next.data[i] + 0.6 * next.data[i + 1] + 0.15 * next.data[i + 2];
      diff.data.set(hit ? [236, 72, 153, 255] : [v, v, v, 255].map((c) => 128 + c / 2), i);
    }
  return {
    baseline: PNG.sync.write(base),
    render: PNG.sync.write(next),
    diff: PNG.sync.write(diff),
    pixels: { width, height, baseHeight: base.height, regions: regions(marked, cols, cell) },
  };
}

/**
 * Changed cells grouped into regions (4-connected), largest first, as the engine lists them.
 * @param {number[]} marked changed pixels per cell
 * @param {number} cols
 * @param {number} cell
 */
function regions(marked, cols, cell) {
  const seen = new Set();
  /** @type {{ x: number, y: number, w: number, h: number, px: number }[]} */
  const found = [];
  marked.forEach((n, start) => {
    if (!n || seen.has(start)) return;
    let [x0, y0, x1, y1, px] = [Infinity, Infinity, 0, 0, 0];
    const todo = [start];
    seen.add(start);
    while (todo.length) {
      const c = /** @type {number} */ (todo.pop());
      const [cx, cy] = [c % cols, Math.floor(c / cols)];
      [x0, y0, x1, y1, px] = [
        Math.min(x0, cx),
        Math.min(y0, cy),
        Math.max(x1, cx),
        Math.max(y1, cy),
        px + marked[c],
      ];
      for (const nb of [c - cols, c + cols, cx > 0 ? c - 1 : -1, cx < cols - 1 ? c + 1 : -1])
        if (nb >= 0 && marked[nb] && !seen.has(nb)) {
          seen.add(nb);
          todo.push(nb);
        }
    }
    found.push({
      x: x0 * cell,
      y: y0 * cell,
      w: (x1 - x0 + 1) * cell,
      h: (y1 - y0 + 1) * cell,
      px,
    });
  });
  return found.sort((a, b) => b.px - a.px);
}

/**
 * The sample component: a project card. `after` moves the status badge into the footer and the
 * buttons down a row, the kind of change a reviewer should catch.
 * @param {boolean} after
 */
function card(after) {
  const c = { page: '#f4f5f7', bg: '#ffffff', line: '#e2e4e9', text: '#16181d', muted: '#5b6170' };
  const badge = `<span style="font:600 10px/1 ui-monospace,monospace;letter-spacing:.08em;padding:4px 7px;border-radius:4px;background:#1f7a3d;color:#fff">LIVE</span>`;
  const avatar = (/** @type {string} */ t, /** @type {string} */ bg, /** @type {number} */ i) =>
    `<span style="display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:${bg};color:#fff;font:600 11px system-ui;border:2px solid ${c.bg};margin-left:${i ? -8 : 0}px">${t}</span>`;
  const button = (/** @type {string} */ t, /** @type {boolean} */ primary) =>
    `<span style="font:500 13px system-ui;padding:7px 12px;border-radius:6px;${primary ? 'background:#2f5bea;color:#fff' : `border:1px solid ${c.line};color:${c.text}`}">${t}</span>`;
  return `<!doctype html><body style="margin:0;background:${c.page}">
<div id="frame" style="padding:16px;display:inline-block;background:${c.page}">
 <div style="width:360px;padding:20px;border:1px solid ${c.line};border-radius:10px;background:${c.bg};font-family:system-ui;color:${c.text}">
  <div style="display:flex;justify-content:space-between;align-items:center">
   <strong style="font-size:17px">Billing service</strong>${after ? '' : badge}
  </div>
  <p style="margin:10px 0 14px;font-size:13px;line-height:1.45;color:${c.muted}">Invoices, payment retries and the monthly statement export.</p>
  <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:13px;align-items:center">
   <span style="color:${c.muted}">Updated</span><span>2 hours ago</span>
   <span style="color:${c.muted}">Owners</span><span>${avatar('AM', '#2f5bea', 0)}${avatar('LP', '#7c3aed', 1)}${avatar('SO', '#1f7a3d', 2)}</span>
  </div>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:${after ? 22 : 16}px">
   <span>${after ? badge : ''}</span><span style="display:flex;gap:8px">${button('Settings', false)}${button('Open project', true)}</span>
  </div>
 </div>
</div></body>`;
}

/**
 * The Overview and the first change of the review, in the light theme, cropped.
 * @param {string} url
 */
async function shoot(url) {
  mkdirSync(out, { recursive: true });
  const ctx = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: 2,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  // The inspector's stored view: side by side, with the changed regions drawn.
  await ctx.addInitScript(() =>
    localStorage.setItem(
      'pxsig-inspector',
      JSON.stringify({ mode: 'side', boxes: true, highlight: true, tiles: false })
    )
  );
  const page = await ctx.newPage();
  const settle = async () => {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(800);
    await page.mouse.move(0, VIEW.height - 1); // no hover state in the frame
  };
  await page.goto(`${url}?theme=light#overview`);
  await settle();
  // The Overview: the full width, down to its lowest card and a margin.
  const bottom = await page.evaluate(() =>
    Math.max(
      ...[...document.querySelectorAll('main *')].map((e) => e.getBoundingClientRect().bottom)
    )
  );
  await page.setViewportSize({ width: VIEW.width, height: Math.ceil(bottom) + 24 });
  await settle();
  await save(page, 'overview.png');

  // The inspector: start the review, as the header button does, and crop to the dialog.
  await page.setViewportSize({ width: VIEW.width, height: 860 });
  await page.getByRole('button', { name: /^Review \d+ changes?$/ }).click();
  const dialog = page.getByRole('dialog').first();
  await dialog.waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  await page.keyboard.press('f'); // the whole card, not zoomed to the first change
  await settle();
  const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (
    await dialog.boundingBox()
  );
  const pad = 8;
  const clip = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: Math.min(VIEW.width, box.width + 2 * pad),
    height: Math.min(860, box.height + 2 * pad),
  };
  if (!(await page.getByText(FIRST_CHANGE, { exact: true }).count()))
    log(`warning: the inspector did not open on ${FIRST_CHANGE}`);
  await save(page, 'inspector.png', clip);
  await ctx.close();
}

/**
 * @param {import('./types-release.js').ShotsPage} page
 * @param {string} name
 * @param {{ x: number, y: number, width: number, height: number }} [clip]
 */
async function save(page, name, clip) {
  const file = join(out, name);
  writeFileSync(file, await page.screenshot(clip ? { clip } : {}));
  const has = (/** @type {string} */ t) =>
    spawnSync(t, ['--help'], { stdio: 'ignore' }).error === undefined;
  if (argv.includes('--raw')) {
    // (no compression)
  } else if (has('oxipng'))
    spawnSync('oxipng', ['-o', '4', '--strip', 'safe', file], { stdio: 'ignore' });
  else if (has('zopflipng')) spawnSync('zopflipng', ['-y', file, file], { stdio: 'ignore' });
  log(
    `${file.startsWith(repo) ? file.slice(repo.length) : name} · ${(statSync(file).size / 1024).toFixed(0)} KB`
  );
}
