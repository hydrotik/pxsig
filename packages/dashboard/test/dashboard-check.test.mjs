/**
 * `pxsig dashboard check` on the plain example adapter (examples/custom-ui), in a real browser:
 * every screen renders in both themes beside a reference, a broken component fails its screens,
 * axe is advisory unless --strict, a decision is answered and never written, and nothing lands
 * outside --out. Skips when no Chromium is available (PXSIG_CHROMIUM names an executable).
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { noChromium } from './flows-helpers.mjs';
import { scenarioData, scenarioNames } from '../fixtures/scenarios.mjs';
import { screenProblems } from '../ui-tools.mjs';
import { copyTree } from '../../../scripts/lib/copy-tree.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = path.dirname(here);
const repo = path.resolve(dashboard, '..', '..');
const require = createRequire(path.join(dashboard, '../pxsig/package.json'));
const { CheckSetupError, dashboardCheck, isDashboardBuild } =
  await import('../../pxsig/src/dashboard-check.mjs');
const catalogue = JSON.parse(
  readFileSync(path.join(dashboard, 'fixtures', 'screens.json'), 'utf8')
);

let browser = null;
let skip = false;
let tmp = null;
let good = null;
let broken = null;
let reference = null;

/** Build an adapter folder with the dashboard's own Vite setup, as flows.test.mjs does. */
async function buildWith(adapterDir, outDir) {
  const { build, version } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { vanillaExtractPlugin } = await import('@vanilla-extract/vite-plugin');
  const { dashboardConfig } = await import('../build-config.mjs');
  const { classicScript } = await import('../postbuild.mjs');
  const config = await dashboardConfig({
    adapter: adapterDir,
    cwd: repo,
    outDir,
    resolveFrom: [dashboard],
    react,
    vanillaExtractPlugin,
    viteVersion: version,
  });
  await build({ ...config, configFile: false, logLevel: 'silent' });
  classicScript(outDir);
  return outDir;
}

