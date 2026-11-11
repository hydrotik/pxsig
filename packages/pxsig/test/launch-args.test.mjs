// Chromium's launch arguments (lib/capture/browser.mjs): pxsig's text settings first, the project's
// capture.launchArgs after them, and both recorded in the render environment.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { browserPool, CHROMIUM_ARGS, chromiumArgs, launchBrowser } from '../src/lib/capture.mjs';
import { DEFAULTS } from '../src/lib/workspace/layers.mjs';
import { skipUnless } from './strict.mjs';
/** @import { Project } from '../src/types.js' */

const require = createRequire(import.meta.url);
// A Chromium Playwright can launch (CI installs the browser after this suite runs).
const chromium = await (async () => {
  try {
    await (await require('playwright').chromium.launch()).close();
    return true;
  } catch {
    return false;
  }
})();
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('pxsig draws text in grayscale with unhinted advances', () => {
  assert.deepEqual(CHROMIUM_ARGS, ['--disable-lcd-text', '--font-render-hinting=none']);
  assert.deepEqual(DEFAULTS.capture.launchArgs, [], 'nothing added by default');
  assert.deepEqual(chromiumArgs(null), CHROMIUM_ARGS);
  assert.deepEqual(chromiumArgs({ root }), CHROMIUM_ARGS);
});

test("the project's capture.launchArgs come after pxsig's, so the same switch is overridden", () => {
  assert.deepEqual(
    chromiumArgs({ root, config: { capture: { launchArgs: ['--font-render-hinting=full'] } } }),
    ['--disable-lcd-text', '--font-render-hinting=none', '--font-render-hinting=full']
  );
});

test('every launch passes the arguments, on each channel it falls back to', async () => {
  // A stand-in Playwright: the bundled build and Chrome fail, Edge launches.
  const dir = mkdtempSync(join(tmpdir(), 'pxsig-launch-'));
  try {
    const pw = join(dir, 'node_modules', 'playwright');
    mkdirSync(pw, { recursive: true });
    writeFileSync(join(pw, 'package.json'), '{ "name": "playwright", "main": "index.js" }');
    writeFileSync(
      join(pw, 'index.js'),
      `const seen = [];
      exports.seen = seen;
      exports.chromium = {
        launch: async (o) => {
          seen.push(o);
          if (o.channel !== 'msedge') throw new Error('not installed');
          return { close: async () => {} };
        },
      };`
    );
    const project = { root: dir, config: { capture: { launchArgs: ['--lang=en-US'] } } };
    const browser = await launchBrowser(project);
    const want = [...CHROMIUM_ARGS, '--lang=en-US'];
    const { seen } = createRequire(join(dir, 'package.json'))('playwright');
    assert.deepEqual(seen, [
      { args: want },
      { channel: 'chrome', args: want },
      { channel: 'msedge', args: want },
    ]);
    assert.equal(browser.__pxsigChannel, 'msedge');
    assert.deepEqual(browser.__pxsigLaunchArgs, want);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  'the launched Chromium draws text in grayscale, and its environment records the arguments',
  { skip: skipUnless(chromium, 'no Chromium') },
  async () => {
    const project = /** @type {Project} */ ({ root, workspaceRoot: root });
    const pool = browserPool(project, {}, { endpoint: null });
    try {
      const env = await pool.env('chromium');
      assert.deepEqual(env.browser.launchArgs, CHROMIUM_ARGS, 'recorded as browser.launchArgs');
      const page = await (await pool.get('chromium')).newPage();
      await page.setContent(
        '<body style="margin:0;background:#fff"><p style="margin:0;font:16px sans-serif;color:#000">LIVE Grayscale</p></body>'
      );
      const png = PNG.sync.read(
        await page.screenshot({ clip: { x: 0, y: 0, width: 160, height: 24 } })
      );
      await page.close();
      // LCD antialiasing paints coloured fringes; grayscale keeps every pixel's channels equal.
      let coloured = 0;
      for (let i = 0; i < png.data.length; i += 4)
        if (png.data[i] !== png.data[i + 1] || png.data[i + 1] !== png.data[i + 2]) coloured++;
      assert.equal(coloured, 0, 'no coloured text pixels');
    } finally {
      await pool.close();
    }
  }
);
