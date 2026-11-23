/// <reference types="node" />
/**
 * real-shaped.mjs — a scenario shaped like a real design system's store (scenarios.mjs adds it):
 * long entry ids (`components-chart--area-chart-stacked@light`), dozens of entries with render
 * counts, a compiler report over many files and functions, and the setup warnings a real project
 * gets, each a long sentence (lines from before 0.7.6 that carry a reason, a different render
 * environment, many passing entries that differ). The other scenarios' ids are short and few, so
 * column widths and text measures that only fail on real data pass there. Fixed timestamps.
 */
// scenarios.mjs imports this file; its helpers are read only when the scenario is built.
import { AT, data, inComponent, row, spread } from './scenarios.mjs';

const BASE_AT = '2026-10-24T09:58:00.000Z';
const MAIN = { since: 'main', commit: '4883bcd' };

/** Components and their stories, as a design system's Storybook names them. */
const STORIES = {
  Chart: [
    'area-chart-stacked',
    'area-chart-gradient-fill',
    'bar-chart-grouped-negative-values',
    'line-chart-with-reference-band',
  ],
  DataGrid: [
    'virtualised-100-k-rows',
    'column-autosize-and-pinning',
    'tree-data-with-aggregates',
    'master-detail-expanded',
  ],
  NavigationBar: ['kept-item-overflow-menu', 'more-menu-with-long-labels'],
  SegmentedRatingBar: ['numeric-mode-large-total', 'boolean-array-sources'],
  CommandPalette: ['grouped-results-with-shortcuts'],
};
/** `components-<component>--<story>`, both themes. */
const IDS = Object.entries(STORIES).flatMap(([c, stories]) =>
  stories.flatMap((st) => {
    const id = `components-${c.toLowerCase()}--${st}`;
    return [id, `${id}@light`];
  })
);
const componentOf = (/** @type {string} */ id) =>
  /** @type {string} */ (
    Object.keys(STORIES).find((c) => id.startsWith(`components-${c.toLowerCase()}--`))
  );

/** Render counts for the i-th entry: a spread of sizes, every fifth one still rendering. */
const counts = (/** @type {number} */ i) => {
  const commits = 1 + ((i * 7) % 23);
  const rendered = commits * (3 + ((i * 13) % 97));
  return {
    v: 1,
    build: 'development',
    react: '19.3.1',
    mount: { commits, rendered, mounted: rendered },
    top: [
      { name: 'ResponsiveContainerWithTooltipLayer', renders: rendered >> 1, compiled: i % 3 > 0 },
      { name: 'DataGridVirtualisedRow', renders: rendered >> 2, compiled: true },
      { name: 'Icon', renders: commits, compiled: true },
    ],
    ms: Math.round((0.6 + ((i * 37) % 4100) / 10) * 10) / 10,
    settled: i % 5 !== 0,
    at: AT,
    ...(i % 2 ? { prev: { commits, rendered: rendered - (i % 4), at: BASE_AT } } : {}),
  };
};

const P = 'packages/ui/src/components';
/** Changed files and the functions in each, as the compiler report lists them. */
const FILES = {
  [`${P}/Chart/AreaChart.tsx`]: ['AreaChart', 'AreaChartTooltipContent', 'useStackedSeries'],
  [`${P}/DataGrid/parts/Body.tsx`]: ['DataGridRow', 'DataGridCell', 'DefaultCellEditor'],
  [`${P}/DataGrid/hooks/useColumnAutosize.ts`]: ['useColumnAutosize'],
  [`${P}/NavigationBar/NavigationBar.tsx`]: ['NavigationBar', 'KeptNavItemLink', 'MoreMenu'],
  [`${P}/SegmentedRatingBar/SegmentedRatingBar.tsx`]: ['SegmentedRatingBar'],
};
const refs = { rule: 'refs', category: 'Refs', reason: 'Cannot access refs during render' };

/** The report's functions: the first of each file newly skipped, the rest compiled. */
function functions() {
  return Object.entries(FILES).flatMap(([path, names]) =>
    names.map((name, i) => {
      const line = 12 + i * 40;
      const skipped = i === 0;
      return {
        id: `${path}#${name}`,
        name,
        kind: name.startsWith('use') ? 'hook' : 'component',
        line,
        base: { outcome: 'compiled', memoSlots: 4 },
        head: skipped
          ? {
              outcome: 'bailout',
              diagnostics: [{ ...refs, line: line + 6, severity: 'Error', stops: true }],
            }
          : { outcome: 'compiled', memoSlots: 4 },
        change: skipped ? 'new-bailout' : 'unchanged',
        alert: skipped,
      };
    })
  );
}

