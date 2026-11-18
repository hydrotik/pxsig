/**
 * The top bar in a real browser, on every adapter pxsig ships: the plain example
 * (examples/custom-ui/pxsig-ui), the built-in `plain`, and the reference adapter (`hydrotik`)
 * when its design system is checked out (PXSIG_DS_SOURCE names a folder, or target/design-system
 * holds the pinned one; skipped otherwise). Each is built and served with the sample scenarios, as
 * `pxsig dashboard check` serves them, and read only through roles, the box model and
 * `pxsig-ui-TopNav`:
 *
 *   - one line from 1440 down to 390 CSS px and back, every section once in the bar or More, Help
 *     kept, nothing clipped or covered (the `top-bar` rule's sweep);
 *   - More as a menu button from the keyboard, named by NavList's `moreLabel` where the adapter's
 *     conformance.json says it takes it (`topBar.moreLabel`);
 *   - an open More closing when the bar widens until it is empty, and staying closed after;
 *   - each count's digits in its tone's colour.
 *
 * Skips when no Chromium is available (PXSIG_CHROMIUM names an executable).
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as fixtures from '../fixtures/scenarios.mjs';
import { noChromium } from './flows-helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = path.dirname(here);
const repo = path.resolve(dashboard, '..', '..');
const require = createRequire(path.join(dashboard, '../pxsig/package.json'));
const { sampleImages, scenarioServer } = await import('../../pxsig/src/dashboard-check/server.mjs');
const { sweepTopBar, topBarFindings } = await import('../../pxsig/src/dashboard-check/top-bar.mjs');
const copy = JSON.parse(readFileSync(path.join(dashboard, 'src', 'copy', 'en.json'), 'utf8'));

/** The design-system checkout the reference adapter builds on, or null. */
function designSystem() {
  const named = process.env.PXSIG_DS_SOURCE;
  if (named && existsSync(named) && statSync(named).isDirectory()) return named;
  const dir = process.env.PXSIG_DS_DIR
    ? path.resolve(repo, process.env.PXSIG_DS_DIR)
    : path.join(repo, 'target', 'design-system');
  return existsSync(path.join(dir, 'packages')) && existsSync(path.join(dir, 'node_modules'))
    ? dir
    : null;
}

const ADAPTERS = [
  {
    name: 'example',
    adapter: path.join(repo, 'examples/custom-ui/pxsig-ui'),
    dir: path.join(repo, 'examples/custom-ui/pxsig-ui'),
  },
  { name: 'plain', adapter: 'plain', dir: path.join(dashboard, 'src/ui/adapters/plain') },
  {
    name: 'hydrotik',
    adapter: 'hydrotik',
    dir: path.join(dashboard, 'src/ui/adapters/hydrotik'),
    ds: true,
  },
];

let browser = null;
let skip = false;
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
});

/** Build an adapter with the dashboard's own Vite setup into a fresh folder. */
async function buildWith(adapter, ds) {
  const { build, version } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { vanillaExtractPlugin } = await import('@vanilla-extract/vite-plugin');
  const { dashboardConfig } = await import('../build-config.mjs');
  const outDir = mkdtempSync(path.join(tmpdir(), 'pxsig-top-bar-'));
  const saved = process.env.PXSIG_DS_SOURCE;
  // The reference adapter's build reads its checkout from PXSIG_DS_SOURCE.
  if (ds) process.env.PXSIG_DS_SOURCE = ds;
  try {
    // The served build (ES-module chunks), as at the top of `pxsig dashboard build`'s output.
    const config = await dashboardConfig({
      adapter,
      cwd: repo,
      outDir,
      resolveFrom: [dashboard],
      react,
      vanillaExtractPlugin,
      viteVersion: version,
    });
    await build({ ...config, configFile: false, logLevel: 'silent' });
  } finally {
    if (ds && saved === undefined) delete process.env.PXSIG_DS_SOURCE;
    else if (ds) process.env.PXSIG_DS_SOURCE = saved;
  }
  return outDir;
}

