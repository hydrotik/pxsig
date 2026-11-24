/**
 * Chart `label` and `summary` (UI contract 1.9.0). The contract: both are optional props, recorded
 * by the lock, the changes entry and every shipped adapter's conformance.json. In a real browser
 * (test/harness/chart, built with the dashboard's own Vite setup, once per adapter): each chart is
 * in the accessibility tree by its label, described by its summary, hidden text that is read once.
 * The fallback table is no tab stop; the reference adapter's chart is one, its arrow keys moving
 * the tooltip. The harness also checks the dashboard's summary wording. The reference adapter runs
 * only when PXSIG_DS_SOURCE names a design-system checkout. Skips when no Chromium is available.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { contractShape, readChanges, readLock } from '../ui-tools.mjs';
import { compareVersions } from '../ui-tools/contract.mjs';
import { noChromium } from './flows-helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = path.dirname(here);
const repo = path.resolve(dashboard, '..', '..');
const harness = path.join(here, 'harness', 'chart');
const require = createRequire(path.join(dashboard, '../pxsig/package.json'));

test('the contract: Chart takes an optional label and summary, since 1.9.0', () => {
  const props = readFileSync(path.join(dashboard, 'src/ui/contract/props.ts'), 'utf8');
  const chart = props.slice(props.indexOf('export interface ChartProps'));
  const body = chart.slice(0, chart.indexOf('\n}\n'));
  assert.match(body, /\n {2}label\?: string;/);
  assert.match(body, /\n {2}summary\?: string;/);
  const now = contractShape();
  const since = (/** @type {string} */ v) => compareVersions(v, '1.9.0') >= 0;
  assert.ok(since(now.version), now.version);
  assert.equal(readLock().version, now.version);
  assert.equal(readLock().components.Chart.hash, now.components.Chart.hash);
  assert.match(readChanges()['1.9.0'], /`Chart` `label` and `summary`/);
  for (const file of [
    'packages/dashboard/src/ui/adapters/hydrotik/conformance.json',
    'packages/dashboard/src/ui/adapters/plain/conformance.json',
    'examples/custom-ui/pxsig-ui/conformance.json',
  ])
    assert.ok(since(JSON.parse(readFileSync(path.join(repo, file), 'utf8')).contract), file);
});

let browser = null;
let skip = false;
const outs = [];

before(async () => {
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch(
      process.env.PXSIG_CHROMIUM ? { executablePath: process.env.PXSIG_CHROMIUM } : {}
    );
  } catch (e) {
    skip = noChromium(e);
  }
});
after(async () => {
  await browser?.close();
  for (const out of outs) rmSync(out, { recursive: true, force: true });
});

/** The harness built with `adapter` (a built-in name), open in a new page. */
async function open(adapter) {
  const { build, version } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { vanillaExtractPlugin } = await import('@vanilla-extract/vite-plugin');
  const { dashboardConfig } = await import('../build-config.mjs');
  const out = mkdtempSync(path.join(tmpdir(), 'pxsig-chart-'));
  outs.push(out);
  const config = await dashboardConfig({
    adapter,
    cwd: repo,
    outDir: out,
    resolveFrom: [dashboard],
    react,
    vanillaExtractPlugin,
    viteVersion: version,
  });
  await build({ ...config, root: harness, configFile: false, logLevel: 'silent' });
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Served from the build folder at an http origin; nothing else loads.
  await page.route('**', (route) => route.abort());
  await page.route('http://chart.test/**', (route) => {
    const file = path.join(out, new URL(route.request().url()).pathname);
    return existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404 });
  });
  await page.goto('http://chart.test/index.html');
  await page.getByRole('button', { name: 'After' }).waitFor({ timeout: 10_000 });
  assert.deepEqual(errors, []);
  return page;
}

/** The element `role` named `name`: its description's text and box, and what it holds. */
const described = (page, role, name) =>
  page.getByRole(role, { name, exact: true }).evaluate((el) => {
    const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    const desc = ids.map((id) => document.getElementById(id));
    const box = desc[0]?.getBoundingClientRect();
    return {
      description: desc.map((d) => d?.textContent ?? '').join(' '),
      box: box ? { w: box.width, h: box.height } : null,
      tag: el.tagName.toLowerCase(),
    };
  });

