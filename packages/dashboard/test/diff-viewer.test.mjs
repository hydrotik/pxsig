/**
 * The diff-viewer primitives in a real browser: ARIA, keyboard, controlled and uncontrolled state,
 * data attributes and the probe. Builds test/harness with Vite, then drives it with Playwright.
 * Skips when no Chromium is available (PXSIG_CHROMIUM names an executable to use instead).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = path.dirname(here);
const require = createRequire(path.join(dashboard, '../pxsig/package.json'));

let browser = null;
let page = null;
let skip = false;
let out = null;

before(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
    browser = await chromium.launch(
      process.env.PXSIG_CHROMIUM ? { executablePath: process.env.PXSIG_CHROMIUM } : {}
    );
  } catch (e) {
    skip = `no Chromium (${String(e.message).split('\n')[0]})`;
    return;
  }
  const { build, version } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  out = mkdtempSync(path.join(tmpdir(), 'pxsig-dv-'));
  await build({
    configFile: false,
    root: path.join(here, 'harness'),
    logLevel: 'silent',
    plugins: [react()],
    resolve: { dedupe: ['react', 'react-dom'] },
    build: {
      outDir: out,
      emptyOutDir: true,
      minify: false,
      rollupOptions: {
        output: {
          format: 'iife',
          // From vite 8 (Rolldown) an IIFE is one chunk already; the option only warns there.
          ...(Number(version.split('.')[0]) >= 8 ? {} : { inlineDynamicImports: true }),
          entryFileNames: 'app.js',
        },
      },
    },
  });
  const js = readFileSync(
    path.join(
      out,
      readdirSync(out).find((f) => f === 'app.js')
    ),
    'utf8'
  );
  page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent(
    '<!doctype html><html><head></head><body><div id="root"></div></body></html>'
  );
  await page.addScriptTag({ content: js });
  await page.waitForSelector('[role="radiogroup"]');
  assert.deepEqual(errors, []);
});
after(async () => {
  await browser?.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

const mount = (o) =>
  page.evaluate((o) => window.harness.mount(o), o).then(() => page.waitForTimeout(50));
/** The callbacks so far, without the zoom reports every layout makes. */
const log = (all = false) =>
  page
    .evaluate(() => window.harness.log.map((x) => [...x]))
    .then((l) => (all ? l : l.filter(([k]) => k !== 'zoom')));
const checked = () => page.$eval('[role="radio"][aria-checked="true"]', (el) => el.dataset.mode);

test('ARIA: radiogroup, slider, stage, decorative regions, live zoom', async (t) => {
  if (skip) return t.skip(skip);
  await mount({});
  assert.equal(await page.getAttribute('[role="radiogroup"]', 'aria-label'), 'View');
  assert.equal(await page.locator('[role="radio"]').count(), 5);
  assert.deepEqual(
    await page.$$eval('[role="radio"]', (els) => els.map((e) => e.tabIndex)),
    [0, -1, -1, -1, -1]
  );
  assert.equal(
    await page.getAttribute('[role="group"][aria-label="Image stage"]', 'tabindex'),
    '0'
  );
  assert.equal(await page.getAttribute('[role="slider"]', 'aria-valuenow'), '50');
  assert.equal(await page.getAttribute('[role="slider"]', 'aria-label'), 'Swipe');
  assert.equal(await page.getAttribute('svg', 'aria-hidden'), 'true');
  assert.equal(await page.getAttribute('output[aria-live]', 'aria-live'), 'polite');
  assert.equal(await page.locator('[data-marker]').evaluate((m) => m.hidden), true);
});

test('keyboard: arrows move and select the mode; Home / End jump', async (t) => {
  if (skip) return t.skip(skip);
  await mount({});
  await page.focus('[role="radio"][aria-checked="true"]');
  await page.keyboard.press('ArrowRight');
  assert.equal(await checked(), 'swipe');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.mode), 'swipe');
  await page.keyboard.press('End');
  assert.equal(await checked(), 'heat');
  await page.keyboard.press('ArrowRight');
  assert.equal(await checked(), 'side', 'wraps to the first');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await checked(), 'heat');
  await page.keyboard.press('Home');
  assert.equal(await checked(), 'side');
  assert.equal(
    await page.getAttribute('[role="group"][aria-label="Image stage"]', 'data-mode'),
    'side'
  );
});

