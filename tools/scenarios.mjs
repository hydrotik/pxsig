#!/usr/bin/env node
/**
 * scenarios.mjs — break things on purpose and check that the gate notices; add noise and check
 * that it does not.
 *
 * Each scenario re-renders the sampled entries with one simulated change applied at render time
 * (an injected stylesheet, design-token overrides, or another mode's Storybook globals). No source
 * file is edited and no baseline is written. Each render is then checked by the Rust engine
 * against the committed baseline twice: with the gate as shipped (project gate + detail channel),
 * and with the whole-image signature alone, to show what the detail channel adds.
 *
 *   regression  a real-world break: an entry whose pixels changed should FAIL.
 *               recall = failed / changed
 *   noise       imperceptible drift: every entry should PASS.
 *               false positives = failed / entries
 *
 * "Changed" means the render's pixels differ from the `control` render (same run, no change),
 * measured by the Rust pixel diff at tolerance 0, so recall counts only visible changes. The
 * control itself is compared with the baseline image.
 *
 *   node tools/scenarios.mjs [--project name] [--workspace dir]
 *        [--scenarios file.json] [--suite name] [--only a,b] [--every N] [--max N]
 *        [--modes light,dark] [--states] [--concurrency 6] [--rescore]
 *
 * Writes <store>/reports/scenarios[-<suite>].json; renders under <store>/renders/<tag>/<scenario>/,
 * diff artifacts under <store>/diffs/<tag>/<scenario>/, scratch manifests under
 * <store>/cache/research/<tag>/.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  assertScratch,
  baselineImages,
  browserPool,
  engine,
  freshDir,
  log as logger,
  parseFlags,
  pct,
  pickEntries,
  pool,
  project,
  readReport,
  renderStories,
  rust,
  scratchManifest,
  str,
  STORYBOOK_ERROR,
  trimDir,
  writeReport,
} from './lib/research.mjs';

const log = logger('scenarios');

/**
 * Built-in scenarios: plain CSS, so they apply to any Storybook. `{target}` is the project's
 * capture target (capture.target, `#storybook-root` by default).
 */
export const DEFAULT_SCENARIOS = [
  {
    name: 'control',
    kind: 'noise',
    title: 'Re-render, no change',
    change: 'Determinism: the same entries rendered again.',
  },
  {
    name: 'type-scale',
    kind: 'regression',
    title: 'Root font size changed',
    change: 'html { font-size: 18px }: every rem grows 12.5%',
    css: 'html{font-size:18px!important}',
  },
  {
    name: 'font-fallback',
    kind: 'regression',
    title: 'Web font failed to load',
    change: 'font-family → Georgia, serif',
    css: '*{font-family:Georgia,serif!important}',
  },
  {
    name: 'color-shift',
    kind: 'regression',
    title: 'Colours shifted',
    change: 'hue-rotate(90deg) on the story root',
    css: '{target}{filter:hue-rotate(90deg)!important}',
  },
  {
    name: 'radius-zero',
    kind: 'regression',
    title: 'Corner radius dropped',
    change: 'border-radius → 0 everywhere',
    css: '*{border-radius:0!important}',
  },
  {
    name: 'padding-lost',
    kind: 'regression',
    title: 'Inline padding lost',
    change: 'padding-inline → 0 everywhere',
    css: '{target} *{padding-inline:0!important}',
  },
  {
    name: 'borders-gone',
    kind: 'regression',
    title: 'Borders disappeared',
    change: 'border-color → transparent',
    css: '*{border-color:transparent!important}',
  },
  {
    name: 'icons-missing',
    kind: 'regression',
    title: 'Icons stopped rendering',
    change: 'svg { visibility: hidden }',
    css: 'svg{visibility:hidden!important}',
  },
  {
    name: 'tracking',
    kind: 'regression',
    title: 'Letter-spacing regression',
    change: 'letter-spacing: 0.06em on everything',
    css: '*{letter-spacing:.06em!important}',
  },
  {
    name: 'layout-shift',
    kind: 'regression',
    title: 'Layout shifted 12px',
    change: '{target} > * { margin-inline-start: 12px }',
    css: '{target}>*{margin-inline-start:12px!important}',
  },
  {
    name: 'mode-swap',
    kind: 'regression',
    title: 'Wrong mode shipped',
    change: "Each entry rendered with another mode's globals and colour scheme",
    modeSwap: true,
  },
  // The story's content moves, not the capture box: shifting the root itself against the page leaves
  // a blended seam on its edge, which the content trim reads as content (see tools/README.md).
  {
    name: 'subpixel',
    kind: 'noise',
    title: 'Sub-pixel offset',
    change: '{target} > * { transform: translateX(0.4px) }: anti-aliasing drift',
    css: '{target}>*{transform:translateX(.4px)}',
  },
  {
    name: 'opacity-99',
    kind: 'noise',
    title: 'Imperceptible opacity',
    change: 'opacity 0.99 on the story root',
    css: '{target}{opacity:.99}',
  },
  {
    name: 'brightness-step',
    kind: 'noise',
    title: 'One-step colour jitter',
    change: 'brightness(1.004): about one 8-bit step per channel',
    css: '{target}{filter:brightness(1.004)}',
  },
];

