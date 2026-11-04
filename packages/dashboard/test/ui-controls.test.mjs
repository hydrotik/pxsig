/**
 * `disabled` on Switch and Slider (UI contract 1.2.0) in a real browser: test/harness/controls built
 * with the dashboard's own Vite setup, once per adapter. A disabled control stays in the
 * accessibility tree, announced as disabled, and neither a click nor a key changes it. An adapter
 * written for 1.1.0 (test/harness/controls/older-adapter) gets the fallback while disabled. The
 * reference adapter runs only when PXSIG_DS_SOURCE names a design-system checkout. Skips when no
 * Chromium is available.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { noChromium } from './flows-helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = path.dirname(here);
const repo = path.resolve(dashboard, '..', '..');
const harness = path.join(here, 'harness', 'controls');
const require = createRequire(path.join(dashboard, '../pxsig/package.json'));

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

/** The harness built with `adapter` (a built-in name or a path), open in a new page. */
async function open(adapter) {
  const { build, version } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { vanillaExtractPlugin } = await import('@vanilla-extract/vite-plugin');
  const { dashboardConfig } = await import('../build-config.mjs');
  const out = mkdtempSync(path.join(tmpdir(), 'pxsig-controls-'));
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
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Served from the build folder at an http origin (the page reads its own URL); nothing else loads.
  await page.route('**', (route) => route.abort());
  await page.route('http://controls.test/**', (route) => {
    const file = path.join(out, new URL(route.request().url()).pathname);
    return existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404 });
  });
  await page.goto('http://controls.test/index.html');
  await page
    .waitForFunction(() => document.querySelector('#root')?.childElementCount || null, null, {
      timeout: 10_000,
    })
    .catch(() => {});
  assert.deepEqual(errors, []);
  await page.getByRole('switch', { name: 'Regions' }).waitFor();
  return page;
}

const log = (page) => page.evaluate(() => window.harness.log.slice());
const mount = (page, disabled) => page.evaluate((d) => window.harness.mount(d), disabled);

/** Enabled, both controls change; disabled, both are announced as such and nothing changes them. */
async function checkDisabled(page) {
  const sw = page.getByRole('switch', { name: 'Regions' });
  const sl = page.getByRole('slider', { name: 'Tolerance' });
  await sw.click();
  await sl.focus();
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await log(page), [
    ['switch', true],
    ['slider', 6],
  ]);

  await mount(page, true);
  assert.equal(await page.getByRole('switch', { name: 'Regions', disabled: true }).count(), 1);
  assert.equal(await page.getByRole('slider', { name: 'Tolerance', disabled: true }).count(), 1);
  await sw.click({ force: true });
  await sw.press('Space').catch(() => {});
  await sl.click({ force: true });
  await sl.press('ArrowRight').catch(() => {});
  assert.deepEqual(await log(page), [], 'a disabled control does not call back');
  assert.equal(await sw.getAttribute('aria-checked').then((v) => v ?? 'false'), 'false');
  assert.equal(await sw.isChecked(), false);
}

/** The opacity of the slider's one-line control (`data-control`). */
const rowOpacity = (page) =>
  page
    .locator('[data-control]')
    .first()
    .evaluate((e) => getComputedStyle(e).opacity);

test('the fallbacks: a disabled Switch and Slider are announced and do not change', async (t) => {
  if (skip) return t.skip(skip);
  const page = await open('plain');
  assert.equal(await rowOpacity(page), '1');
  await checkDisabled(page);
  assert.equal(await rowOpacity(page), '0.5', 'the whole slider line dims');
  await page.close();
});

test('an adapter written for 1.1.0 gets the fallback while its control is disabled', async (t) => {
  if (skip) return t.skip(skip);
  const page = await open(path.join(harness, 'older-adapter'));
  assert.equal(await page.locator('[data-own]').count(), 2, 'enabled: its own controls');
  await checkDisabled(page);
  assert.equal(await page.locator('[data-own]').count(), 0, 'disabled: the fallbacks');
  await mount(page, false);
  assert.equal(await page.locator('[data-own]').count(), 2, 'enabled again: its own controls');
  await page.close();
});

test('the reference adapter: a disabled Switch and Slider are announced and do not change', async (t) => {
  if (skip) return t.skip(skip);
  if (!process.env.PXSIG_DS_SOURCE) return t.skip('PXSIG_DS_SOURCE is not set');
  const page = await open('hydrotik');
  await checkDisabled(page);
  assert.equal(await rowOpacity(page), '0.5', 'the whole slider line dims');
  const track = page.locator('[data-control] > :nth-child(2)');
  assert.equal(
    await track.evaluate((e) => getComputedStyle(e).opacity),
    '1',
    "the track's own dimming does not compound"
  );
  await page.close();
});