test('keyboard: the swipe slider steps by 2, Home / End reach the ends', async (t) => {
  if (skip) return t.skip(skip);
  await mount({});
  await page.focus('[role="slider"]');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getAttribute('[role="slider"]', 'aria-valuenow'), '52');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.getAttribute('[role="slider"]', 'aria-valuenow'), '48');
  await page.keyboard.press('Home');
  assert.equal(await page.getAttribute('[role="slider"]', 'aria-valuenow'), '0');
  await page.keyboard.press('End');
  assert.equal(await page.getAttribute('[role="slider"]', 'aria-valuenow'), '100');
  assert.equal(
    await page.$eval('canvas[data-kind="latest"]', (c) => c.style.clipPath),
    'inset(0px 0% 0px 0px)'
  );
});

test('keyboard: + / − / 0 on the focused stage zoom, and the level is announced', async (t) => {
  if (skip) return t.skip(skip);
  await mount({});
  await page.evaluate(() => window.harness.actions.current.zoomTo(1));
  await page.waitForTimeout(30);
  assert.equal(await page.textContent('output[aria-live]'), '100%');
  await page.focus('[aria-label="Image stage"]');
  await page.keyboard.press('+');
  assert.equal(await page.textContent('output[aria-live]'), '150%');
  await page.keyboard.press('-');
  assert.equal(await page.textContent('output[aria-live]'), '100%');
  await page.keyboard.press('+');
  await page.keyboard.press('0');
  assert.equal(await page.textContent('output[aria-live]'), '100%');
  assert.equal(
    await page.$eval('[aria-label="Image stage"]', (el) => el.style.getPropertyValue('--dv-zoom')),
    '1'
  );
  await page.click('button[aria-label="Zoom in"]');
  assert.equal(await page.textContent('output[aria-live]'), '150%');
  assert.equal(
    await page.$eval('[aria-label="Image stage"]', (el) => el.style.getPropertyValue('--dv-zoom')),
    '1.5'
  );
  assert.ok((await log(true)).some(([k, v]) => k === 'zoom' && v === 1.5));
});

test('controlled: the mode and split follow their props, and changes are only requested', async (t) => {
  if (skip) return t.skip(skip);
  await mount({ mode: 'onion', split: 30 });
  assert.equal(await checked(), 'onion');
  await page.click('[role="radio"][data-mode="diff"]');
  assert.deepEqual(await log(), [['mode', 'diff']]);
  assert.equal(await checked(), 'onion', 'a controlled mode does not change by itself');
  await page.focus('[role="slider"]');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getAttribute('[role="slider"]', 'aria-valuenow'), '30');
  assert.deepEqual((await log()).at(-1), ['split', 32]);
  await mount({ mode: 'diff', split: 32 });
  assert.equal(await checked(), 'diff');
  assert.equal(await page.getAttribute('[role="slider"]', 'aria-valuenow'), '32');
});

test('uncontrolled: the mode changes on click and still reports it', async (t) => {
  if (skip) return t.skip(skip);
  await mount({});
  await page.click('[role="radio"][data-mode="heat"]');
  assert.equal(await checked(), 'heat');
  assert.deepEqual(await log(), [['mode', 'heat']]);
  assert.match(
    await page.getAttribute('[aria-label="Image stage"]', 'class'),
    /stage-heat/,
    'className as a function of state'
  );
});

test('regions: the active one is marked; tiles are drawn', async (t) => {
  if (skip) return t.skip(skip);
  await mount({ activeRegion: 1 });
  assert.deepEqual(
    await page.$$eval('svg rect:not([data-tile])', (rs) =>
      rs.map((r) => r.hasAttribute('data-active'))
    ),
    [false, true]
  );
  assert.equal(await page.locator('svg rect[data-tile]').count(), 1);
});

test('probe: the pixel under the pointer, with both images’ values, and the marker', async (t) => {
  if (skip) return t.skip(skip);
  await mount({});
  await page.evaluate(() => window.harness.actions.current.zoomTo(4));
  await page.waitForTimeout(30);
  const box = await page.locator('[data-pane]').boundingBox();
  const { tx, ty } = await page.$eval('[aria-label="Image stage"]', (el) => ({
    tx: parseFloat(el.style.getPropertyValue('--dv-tx')),
    ty: parseFloat(el.style.getPropertyValue('--dv-ty')),
  }));
  await page.mouse.move(box.x + tx + 11 * 4 + 1, box.y + ty + 6 * 4 + 1);
  assert.equal(await page.textContent('#probe'), '11,6 0/0/0/255 255/0/0/255');
  assert.equal(
    await page
      .locator('[data-marker]')
      .evaluate((m) => !m.hidden && m.hasAttribute('data-visible')),
    true
  );
  await page.mouse.move(box.x + box.width + 50, box.y);
  assert.equal(await page.textContent('#probe'), 'none');
});