/**
 * A scenarios file: `{ scenarios?: [...], replace?: bool, suites?: { name: { title, stories, scenarios } } }`.
 * A scenario is `{ name, kind: 'regression'|'noise', title, change, css?, tokens?, globals?, colorScheme? }`;
 * `tokens` maps a CSS custom-property prefix to a value (every `--<prefix>__*` variable is set: the
 * hashed names vanilla-extract emits): a literal, `{ scale: n }` or `{ mix: colour, amount: pct }`
 * (lib/capture.mjs `applyTokenOverrides`). A suite's `stories` is a regex over story ids; it renders
 * every matching entry (no sampling) with the base scenarios plus its own.
 */
function loadScenarios(flags, P) {
  const file = str(flags.scenarios);
  const cfg = file ? JSON.parse(readFileSync(resolve(file), 'utf8')) : {};
  const base = cfg.replace ? [] : DEFAULT_SCENARIOS;
  const own = cfg.scenarios ?? [];
  let all = [...base.filter((s) => !own.some((o) => o.name === s.name)), ...own];
  if (!all.some((s) => s.name === 'control')) all.unshift(DEFAULT_SCENARIOS[0]);
  const suiteName = str(flags.suite);
  let suite = null;
  if (suiteName) {
    suite = cfg.suites?.[suiteName];
    if (!suite) throw new Error(`no suite "${suiteName}" in ${file ?? '(no --scenarios file)'}`);
    all = [...all, ...(suite.scenarios ?? [])];
  }
  for (const s of all)
    for (const [k, v] of Object.entries(s.tokens ?? {}))
      if (typeof v === 'string' && v.startsWith('fn:'))
        throw new Error(
          `scenario "${s.name}": token "${k}" uses "fn:", which is no longer run as code; use a literal, { "scale": n } or { "mix": colour, "amount": pct }`
        );
  if (Object.keys(P.modes).length < 2) all = all.filter((s) => !s.modeSwap);
  const target = P.config.capture.target ?? '#storybook-root';
  const fill = (s) => (s ? s.replaceAll('{target}', target) : s);
  return {
    suiteName,
    suite,
    all: all.map((s) => ({ ...s, css: fill(s.css), change: fill(s.change) })),
  };
}

/** The mode an entry is swapped to: the next one in the project's mode list. */
function swapMode(P, e) {
  const names = Object.keys(P.modes);
  const other = names[(names.indexOf(e.mode) + 1) % names.length];
  const m = P.modes[other];
  return { ...e, globals: m.globals ?? '', colorScheme: m.colorScheme ?? e.colorScheme };
}