function report() {
  const fns = functions();
  const alerts = fns
    .filter((f) => f.alert)
    .map((f) => ({
      kind: 'compiler',
      id: f.id,
      name: f.name,
      path: f.id.split('#')[0],
      change: f.change,
      level: 'warning',
      rule: 'refs',
      line: f.line + 6,
      text: `${f.name} (${f.id.split('#')[0]}): compiled at main, skipped now: Cannot access refs during render (refs, line ${f.line + 6}). Reaches 4 entries.`,
    }));
  return {
    v: 1,
    generatedAt: AT,
    project: 'demo',
    mode: 'alert',
    backend: {
      name: 'babel',
      compiler: '1.0.0',
      babel: '7.29.7',
      options: { compilationMode: 'infer', target: '19', lint: true },
    },
    base: MAIN,
    files: Object.keys(FILES).map((path) => {
      const ids = IDS.filter((id) => path.includes(`/${componentOf(id)}/`));
      return { path, entries: ids.length, all: false, ids, head: 'compiled', base: 'cached' };
    }),
    functions: fns,
    alerts,
    skipped: [],
    notes: [],
    summary: {
      files: Object.keys(FILES).length,
      functions: fns.length,
      compiled: fns.length - alerts.length,
      bailouts: alerts.length,
      newBailouts: alerts.length,
      findings: 0,
      newFindings: 0,
      fixed: 0,
      optedOut: 0,
      alerts: alerts.length,
      ms: 2140,
      cached: 3,
    },
  };
}

/** The setup warnings, with the sentences the ledger writes (lib/integrity/problems.mjs). */
const SETUP = [
  {
    code: 'log-legacy-personal',
    severity: 'info',
    count: 214,
    reason:
      '212 lines of approvals.ndjson and 2 of a11y-decisions.ndjson, written before 0.7.6, carry a reason or a git email. New lines carry neither; old lines stay (the log is append-only, and git history keeps them either way)',
  },
  {
    code: 'env-mismatch',
    severity: 'warn',
    count: IDS.length,
    reason: `${IDS.length} entries were rendered in a different environment than their baseline (browser.version, fonts.probe): a change there can be the machine, not the code. Render where the baselines were made (the pinned container), or re-take them there (\`pxsig check --full --update --kind environment\`); \`--strict-env\` refuses such a run instead (a font swap, \`fonts.used\`, once rendered)`,
  },
  {
    code: 'drift-high',
    severity: 'warn',
    count: 19,
    reason:
      '19 of 26 passing entries (73%) pass while their render differs from the baseline, at or over 5 entries or 10%. A change the gate does not see, such as a color change in a small area, passes this way, and their baselines stay as they were. `pxsig list drift` (or the dashboard\'s Stories, "Passing, but differs from the baseline") lists them. An intended change gets new baselines from a person (`pxsig check --full --update --only <ids>`); one the gate should have failed means the gate is too loose for this project (`pxsig config` names the layer that sets it)',
  },
];

export const REAL_SHAPED_SCENARIOS = {
  // A design system's store: long ids, many rows, long setup warnings, React data.
  'real-shaped'() {
    const rows = IDS.map((id, i) =>
      row(id, {
        renders: counts(i),
        ...(i === 3
          ? { pass: false, metrics: null, error: 'locator.waitFor: Timeout 15000ms exceeded' }
          : {}),
      })
    );
    const d = spread(
      data({ rows, entries: IDS.map((id) => inComponent(componentOf(id), id, [])) })
    );
    for (const x of d.integrity.entries) x.mode = x.id.endsWith('@light') ? 'light' : 'dark';
    // `data()` starts with none (an empty list); the ledger's setup problems, as it writes them.
    d.integrity.setup = /** @type {never[]} */ (/** @type {unknown} */ (SETUP));
    d.integrity.summary.status = 'warnings';
    return {
      ...d,
      react: {
        status: {
          compiler: 'ready',
          renders: 'ready',
          off: null,
          missing: [],
          configWarning: null,
          error: null,
          held: null,
          stale: null,
        },
        report: report(),
        source: 'check',
      },
    };
  },
};
