/**
 * The region rules end to end: `pxsig dashboard check` on the plain example adapter
 * (examples/custom-ui) passes them, and on a copy broken
 * on purpose (one change per rule) it fails, naming the element that breaks each. The rules one by
 * one are dashboard-fidelity.test.mjs. The top bar's sweep (the `top-bar` rule) too: the example
 * passes it, and two adapters the top bar breaks on fail it: one whose section links may wrap, and
 * one whose TopNav does not put className on its root. Skips when no Chromium is available
 * (PXSIG_CHROMIUM names an executable).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { noChromium } from './flows-helpers.mjs';
import { copyTree } from '../../../scripts/lib/copy-tree.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = path.dirname(here);
const repo = path.resolve(dashboard, '..', '..');
const require = createRequire(path.join(dashboard, '../pxsig/package.json'));
const { dashboardCheck } = await import('../../pxsig/src/dashboard-check.mjs');
const catalogue = JSON.parse(
  readFileSync(path.join(dashboard, 'fixtures', 'screens.json'), 'utf8')
);

/** The screens checked: the top bar, stat cards, a table with actions, a toolbar, badges. */
const ONLY = 'shell.top-bar,overview.counts,overview.open-items,review.filters,coverage.ledger';

/** Each change breaks one region rule (docs/ui/build-adapter.md, "Region rules"). */
const BROKEN_CSS = `
/* R1: the links on a line of their own, below the mark and the pinned controls. */
.plain-nav { flex-wrap: wrap; }
.plain-nav > ul { order: 1; flex-basis: 100%; }
/* R2: a select taller than the fields beside it, and full-size buttons in a table. */
.plain-select { block-size: 2.25rem; }
td .plain-button[data-size] { block-size: 2.25rem; }
/* R3: card titles re-cased by the adapter. */
.plain-card h3 { text-transform: uppercase; }
/* R4: a danger badge shows another tone (success) as a wash and a border, its text under AA. */
.plain-badge[data-tone='danger'] {
  color: color-mix(in srgb, var(--plain-danger) 30%, var(--plain-bg));
  border-color: var(--plain-success);
  background: color-mix(in srgb, var(--plain-success) 14%, transparent);
}
`;
/** R4: stat cards that show their tone as a coloured top border, the value in the text colour. */
const BROKEN_STATS = `
export const StatGroup = ({ label, items, className }: C.StatGroupProps) => (
  <section aria-label={label} className={className} style={{ display: 'flex', gap: '0.75rem' }}>
    {items.map((it, i) => (
      <div
        key={i}
        role={it.onSelect ? 'button' : undefined}
        tabIndex={it.onSelect ? 0 : undefined}
        aria-pressed={it.onSelect ? Boolean(it.active) : undefined}
        onClick={it.onSelect}
        style={{
          padding: '0.75rem',
          border: '1px solid var(--plain-border)',
          borderBlockStart:
            it.tone && it.tone !== 'neutral'
              ? \`2px solid var(--plain-\${it.tone === 'info' ? 'accent' : it.tone})\`
              : undefined,
        }}
      >
        {it.label} <strong>{it.value}</strong> {it.unit}
      </div>
    ))}
  </section>
);
`;

/** The top bar's links may wrap and shrink: a label on two lines. */
const WRAPPING_CSS = `
.plain-nav li { white-space: normal; flex-shrink: 1; }
`;

let browser = null;
let skip = false;
let tmp = null;
let good = null;
let broken = null;
let wrapping = null;
let unmarked = null;

