/**
 * TextField (UI contract 1.5.0) in a real browser: test/harness/text-field built with the
 * dashboard's own Vite setup, once per adapter. The field is a text box named by its visible label,
 * focused on mount; typing calls back, `maxLength` caps it, Enter submits the value instead of the
 * form, and other keys (Escape) reach the caller. An adapter written for 1.4.0
 * (test/harness/text-field/older-adapter) gets the fallback. The reference adapter runs only when
 * PXSIG_DS_SOURCE names a design-system checkout. Skips when no Chromium is available.
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
const harness = path.join(here, 'harness', 'text-field');
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
  const out = mkdtempSync(path.join(tmpdir(), 'pxsig-text-field-'));
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
  // Served from the build folder at an http origin; nothing else loads.
  await page.route('**', (route) => route.abort());
  await page.route('http://text-field.test/**', (route) => {
    const file = path.join(out, new URL(route.request().url()).pathname);
    return existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404 });
  });
  await page.goto('http://text-field.test/index.html');
  await page.getByRole('textbox', { name: 'Reason' }).waitFor({ timeout: 10_000 });
  assert.deepEqual(errors, []);
  return page;
}

const log = (page) => page.evaluate(() => window.harness.log.slice());
const clear = (page) => page.evaluate(() => (window.harness.log.length = 0));

/** The contract's behaviour, the same on every adapter. */
async function checkField(page) {
  const field = page.getByRole('textbox', { name: 'Reason', exact: true });
  assert.equal(await field.count(), 1, 'one text box, named by its label');
  assert.equal(await page.getByRole('searchbox').count(), 0, 'not a search field');
  assert.equal(await page.getByText('Reason', { exact: true }).isVisible(), true, 'label shown');
  assert.equal(await field.getAttribute('placeholder'), 'One line');
  assert.equal(await field.evaluate((e) => e === document.activeElement), true, 'focused on mount');

  await page.keyboard.type('ab');
  const typed = (await log(page)).filter(([k]) => k === 'value');
  assert.deepEqual(typed, [
    ['value', 'a'],
    ['value', 'ab'],
  ]);
  await field.fill('');
  await page.keyboard.type('y'.repeat(30));
  assert.equal(await field.inputValue(), 'y'.repeat(10), 'maxLength caps typing');

  await clear(page);
  await page.keyboard.press('Enter');
  const entered = await log(page);
  assert.deepEqual(
    entered.filter(([k]) => k !== 'key'),
    [['submit', 'y'.repeat(10)]],
    'Enter submits the value, not the form'
  );

  await clear(page);
  await page.keyboard.press('Escape');
  assert.deepEqual(await log(page), [['key', 'Escape']], 'Escape reaches the caller');
}

test('the plain adapter: a labelled text field that submits on Enter', async (t) => {
  if (skip) return t.skip(skip);
  const page = await open('plain');
  assert.equal(await page.locator('.plain-field').count(), 1, 'its own field');
  await checkField(page);
  await page.close();
});

test('an adapter written for 1.4.0 gets the fallback', async (t) => {
  if (skip) return t.skip(skip);
  const page = await open(path.join(harness, 'older-adapter'));
  assert.equal(await page.locator('.plain-field').count(), 0, 'the fallback, not its own');
  await checkField(page);
  await page.close();
});

test('the reference adapter: a labelled text field that submits on Enter', async (t) => {
  if (skip) return t.skip(skip);
  if (!process.env.PXSIG_DS_SOURCE) return t.skip('PXSIG_DS_SOURCE is not set');
  const page = await open('hydrotik');
  assert.equal(await page.locator('input[data-control]').count(), 1, "the design system's Input");
  await checkField(page);
  await page.close();
});