async function main() {
  const flags = parseFlags();
  const { P, run } = project(flags);
  const { suiteName, suite, all } = loadScenarios(flags, P);
  const only = str(flags.only) ? new Set(String(flags.only).split(',')) : null;
  const scenarios = all.filter((s) => !only || s.name === 'control' || only.has(s.name));
  const tag = suiteName ? `scenarios-${suiteName}` : 'scenarios';
  const concurrency = Number(flags.concurrency) || 6;
  const entries = pickEntries(run, flags, suite ? new RegExp(suite.stories) : null).filter((e) =>
    existsSync(resolve(P.workspaceRoot, e.sig))
  );
  if (!entries.length)
    throw new Error('no entries with a baseline: run `pxsig check` and approve baselines first');

  const scratch = freshDir(P, tag);
  const manifest = scratchManifest(P, join(scratch, 'manifest.json'), run, entries);
  const baseDir = join(scratch, 'base');
  baselineImages(P, entries, baseDir);
  const renderRoot = assertScratch(P, join(P.store.root, 'renders', tag));
  const diffRoot = assertScratch(P, join(P.store.diffs, tag));
  log(
    `${P.name}: ${scenarios.length} scenarios × ${entries.length} entries · concurrency ${concurrency}${flags.rescore ? ' · re-scoring saved renders' : ''}`
  );

  const browser = flags.rescore ? null : browserPool(P);
  const eng = engine(P);
  const out = [];
  try {
    for (const sc of scenarios) {
      const dir = join(renderRoot, sc.name);
      let results;
      let wallMs = 0;
      if (flags.rescore) {
        results = entries.map((e) => {
          const png = join(dir, `${e.id}.png`);
          return existsSync(png)
            ? { id: e.id, png, ms: 0 }
            : { id: e.id, png: null, ms: 0, error: 'no saved render' };
        });
      } else {
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        const list = entries.map((e) =>
          sc.modeSwap
            ? swapMode(P, e)
            : {
                ...e,
                globals: sc.globals ?? e.globals,
                colorScheme: sc.colorScheme ?? e.colorScheme,
              }
        );
        ({ results, wallMs } = await renderStories(browser, list, dir, {
          ...run,
          concurrency,
          css: sc.css ?? '',
          tokens: sc.tokens ?? null,
          a11y: false,
          project: P,
        }));
        const sb = results.filter((r) => r.error?.startsWith(STORYBOOK_ERROR));
        if (sb.length === results.length)
          throw new Error(
            `every render hit Storybook's error page (${sb[0].error}): is Storybook running at ${run.baseUrl}?`
          );
        trimDir(P, run, dir);
      }

      // Rust: the shipped gate (with artifacts for the inspector), then the whole-image signature alone.
      const diffDir = join(diffRoot, sc.name);
      rmSync(diffDir, { recursive: true, force: true });
      const shipped = rust(P, [
        'check',
        '--manifest',
        manifest,
        '--png-dir',
        dir,
        '--root',
        P.workspaceRoot,
        '--json',
        '--out-dir',
        diffDir,
        '--artifacts',
        'all',
      ]).out;
      const whole = rust(P, [
        'check',
        '--manifest',
        manifest,
        '--png-dir',
        dir,
        '--root',
        P.workspaceRoot,
        '--json',
        '--artifacts',
        'none',
        '--no-detail',
      ]).out;
      const byId = new Map(shipped.results.map((x) => [x.id, x]));
      const wholeById = new Map(whole.results.map((x) => [x.id, x]));

      // Changed pixels: against the control render (the control: against the baseline image).
      const ref = (id) =>
        sc.name === 'control'
          ? join(baseDir, `${id}.png`)
          : join(renderRoot, 'control', `${id}.png`);
      const changed = await pool(results, 16, async (r) => {
        if (!r.png || !existsSync(ref(r.id))) return null;
        const d = await eng.call('diff', { a: ref(r.id), b: r.png, tolerance: 0 });
        return d.changed > 0 || d.width === 0;
      });

      const rows = results.map((r, i) => {
        const ru = byId.get(r.id);
        const wh = wholeById.get(r.id);
        return {
          id: r.id,
          error: r.error ?? ru?.error ?? null,
          changed: changed[i] ?? false,
          renderMs: Math.round(r.ms),
          pass: ru && !ru.error ? ru.pass === true : null,
          metrics: ru?.metrics ?? null,
          detail: ru?.detail ?? null,
          reasons: ru?.reasons ?? [],
          wholeImagePass: wh && !wh.error ? wh.pass === true : null,
        };
      });
      const ok = rows.filter((r) => r.pass !== null && !r.error);
      const ch = ok.filter((r) => r.changed);
      const summary = {
        stories: ok.length,
        errors: rows.length - ok.length,
        changed: ch.length,
        failed: ok.filter((r) => !r.pass).length,
        detected: ch.filter((r) => !r.pass).length,
        detectedWholeImage: ch.filter((r) => !r.wholeImagePass).length,
        falsePositives: sc.kind === 'noise' ? ok.filter((r) => !r.pass).length : null,
        renderWallMs: Math.round(wallMs),
        rustEngineMs: Math.round(shipped.summary?.elapsedMs ?? 0),
      };
      const { modeSwap, ...meta } = sc;
      out.push({ ...meta, summary, rows });
      const line =
        sc.kind === 'regression'
          ? `recall ${summary.detected}/${summary.changed} (${pct(summary.detected, summary.changed)}) · whole-image only ${summary.detectedWholeImage}/${summary.changed}`
          : `false positives ${summary.falsePositives}/${summary.stories} · changed ${summary.changed}`;
      log(
        `  ${sc.kind === 'regression' ? 'break' : 'noise'} ${sc.name.padEnd(16)} ${line}${summary.errors ? ` · ${summary.errors} errors` : ''} · render ${(wallMs / 1000).toFixed(1)} s`
      );
    }
  } finally {
    eng.close();
    await browser?.close();
  }

  // --only re-runs a subset: keep the other scenarios from the previous report.
  const prev = only ? readReport(P, tag) : null;
  const scenariosOut = prev
    ? all
        .map(
          (s) => out.find((o) => o.name === s.name) ?? prev.scenarios.find((p) => p.name === s.name)
        )
        .filter(Boolean)
    : out;
  const report = {
    generatedAt: new Date().toISOString(),
    project: P.name,
    gate: {
      ...run.gate,
      grid: run.grid,
      minCellPx: run.minCellPx,
      detail: run.detail ? (run.gate?.detail ?? true) : false,
    },
    suite: suiteName
      ? { name: suiteName, title: suite.title ?? suiteName, pattern: String(suite.stories) }
      : null,
    sample: { every: suite ? 1 : Number(flags.every) || 1, stories: entries.length, concurrency },
    renders: relative(P.workspaceRoot, renderRoot),
    scenarios: scenariosOut,
  };
  log(`wrote ${writeReport(P, tag, report)}`);
}

main().catch((e) => {
  console.error(`[scenarios] ${e.message}`);
  process.exitCode = 2;
});