for (const a of ADAPTERS) {
  describe(`the top bar on the ${a.name} adapter`, () => {
    const ds = a.ds ? designSystem() : null;
    const why = () =>
      skip ||
      (a.ds && !ds ? 'no design-system checkout (PXSIG_DS_SOURCE, target/design-system)' : null);
    const declared =
      JSON.parse(readFileSync(path.join(a.dir, 'conformance.json'), 'utf8')).topBar ?? {};
    let out = null;
    const servers = [];
    before(async () => {
      if (!why()) out = await buildWith(a.adapter, ds);
    });
    after(() => {
      for (const s of servers) s.close();
      if (out) rmSync(out, { recursive: true, force: true });
    });
    /** A page on `scenario` at `width`, its page errors collected. */
    const open = async (scenario, width) => {
      const server = await scenarioServer({
        dir: out,
        scenario,
        fixtures,
        images: sampleImages(),
        posts: [],
      });
      servers.push(server);
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${server.base}/report/?theme=dark#overview`);
      await page.locator('.pxsig-ui-TopNav').waitFor();
      await page.evaluate(() => document.fonts?.ready);
      return { page, errors };
    };

    for (const scenario of ['changed', 'several-projects'])
      test(`${scenario}: one line from 1440 to 390px and back, every section reachable`, async (t) => {
        if (why()) return t.skip(why());
        const { page, errors } = await open(scenario, 1440);
        try {
          const found = topBarFindings(scenario, await sweepTopBar(page));
          assert.deepEqual(
            found.map((f) => f.text),
            []
          );
          assert.deepEqual(errors, []);
        } finally {
          await page.close();
        }
      });

    test('More is a menu button: Enter, Space and the arrows open it, Escape and Tab close it', async (t) => {
      if (why()) return t.skip(why());
      const { page, errors } = await open('changed', 800);
      try {
        const more = page.locator('.pxsig-ui-TopNav [aria-haspopup="menu"]:visible').first();
        assert.equal(await more.getAttribute('aria-expanded'), 'false');
        const label = await more.evaluate(
          (b) => b.getAttribute('aria-label') ?? b.textContent?.trim() ?? ''
        );
        if (declared.moreLabel === true) assert.equal(label, copy.app.moreSections, 'moreLabel');
        else assert.ok(label, 'the trigger has a name');
        const menu = page.locator('[role="menu"]:visible').first();
        // A menu item's section: its own href, or its link's.
        const focused = () =>
          page.evaluate(() => {
            const i = document.activeElement?.closest('[role="menuitem"]');
            return i
              ? ((i.matches('a') ? i : i.querySelector('a'))?.getAttribute('href') ?? null)
              : null;
          });
        // A design system's menu may move focus a frame after the key: wait for it.
        const focusOn = async (href, what) => {
          for (let i = 0; i < 40 && (await focused()) !== href; i++) await page.waitForTimeout(25);
          assert.equal(await focused(), href, what);
        };
        const onTrigger = () =>
          more.evaluate((b) => b === document.activeElement || b.contains(document.activeElement));
        const opened = async (key) => {
          await more.focus();
          await page.keyboard.press(key);
          await menu.waitFor();
          await page.waitForFunction(() => !!document.activeElement?.closest('[role="menuitem"]'));
          return menu.evaluate((m) =>
            [...m.querySelectorAll('[role="menuitem"]')].map(
              (i) => (i.matches('a') ? i : i.querySelector('a'))?.getAttribute('href') ?? null
            )
          );
        };
        const close = async () => {
          await page.keyboard.press('Escape');
          await menu.waitFor({ state: 'hidden' });
          assert.ok(await onTrigger(), 'Escape returns focus to More');
          assert.equal(await more.getAttribute('aria-expanded'), 'false');
        };
        for (const key of ['Enter', ' ', 'ArrowDown']) {
          const items = await opened(key);
          await focusOn(items[0], `${JSON.stringify(key)} opens on the first item`);
          assert.equal(await more.getAttribute('aria-expanded'), 'true');
          await close();
        }
        const items = await opened('ArrowUp');
        await focusOn(items.at(-1), 'ArrowUp opens on the last item');
        await page.keyboard.press('ArrowDown');
        await focusOn(items[0], 'the arrows wrap');
        await page.keyboard.press('ArrowUp');
        await focusOn(items.at(-1), 'the arrows wrap back');
        await page.keyboard.press('Home');
        await focusOn(items[0]);
        await page.keyboard.press('End');
        await focusOn(items.at(-1));
        await close();
        await opened('Enter');
        await page.keyboard.press('Tab');
        await menu.waitFor({ state: 'hidden' });
        assert.equal(await focused(), null, 'Tab closes the menu and leaves it');
        // Choosing an item goes to its section and closes the menu; More is then marked current.
        await more.click();
        const last = menu.locator('[role="menuitem"]').last();
        const href = await last.evaluate(
          (i) => (i.matches('a') ? i : i.querySelector('a'))?.getAttribute('href') ?? null
        );
        await last.click();
        await page
          .locator('[role="menu"]:visible')
          .waitFor({ state: 'detached' })
          .catch(() => {});
        assert.equal(await page.locator('[role="menu"]:visible').count(), 0);
        assert.equal(await page.evaluate(() => location.hash), href);
        // The section is current; where it is still in More, More says so.
        await page.waitForTimeout(200);
        const inBar = await page.locator(`.pxsig-ui-TopNav a[href="${href}"]:visible`).count();
        if (!inBar)
          assert.ok(
            await more.evaluate((b) => b.matches('[data-current], [data-active], [aria-current]')),
            'More is marked current while it holds the current section'
          );
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });

    test('an open More closes when the bar widens until every section fits, and stays closed', async (t) => {
      if (why()) return t.skip(why());
      const { page, errors } = await open('changed', 800);
      try {
        const more = page.locator('.pxsig-ui-TopNav [aria-haspopup="menu"]:visible').first();
        await more.click();
        await page.locator('[role="menu"]:visible').first().waitFor();
        // Wide enough for every section: More is hidden, and its menu must not stay on screen.
        await page.setViewportSize({ width: 1920, height: 900 });
        await page.waitForTimeout(300);
        assert.equal(
          await page.locator('.pxsig-ui-TopNav [aria-haspopup="menu"]:visible').count(),
          0,
          'every section fits at 1920px'
        );
        assert.equal(await page.locator('[role="menu"]:visible').count(), 0, 'no menu left open');
        // Narrower again: More is back, closed.
        await page.setViewportSize({ width: 800, height: 900 });
        await page.waitForTimeout(300);
        assert.equal(await more.getAttribute('aria-expanded'), 'false');
        assert.equal(await page.locator('[role="menu"]:visible').count(), 0, 'More stays closed');
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });

    test("a count's digits take its tone: info the accent, neutral a grey", async (t) => {
      if (why()) return t.skip(why());
      const { page, errors } = await open('changed', 1440);
      try {
        // In the changed scenario Review Stories counts what to review (info), Runs its runs (neutral).
        const counts = await page.locator('.pxsig-ui-TopNav').evaluate((nav) => {
          const probe = document.createElement('span');
          nav.append(probe);
          const colour = (v) => ((probe.style.color = `var(${v})`), getComputedStyle(probe).color);
          const accent = colour('--pxsig-color-accent');
          probe.remove();
          // A neutral count: no hue of its own (the text colour, or a grey beside it).
          const grey = (c) => {
            const v = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
            const k = c.startsWith('color(') ? 255 : 1;
            return v.length === 3 && Math.max(...v) * k - Math.min(...v) * k < 24;
          };
          const want = { info: (c) => c === accent, neutral: (c) => c !== accent && grey(c) };
          return Object.entries({ '#stories': 'info', '#history': 'neutral' }).map(
            ([href, tone]) => {
              const walk = document.createTreeWalker(
                nav.querySelector(`a[href="${href}"]`),
                NodeFilter.SHOW_TEXT
              );
              let digits = null;
              for (let n = walk.nextNode(); n && !digits; n = walk.nextNode())
                if (/^\d+\+?$/.test(n.textContent?.trim() ?? '')) digits = n.parentElement;
              return { href, tone, ok: !!digits && want[tone](getComputedStyle(digits).color) };
            }
          );
        });
        assert.deepEqual(
          counts.filter((c) => !c.ok),
          [],
          'every count in its tone colour'
        );
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });
  });
}