/** The summary is hidden: no box, so it moves nothing. */
const hidden = (box) => assert.ok(box && box.w === 0 && box.h === 0, JSON.stringify(box));

/** Read once: the summary is the description, not also a text node in the tree. */
const readOnce = async (page, summary) =>
  assert.ok(!(await page.locator('body').ariaSnapshot()).includes(summary), summary);

const CHARTS = [
  ['Changed Entries per Run', 'Changed entries per run, 3 runs: 3 to 12.'],
  ['Changed by Run', 'Changed by run, 3 runs: 3 to 12.'],
];

test("the dashboard's summaries: ranges for lines, each value for bars, the value alone when flat, no data", async (t) => {
  if (skip) return t.skip(skip);
  const page = await open('plain');
  assert.deepEqual(await page.evaluate(() => window.harness.summaries), {
    line: 'Shown, 2: 3 to 12.',
    flat: 'Shown, 1: 3.',
    lines: 'Shown, 2: A: 1 to 2; B: 5.',
    bars: 'Shown, 2: CLI process 3 ms, Server request 120 ms.',
    groups: 'Shown, 2: S1: A 1, B 2; S2: A 3, B 4.',
    empty: 'Shown: no data.',
    noNumbers: 'Shown: no data.',
  });
  await page.close();
});

test('the plain adapter: the fallback table is named by label and described by summary, no tab stop', async (t) => {
  if (skip) return t.skip(skip);
  const page = await open('plain');
  for (const [name, summary] of CHARTS) {
    const d = await described(page, 'table', name);
    assert.equal(d.description, summary);
    hidden(d.box);
    await readOnce(page, summary);
  }
  await page.getByRole('button', { name: 'Before' }).focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'After');
  await page.close();
});

test('the reference adapter: Tab reaches each chart once, named and described, and the arrow keys move its tooltip', async (t) => {
  if (skip) return t.skip(skip);
  if (!process.env.PXSIG_DS_SOURCE) return t.skip('PXSIG_DS_SOURCE is not set');
  const page = await open('hydrotik');
  // The drawing is in: recharts draws once the text font has loaded.
  await page.locator('svg.recharts-surface').nth(1).waitFor({ timeout: 10_000 });
  for (const [name, summary] of CHARTS) {
    const d = await described(page, 'application', name);
    assert.equal(d.tag, 'svg', "the name and description are on recharts' SVG, the tab stop");
    assert.equal(d.description, summary);
    hidden(d.box);
    await readOnce(page, summary);
  }
  assert.equal(await page.getByRole('img').count(), 0, 'no image wraps the tab stop');
  // One tab stop per chart: Before, the two charts' SVGs, After.
  await page.getByRole('button', { name: 'Before' }).focus();
  const stops = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab');
    stops.push(
      await page.evaluate(() => {
        const a = document.activeElement;
        return a?.getAttribute('aria-label') ?? a?.textContent ?? null;
      })
    );
  }
  assert.deepEqual(stops, [CHARTS[0][0], CHARTS[1][0], 'After']);
  // Inside a chart, only its SVG is focusable.
  const focusables = await page.evaluate(() =>
    [...document.querySelectorAll('[data-chart]')].map(
      (c) => c.querySelectorAll('[tabindex]:not([tabindex="-1"]), a[href], button').length
    )
  );
  assert.deepEqual(focusables, [1, 1]);
  // The arrow keys move the tooltip from point to point: the line's values are 3, 12 and 7.
  const line = page.getByRole('application', { name: CHARTS[0][0] });
  const tip = page.locator('[data-chart]').first().locator('.recharts-tooltip-wrapper');
  const shows = (v) => tip.getByText(v, { exact: true }).waitFor({ timeout: 5_000 });
  await line.focus();
  await page.keyboard.press('ArrowRight');
  await shows('12');
  await page.keyboard.press('ArrowRight');
  await shows('7');
  await page.keyboard.press('ArrowLeft');
  await shows('12');
  await page.close();
});