before(async () => {
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch(
      process.env.PXSIG_CHROMIUM ? { executablePath: process.env.PXSIG_CHROMIUM } : {}
    );
  } catch (e) {
    skip = noChromium(e);
    return;
  }
  tmp = mkdtempSync(path.join(tmpdir(), 'pxsig-dashboard-check-'));
  good = await buildWith(path.join(repo, 'examples/custom-ui/pxsig-ui'), path.join(tmp, 'good'));
  // The reference column: the same build in another folder (the prebuilt one needs the private
  // design system, so the test stands in for it).
  reference = path.join(tmp, 'reference');
  copyTree(good, reference);
  // A broken adapter: its Card throws, so every screen with a card fails.
  const brokenUi = path.join(tmp, 'broken-ui');
  copyTree(path.join(repo, 'examples/custom-ui/pxsig-ui'), brokenUi);
  const index = path.join(brokenUi, 'index.tsx');
  const text = readFileSync(index, 'utf8');
  const marked = text.replace(/export (const|function) Card\b/, (m) => `${m}__Unused`);
  assert.notEqual(marked, text, 'the example adapter exports Card');
  writeFileSync(
    index,
    `${marked}\nexport function Card(): never {\n  throw new Error('sample: this Card is broken');\n}\n`
  );
  broken = await buildWith(brokenUi, path.join(tmp, 'broken'));
});
after(async () => {
  await browser?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const run = (flags, opts = {}) =>
  dashboardCheck(flags, opts.cwd ?? tmp, { log: () => {}, browser, ...opts });
const tree = (dir) =>
  existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).sort() : [];

test('the sample data is the same on every run, and every scenario a screen names exists', () => {
  for (const n of scenarioNames())
    assert.equal(JSON.stringify(scenarioData(n)), JSON.stringify(scenarioData(n)), n);
  for (const f of catalogue.features) assert.deepEqual(screenProblems(f), [], f.id);
  assert.deepEqual(
    screenProblems({ id: 'x.y', states: {}, screens: [] }).length,
    1,
    'a feature without a screen is a problem'
  );
  assert.match(
    screenProblems({
      id: 'x.y',
      states: {},
      screens: [{ scenario: 'nope', wait: { text: 'a' } }],
    })[0],
    /unknown scenario/
  );
});

test('every screen renders on the example adapter in both themes, beside the reference', async (t) => {
  if (skip) return t.skip(skip);
  const out = path.join(tmp, 'out-all');
  const { code, report } = await run({ build: good, reference, out });
  const expected = catalogue.features.reduce((n, f) => n + f.screens.length, 0) * 2;
  assert.equal(report.screens.length, expected);
  assert.deepEqual(
    report.screens.filter((x) => !x.rendered).map((x) => `${x.feature} ${x.theme}: ${x.reason}`),
    []
  );
  assert.equal(code, 0, 'axe findings are advisory without --strict');
  assert.equal(report.reference.used, true);
  for (const x of report.screens) {
    assert.ok(existsSync(path.join(out, x.shot)), x.shot);
    assert.ok(
      x.referenceShot && existsSync(path.join(out, x.referenceShot)),
      `${x.feature} has its reference`
    );
  }
  const gallery = readFileSync(path.join(out, 'index.html'), 'utf8');
  for (const f of catalogue.features) assert.ok(gallery.includes(`<code>${f.id}</code>`), f.id);
  assert.ok(existsSync(path.join(out, 'summary.md')) && existsSync(path.join(out, 'report.json')));
});

test('aria: each rendered screen carries its accessibility snapshot, and only when asked', async (t) => {
  if (skip) return t.skip(skip);
  const flags = { build: good, only: 'shell.top-bar' };
  const asked = await run({ ...flags, out: path.join(tmp, 'out-aria') }, { aria: true });
  assert.ok(asked.report.screens.length > 0);
  for (const x of asked.report.screens)
    assert.match(x.aria ?? '', /- heading "[^"]+" \[level=1\]/, `${x.feature} ${x.theme}`);
  const plain = await run({ ...flags, out: path.join(tmp, 'out-no-aria') });
  assert.ok(plain.report.screens.every((x) => !('aria' in x)));
});

test('a time on a screen reads the same on every machine: UTC, en-US', async (t) => {
  if (skip) return t.skip(skip);
  const { report } = await run(
    { build: good, only: 'runs.history', themes: 'dark', out: path.join(tmp, 'out-utc') },
    { aria: true }
  );
  // The sample run of 2026-10-23T10:00Z, whatever this machine's own time zone is.
  assert.match(report.screens[0].aria ?? '', /10\/23\/2026, 10:00:00 AM/);
});

test('a broken adapter component fails the screens that render it (exit 1)', async (t) => {
  if (skip) return t.skip(skip);
  const { code, report } = await run({
    build: broken,
    out: path.join(tmp, 'out-broken'),
    only: 'overview.open-items,help.reference',
    themes: 'dark',
  });
  assert.equal(code, 1);
  const failed = report.screens.filter((x) => !x.rendered);
  assert.ok(
    failed.some((x) => x.feature === 'overview.open-items'),
    'the Overview renders cards'
  );
  assert.match(failed[0].reason, /sample: this Card is broken|landmark missing/);
});

test('axe findings are advisory; --strict makes them fail', async (t) => {
  if (skip) return t.skip(skip);
  // An image without a text alternative on every page: a violation whatever the adapter does.
  const initScript =
    "document.addEventListener('DOMContentLoaded', () => { const i = document.createElement('img'); i.src = 'data:,'; document.body.append(i); })";
  const flags = {
    build: good,
    out: path.join(tmp, 'out-axe'),
    only: 'help.reference',
    themes: 'light',
  };
  const advisory = await run(flags, { initScript });
  assert.equal(advisory.code, 0);
  assert.ok(
    advisory.report.screens[0].axe.some((v) => v.id === 'image-alt'),
    'reported'
  );
  const strict = await run({ ...flags, strict: true }, { initScript });
  assert.equal(strict.code, 1);
});

test('layout findings are advisory; --strict makes them fail', async (t) => {
  if (skip) return t.skip(skip);
  // A strip wider than the window on every page: the page scrolls sideways at both widths.
  const initScript =
    "document.addEventListener('DOMContentLoaded', () => { const d = document.createElement('div'); d.style.width = '1400px'; d.style.height = '1px'; document.body.append(d); })";
  const flags = {
    build: good,
    out: path.join(tmp, 'out-layout'),
    only: 'help.reference',
    themes: 'dark',
  };
  const advisory = await run(flags, { initScript });
  assert.equal(advisory.code, 0);
  const found = advisory.report.screens[0].layout.filter((f) => f.rule === 'overflow');
  assert.deepEqual(
    found.map((f) => f.text.match(/at (\d+)px wide/)?.[1]),
    ['1280', '900']
  );
  assert.equal(advisory.report.summary.withLayout, 1);
  assert.match(readFileSync(path.join(tmp, 'out-layout', 'summary.md'), 'utf8'), /### Layout/);
  const strict = await run({ ...flags, strict: true }, { initScript });
  assert.equal(strict.code, 1);
});

test('--compare: each screen against the earlier check, changed screens with the earlier shot and a diff', async (t) => {
  if (skip) return t.skip(skip);
  const { rustBinary } = await import('../../pxsig/src/lib/workspace/peers.mjs');
  if (!existsSync(rustBinary())) {
    if (process.env.PXSIG_TEST_STRICT === '1') assert.fail(`no engine at ${rustBinary()}`);
    return t.skip(`no engine at ${rustBinary()} (cargo build --release, or PXSIG_BIN)`);
  }
  const flags = { build: good, only: 'help.reference', themes: 'dark,light' };
  const earlier = path.join(tmp, 'out-earlier');
  await run({ ...flags, out: earlier });
  const same = await run({ ...flags, out: path.join(tmp, 'out-same'), compare: earlier });
  assert.deepEqual(
    same.report.screens.map((x) => x.compare?.status),
    ['same', 'same']
  );
  assert.equal(same.report.compare.changed, 0);
  // A visible change on the dark screen only: a red band across the top.
  const initScript =
    "document.addEventListener('DOMContentLoaded', () => { if (!location.search.includes('theme=dark')) return; const d = document.createElement('div'); d.style.cssText = 'position:fixed;inset:0 0 auto 0;height:300px;background:#f00'; document.body.append(d); })";
  const out = path.join(tmp, 'out-changed');
  const changed = await run(
    { ...flags, out, compare: earlier, only: 'help.reference' },
    { initScript }
  );
  assert.equal(changed.code, 0, 'a change is advisory');
  const [dark, light] = changed.report.screens;
  assert.equal(dark.compare.status, 'changed');
  assert.ok(dark.compare.ssim < 0.99 && dark.compare.reasons.length);
  assert.ok(
    existsSync(path.join(out, dark.compare.earlier)) &&
      existsSync(path.join(out, dark.compare.diff))
  );
  assert.equal(light.compare.status, 'same');
  assert.equal(changed.report.compare.changed, 1);
  assert.ok(!existsSync(path.join(out, '.compare')), 'the scratch folder is removed');
  assert.match(
    readFileSync(path.join(out, 'summary.md'), 'utf8'),
    /- changed: `help.reference` #1 \(dark\)/
  );
  assert.match(readFileSync(path.join(out, 'index.html'), 'utf8'), /Changed screens only/);
  // A screen only the earlier run has is listed as gone; one outside --only/--themes is not.
  const report = JSON.parse(readFileSync(path.join(earlier, 'report.json'), 'utf8'));
  report.screens.push({ ...report.screens[0], index: 5 }, { ...report.screens[0], feature: 'x.y' });
  writeFileSync(path.join(earlier, 'report.json'), JSON.stringify(report));
  const fewer = await run({ ...flags, out: path.join(tmp, 'out-fewer'), compare: earlier });
  assert.deepEqual(fewer.report.compare.removed, [`help.reference#6@${report.screens[0].theme}`]);
  await assert.rejects(run({ ...flags, compare: path.join(tmp, 'nowhere') }), CheckSetupError);
});

test('a decision is answered and recorded, nothing is written, and only --out changes', async (t) => {
  if (skip) return t.skip(skip);
  const cwd = mkdtempSync(path.join(tmp, 'cwd-'));
  writeFileSync(path.join(cwd, 'marker.txt'), 'x');
  const before = tree(cwd);
  const approve = {
    features: [
      {
        id: 'inspector.header',
        title: 'Inspector header',
        purpose: 'test',
        components: [],
        screens: [
          {
            scenario: 'changed',
            hash: '#inspect=ui-button--primary',
            actions: [{ click: { role: 'button', name: 'Approve', exact: true } }],
            wait: { role: 'dialog', name: 'ui-button--primary' },
          },
        ],
      },
    ],
  };
  const { code, report } = await run(
    { build: good, out: 'check-out', themes: 'dark' },
    { cwd, catalogue: approve }
  );
  assert.equal(code, 0, JSON.stringify(report.screens));
  assert.ok(
    report.summary.posts >= 1,
    'the approve request reached the check server, which answered it'
  );
  const after = tree(cwd).filter((f) => !f.startsWith('check-out'));
  assert.deepEqual(after, before, 'nothing written outside --out');
  const src = path.join(dashboard, '..', 'pxsig', 'src');
  const files = [
    'dashboard-check.mjs',
    ...readdirSync(path.join(src, 'dashboard-check')).map((f) => `dashboard-check/${f}`),
  ];
  assert.deepEqual(
    files.filter((f) => readFileSync(path.join(src, f), 'utf8').includes('child_process')),
    [],
    'starts no program itself (Playwright launches the browser: docs/platforms.md)'
  );
});

test('the screenshot waits for the layout to hold still, up to a cap', async (t) => {
  if (skip) return t.skip(skip);
  const { settle, SETTLE_MS } = await import('../../pxsig/src/dashboard-check/capture.mjs');
  const page = await browser.newPage();
  try {
    // A box that resizes 50 ms after the page draws, as a debounced chart does.
    await page.setContent(
      '<div id="b" style="width:10px;height:10px"></div><script>setTimeout(() => { document.getElementById("b").style.width = "200px"; }, 50)</script>'
    );
    assert.equal(await settle(page), true);
    assert.equal(await page.evaluate(() => document.getElementById('b')?.offsetWidth), 200);
    // A box that changes on every frame never holds still: the cap ends the wait.
    await page.setContent(
      '<div id="b" style="width:10px;height:10px"></div><script>let n = 0; const f = () => { document.getElementById("b").style.width = 10 + (n++ % 50) + "px"; requestAnimationFrame(f); }; requestAnimationFrame(f);</script>'
    );
    const started = Date.now();
    assert.equal(await settle(page), false);
    assert.ok(Date.now() - started >= SETTLE_MS - 100, 'waited for the cap');
  } finally {
    await page.close();
  }
  const { summaryMarkdown } = await import('../../pxsig/src/dashboard-check.mjs');
  const screen = {
    feature: 'overview.stats',
    index: 0,
    theme: 'dark',
    rendered: true,
    axe: [],
    layout: [],
  };
  const md = summaryMarkdown(
    /** @type {any} */ ({
      summary: { screens: 2, rendered: 2, failed: 0, withAxe: 0, withLayout: 0 },
      build: 'dist',
      contract: { adapter: 1, current: 1 },
      themes: ['dark'],
      reference: { used: false, note: 'none' },
      strict: false,
      screens: [screen, { ...screen, index: 1, settled: false }],
    })
  );
  assert.match(md, /### Still moving\n\n.*\n\n- `overview.stats` #2 \(dark\)\n/);
  assert.doesNotMatch(md, /#1 \(dark\)/, 'a settled screen is not listed');
});

test('setup problems: no build, a placeholder reference, unknown themes and features', async (t) => {
  if (skip) return t.skip(skip);
  await assert.rejects(
    run({ build: path.join(tmp, 'nothing'), out: path.join(tmp, 'o1') }),
    CheckSetupError
  );
  await assert.rejects(
    run({ build: good, themes: 'sepia', out: path.join(tmp, 'o2') }),
    /--themes/
  );
  await assert.rejects(
    run({ build: good, only: 'no.such', out: path.join(tmp, 'o3') }),
    /--only names no feature/
  );
  const placeholder = path.join(tmp, 'placeholder');
  copyTree(good, placeholder);
  writeFileSync(
    path.join(placeholder, 'index.html'),
    '<!doctype html><title>pxsig</title><p>Placeholder dashboard from a release dry run.</p>'
  );
  assert.equal(isDashboardBuild(placeholder), false);
  const { report } = await run({
    build: good,
    reference: placeholder,
    only: 'help.reference',
    themes: 'dark',
    out: path.join(tmp, 'o4'),
  });
  assert.equal(report.reference.used, false);
  assert.match(report.reference.note, /placeholder/);
});
