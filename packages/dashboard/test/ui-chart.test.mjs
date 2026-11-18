/**
 * Chart `label` and `summary` (UI contract 1.8.0). The contract: both are optional props, recorded
 * by the lock, the changes entry and every shipped adapter's conformance.json. In a real browser
 * (test/harness/chart, built with the dashboard's own Vite setup, once per adapter): each chart is
 * in the accessibility tree by its label, described by its summary, which is visually hidden text,
 * and Tab goes from the button before the charts to the one after. The reference adapter runs only
 * when PXSIG_DS_SOURCE names a design-system checkout. Skips when no Chromium is available.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { contractShape, readChanges, readLock } from '../ui-tools.mjs';
import { noChromium } from './flows-helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = path.dirname(here);
const repo = path.resolve(dashboard, '..', '..');
const harness = path.join(here, 'harness', 'chart');
const require = createRequire(path.join(dashboard, '../pxsig/package.json'));

test('the contract: Chart takes an optional label and summary, in 1.8.0', () => {
  const props = readFileSync(path.join(dashboard, 'src/ui/contract/props.ts'), 'utf8');
  const chart = props.slice(props.indexOf('export interface ChartProps'));
  const body = chart.slice(0, chart.indexOf('\n}\n'));
  assert.match(body, /\n {2}label\?: string;/);
  assert.match(body, /\n {2}summary\?: string;/);
  const now = contractShape();
  assert.equal(now.version, '1.8.0');
  assert.equal(readLock().version, '1.8.0');
  assert.equal(readLock().components.Chart.hash, now.components.Chart.hash);
  assert.match(readChanges()['1.8.0'], /`Chart` `label` and `summary`/);
  for (const file of [
    'packages/dashboard/src/ui/adapters/hydrotik/conformance.json',
    'packages/dashboard/src/ui/adapters/plain/conformance.json',
    'examples/custom-ui/pxsig-ui/conformance.json',
  ])
    assert.equal(JSON.parse(readFileSync(path.join(repo, file), 'utf8')).contract, '1.8.0', file);
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
      focusable: el.querySelectorAll('[tabindex]:not([tabindex="-1"])').length,
      application: el.querySelectorAll('[role="application"]').length,
    };
  });

/** Tab from Before lands on After: nothing in between is a tab stop. */
async function noTabStop(page) {
  await page.getByRole('button', { name: 'Before' }).focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent),
    'After',
    'the charts are not tab stops'
  );
}

/** The visually hidden summary: a 1px box, so it moves nothing. */
const hidden = (box) => assert.ok(box && box.w <= 1 && box.h <= 1, JSON.stringify(box));

test('the plain adapter: the fallback table is named by label and described by summary', async (t) => {
  if (skip) return t.skip(skip);
  const page = await open('plain');
  for (const [name, summary] of [
    ['Changed Entries per Run', 'Changed entries per run, 3 runs: 3 to 12.'],
    ['Changed by Run', 'Changed by run, 3 runs: 3 to 12.'],
  ]) {
    const d = await described(page, 'table', name);
    assert.equal(d.description, summary);
    hidden(d.box);
  }
  await noTabStop(page);
  await page.close();
});

test('the reference adapter: each chart is one image named by label and described by summary, not a tab stop', async (t) => {
  if (skip) return t.skip(skip);
  if (!process.env.PXSIG_DS_SOURCE) return t.skip('PXSIG_DS_SOURCE is not set');
  const page = await open('hydrotik');
  // The drawing is in: recharts draws once the text font has loaded.
  await page.locator('svg.recharts-surface').nth(1).waitFor({ timeout: 10_000 });
  for (const [name, summary] of [
    ['Changed Entries per Run', 'Changed entries per run, 3 runs: 3 to 12.'],
    ['Changed by Run', 'Changed by run, 3 runs: 3 to 12.'],
  ]) {
    const d = await described(page, 'img', name);
    assert.equal(d.description, summary);
    hidden(d.box);
    assert.equal(d.focusable, 0, "recharts' SVG is not a tab stop");
    assert.equal(d.application, 0, 'no role="application" inside');
  }
  assert.equal(
    await page.locator('svg[tabindex], svg[role]').count(),
    0,
    'no SVG role or tab stop'
  );
  await noTabStop(page);
  await page.close();
});