/** Build an adapter folder with the dashboard's own Vite setup, as dashboard-check.test.mjs does. */
async function buildWith(adapterDir, outDir) {
  const { build, version } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { vanillaExtractPlugin } = await import('@vanilla-extract/vite-plugin');
  const { dashboardConfig } = await import('../build-config.mjs');
  // The served build (ES-module chunks), as at the top of `pxsig dashboard build`'s output.
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
  tmp = mkdtempSync(path.join(tmpdir(), 'pxsig-dashboard-fidelity-'));
  const example = path.join(repo, 'examples/custom-ui/pxsig-ui');
  good = await buildWith(example, path.join(tmp, 'good'));
  const brokenUi = path.join(tmp, 'broken-ui');
  copyTree(example, brokenUi);
  const css = path.join(brokenUi, 'theme.css');
  writeFileSync(css, `${readFileSync(css, 'utf8')}${BROKEN_CSS}`);
  const index = path.join(brokenUi, 'index.tsx');
  writeFileSync(index, `${readFileSync(index, 'utf8')}${BROKEN_STATS}`);
  broken = await buildWith(brokenUi, path.join(tmp, 'broken'));
  const wrapUi = path.join(tmp, 'wrap-ui');
  copyTree(example, wrapUi);
  writeFileSync(
    path.join(wrapUi, 'theme.css'),
    `${readFileSync(path.join(wrapUi, 'theme.css'), 'utf8')}${WRAPPING_CSS}`
  );
  wrapping = await buildWith(wrapUi, path.join(tmp, 'wrap'));
  const bareUi = path.join(tmp, 'bare-ui');
  copyTree(example, bareUi);
  const nav = path.join(bareUi, 'nav.tsx');
  const text = readFileSync(nav, 'utf8');
  const forwards = "className={['plain-nav', className].filter(Boolean).join(' ')}";
  assert.ok(text.includes(forwards), 'the example TopNav forwards className');
  writeFileSync(nav, text.replace(forwards, 'className="plain-nav"'));
  unmarked = await buildWith(bareUi, path.join(tmp, 'bare'));
});
after(async () => {
  await browser?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const run = (build, out) =>
  dashboardCheck({ build, out: path.join(tmp, out), only: ONLY, themes: 'dark' }, tmp, {
    log: () => {},
    browser,
  });
/** Every finding as `<feature> #<n>: <rule>: <text>`. */
const found = (report) =>
  report.screens.flatMap((x) =>
    x.fidelity.map((f) => `${x.feature} #${x.index + 1}: ${f.rule}: ${f.text}`)
  );

test('the plain example adapter keeps the region rules', async (t) => {
  if (skip) return t.skip(skip);
  const { code, report } = await run(good, 'out-good');
  assert.deepEqual(found(report), []);
  assert.deepEqual(report.topBar?.findings, []);
  assert.ok((report.topBar?.scenarios.length ?? 0) >= 3, 'the top bar swept in several scenarios');
  assert.equal(code, 0);
  assert.equal(report.summary.withFidelity, 0);
});

/** The top-bar sweep alone, in one scenario. */
const sweepOnly = (build, out) =>
  dashboardCheck({ build, out: path.join(tmp, out), only: 'shell.top-bar', themes: 'dark' }, tmp, {
    log: () => {},
    browser,
    topBar: { scenarios: ['changed'] },
  });

test('an adapter whose section links wrap fails the top-bar rule, at the widths they wrap', async (t) => {
  if (skip) return t.skip(skip);
  const { code, report } = await sweepOnly(wrapping, 'out-wrap');
  assert.equal(code, 1);
  const texts = (report.topBar?.findings ?? []).map((f) => f.text);
  assert.ok(
    texts.some((x) => /^changed at \d+px: <a "Review Stories[^"]*"> takes 2 lines$/.test(x)),
    texts.join('\n')
  );
  assert.equal(report.summary.topBar, texts.length);
  assert.match(readFileSync(path.join(tmp, 'out-wrap', 'summary.md'), 'utf8'), /### Top bar\n/);
});

test('an adapter whose TopNav drops className fails the top-bar rule: the bar has no mark', async (t) => {
  if (skip) return t.skip(skip);
  const { code, report } = await sweepOnly(unmarked, 'out-bare');
  assert.equal(code, 1);
  assert.deepEqual(
    report.topBar?.findings.map((f) => f.text),
    ["changed: no element carries pxsig-ui-TopNav: TopNav must put its className on the bar's root"]
  );
});

test('an adapter that breaks a region rule fails the check, naming the element', async (t) => {
  if (skip) return t.skip(skip);
  const { code, report } = await run(broken, 'out-broken');
  assert.equal(code, 1);
  // The links on a line of their own: none moves into More, so the screen that opens it cannot.
  const opensMore = (x) =>
    x.feature === 'shell.top-bar' &&
    catalogue.features
      .find((f) => f.id === x.feature)
      .screens[x.index].actions?.some((a) => a.click?.name === 'More');
  assert.deepEqual(
    report.screens
      .filter((x) => !x.rendered && !opensMore(x))
      .map((x) => `${x.feature} #${x.index + 1}: ${x.reason}`),
    []
  );
  const all = found(report);
  const has = (re, what) =>
    assert.ok(
      all.some((f) => re.test(f)),
      `${what}:\n  ${all.join('\n  ')}`
    );
  has(
    /^shell\.top-bar #1: one-line: the top bar "[^"]+" takes \d lines: <a "[^"]+"> starts line 2$/,
    'R1'
  );
  has(
    /^review\.filters #1: size: toolbar \d+[^:]*: controls differ in height: .*36px/,
    'R2 toolbar'
  );
  has(
    /^overview\.open-items #1: size: table 1 "Item": <button "Start review"> is 36px tall, above the page's small size \(28px/,
    'R2 table'
  );
  has(/^overview\.open-items #1: casing: <h3 "Open Items"> is drawn uppercase/, 'R3');
  has(
    /^coverage\.ledger #1: tone: badge <span "[^"]+"> shows its tone as a success background.*own tone \(danger\)$/,
    'R4 badge, another tone'
  );
  has(
    /^coverage\.ledger #1: tone: badge <span "[^"]+">: its text is [\d.]+:1 on its background, under AA/,
    'R4 badge, contrast'
  );
  has(
    /^overview\.counts #1: tone: stat card <div "Passed[^"]*"> shows its tone as a success top border/,
    'R4 stat card'
  );
  // The gallery, summary.md and the counts carry them.
  assert.ok(report.summary.withFidelity > 0);
  const md = readFileSync(path.join(tmp, 'out-broken', 'summary.md'), 'utf8');
  assert.match(md, /### Region rules\n/);
  assert.match(md, /  - casing: <h3 "Open Items"> is drawn uppercase/);
  const gallery = readFileSync(path.join(tmp, 'out-broken', 'index.html'), 'utf8');
  assert.match(gallery, /<summary>Region rules broken<\/summary>/);
});
