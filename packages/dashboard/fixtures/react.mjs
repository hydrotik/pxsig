/// <reference types="node" />
/**
 * react.mjs — the React analysis scenarios (scenarios.mjs adds them): the screens design's sample
 * (4 changed files, 9 functions, render counts with one entry still rendering) and each state the
 * React view, the progress strip and the inspector show. Fixed timestamps, neutral names.
 */
// scenarios.mjs imports this file; its helpers are read only when a scenario is built.
import { AT, data, entry, row } from './scenarios.mjs';

const BASE_AT = '2026-10-24T09:58:00.000Z';
const MAIN = { since: 'main', commit: '4883bcd' };

/** @param {string} rule @param {string} category @param {string} reason @param {number} line @param {boolean} [stops] */
const diag = (rule, category, reason, line, stops = true) => ({
  rule,
  category,
  reason,
  line,
  severity: stops ? 'Error' : 'Warning',
  stops,
});
/** @param {number} line */
const refs = (line) => diag('refs', 'Refs', 'Cannot access refs during render', line);
/** @param {string} outcome @param {Record<string, unknown>} [extra] */
const side = (outcome, extra = {}) => ({ outcome, ...extra });

/**
 * @param {string} path @param {string} name @param {'component' | 'hook'} kind @param {number} line
 * @param {ReturnType<typeof side> | null} base @param {ReturnType<typeof side> | null} head
 * @param {string | null} change
 */
const fn = (path, name, kind, line, base, head, change) => ({
  id: `${path}#${name}`,
  name,
  kind,
  line,
  base,
  head,
  change,
  alert: ['new-bailout', 'new-function-bailout', 'reason-changed', 'new-finding'].includes(
    change ?? ''
  ),
});

const B = 'src/Button/Button.tsx';
const G = 'src/DataGrid/useGrid.ts';
const S = 'src/Select/Select.tsx';
const T = 'src/Toast/Toast.tsx';
const IDS = {
  [B]: ['ui-button--primary', 'ui-button--primary@light', 'ui-button--ok'],
  [G]: ['ui-datagrid--many-rows'],
  [S]: ['ui-select--open'],
  [T]: ['ui-toast--default@light'],
};

/** The sample's functions: every change the table shows. */
export function functions() {
  return [
    fn(
      B,
      'Button',
      'component',
      12,
      side('compiled', { memoSlots: 5 }),
      side('bailout', { diagnostics: [refs(18)] }),
      'new-bailout'
    ),
    fn(
      B,
      'ButtonGroup',
      'component',
      30,
      side('compiled', { memoSlots: 3 }),
      side('compiled', { memoSlots: 3 }),
      'unchanged'
    ),
    fn(
      G,
      'useGrid',
      'hook',
      8,
      null,
      side('bailout', {
        diagnostics: [
          diag('immutability', 'Immutability', 'Cannot modify a value returned from a hook', 40),
        ],
      }),
      'new-function-bailout'
    ),
    fn(G, 'useGridColumns', 'hook', 52, null, side('compiled', { memoSlots: 2 }), 'new'),
    fn(
      S,
      'Select',
      'component',
      20,
      side('bailout', { diagnostics: [refs(64)] }),
      side('bailout', {
        diagnostics: [
          diag(
            'set-state-in-render',
            'RenderSetState',
            'Calling setState during render may trigger an infinite loop',
            77
          ),
          refs(64),
        ],
      }),
      'reason-changed'
    ),
    fn(
      S,
      'SelectItem',
      'component',
      90,
      side('bailout', {
        diagnostics: [
          diag(
            'preserve-manual-memoization',
            'PreserveManualMemo',
            'Existing memoization could not be preserved',
            96
          ),
        ],
      }),
      side('compiled', { memoSlots: 4 }),
      'fixed'
    ),
    fn(
      T,
      'Toast',
      'component',
      10,
      side('compiled', { memoSlots: 6 }),
      side('compiled', {
        memoSlots: 6,
        diagnostics: [
          diag(
            'set-state-in-effect',
            'EffectSetState',
            'Calling setState synchronously within an effect can trigger cascading renders',
            33,
            false
          ),
        ],
      }),
      'new-finding'
    ),
    fn(
      T,
      'ToastViewport',
      'component',
      48,
      side('compiled', { memoSlots: 2 }),
      side('compiled', { memoSlots: 2 }),
      'unchanged'
    ),
    fn(T, 'useToastTimer', 'hook', 70, side('opted-out'), side('opted-out'), 'opted-out'),
  ];
}

/** The engine's sentence for each alert of the sample (react.json `alerts`). */
const ALERTS = [
  [
    'Button',
    B,
    'new-bailout',
    'warning',
    'refs',
    18,
    `Button (${B}): compiled at main, skipped now: Cannot access refs during render (refs, line 18). Reaches 3 entries.`,
  ],
  [
    'useGrid',
    G,
    'new-function-bailout',
    'warning',
    'immutability',
    40,
    `useGrid (${G}): new, and skipped: Cannot modify a value returned from a hook (immutability, line 40). Reaches 1 entry.`,
  ],
  [
    'Select',
    S,
    'reason-changed',
    'warning',
    'set-state-in-render',
    77,
    `Select (${S}): skipped at main and now, for a new reason: Calling setState during render may trigger an infinite loop (set-state-in-render, line 77). Reaches 1 entry.`,
  ],
  [
    'Toast',
    T,
    'new-finding',
    'note',
    'set-state-in-effect',
    33,
    `Toast (${T}): Calling setState synchronously within an effect can trigger cascading renders (set-state-in-effect, line 33). It still compiles.`,
  ],
];

/** The sample's counts (react.json `summary`). @param {unknown} base */
const summaryOf = (base) => ({
  files: 4,
  functions: 9,
  compiled: 5,
  bailouts: 3,
  newBailouts: base ? 2 : 0,
  findings: 1,
  newFindings: base ? 1 : 0,
  fixed: base ? 1 : 0,
  optedOut: 1,
  alerts: base ? 4 : 0,
  ms: 310,
  cached: 2,
});

/**
 * reports/react.json for the sample; `base: null` compares nothing (no merge base); `oxc`: the
 * built-in compiler ran it (react.compiler: "oxc").
 * @param {{ base?: typeof MAIN | null, oxc?: boolean }} [o]
 */
export function report({ base = MAIN, oxc = false } = {}) {
  const fns = functions().map((f) => (base ? f : { ...f, base: null, change: null, alert: false }));
  return {
    v: 1,
    generatedAt: AT,
    project: 'demo',
    mode: 'alert',
    backend: {
      name: oxc ? 'oxc' : 'babel',
      compiler: oxc ? '0.143.0' : '1.0.0',
      babel: oxc ? null : '7.29.7',
      options: { compilationMode: 'infer', target: '19', lint: true },
    },
    base,
    files: Object.entries(IDS).map(([path, ids]) => ({
      path,
      entries: ids.length,
      all: false,
      ids,
      head: 'compiled',
      base: base ? 'cached' : null,
    })),
    functions: fns,
    alerts: base
      ? ALERTS.map(([name, path, change, level, rule, line, text]) => ({
          kind: 'compiler',
          id: `${path}#${name}`,
          name,
          path,
          change,
          level,
          rule,
          line,
          text,
        }))
      : [],
    skipped: [],
    notes: [],
    summary: summaryOf(base),
  };
}

/** @param {Partial<{ compiler: string, renders: string, off: any, missing: string[] }>} [o] */
const status = (o = {}) => ({
  compiler: 'ready',
  renders: 'ready',
  off: null,
  missing: [],
  configWarning: null,
  error: null,
  held: null,
  stale: null,
  ...o,
});

/** @param {number} commits @param {number} rendered @param {Record<string, unknown>} [extra] */
const counts = (commits, rendered, extra = {}) => ({
  v: 1,
  build: 'development',
  react: '19.3.1',
  mount: { commits, rendered, mounted: rendered },
  top: [{ name: 'Button', renders: commits, compiled: true }],
  ms: 2.4,
  settled: true,
  at: AT,
  ...extra,
});

/** The sample's rows: measured, one still rendering, one with no React. */
function rows() {
  return [
    row('ui-button--primary', {
      renders: counts(14, 52, {
        settled: false,
        ms: 12.4,
        top: [
          { name: 'Button', renders: 14, compiled: false },
          { name: 'Icon', renders: 14, compiled: true },
          { name: 'Spinner', renders: 12, compiled: true },
        ],
        prev: { commits: 2, rendered: 9, at: BASE_AT },
      }),
    }),
    row('ui-button--primary@light', {
      mode: 'light',
      renders: counts(2, 9, { ms: 1.8, prev: { commits: 2, rendered: 9, at: BASE_AT } }),
    }),
    row('ui-button--ok', { renders: counts(1, 4, { ms: 0.9 }) }),
    row('ui-datagrid--many-rows', {
      renders: counts(3, 1046, {
        ms: 48.2,
        top: [
          { name: 'DataGridRow', renders: 1000, compiled: true },
          { name: 'DataGridCell', renders: 40, compiled: true },
          { name: 'DataGrid', renders: 3, compiled: true },
        ],
        prev: { commits: 2, rendered: 1045, at: BASE_AT },
      }),
    }),
    row('ui-select--open', {
      renders: counts(4, 61, {
        ms: 6,
        top: [{ name: 'SelectItem', renders: 40, compiled: true }],
        interaction: { commits: 1, rendered: 12 },
        prev: { commits: 4, rendered: 61, at: BASE_AT },
      }),
    }),
    row('ui-toast--default@light', {
      mode: 'light',
      renders: counts(2, 11, { ms: 2.2, top: [{ name: 'Toast', renders: 2, compiled: true }] }),
    }),
    row('ui-svg--icon', { renders: null }),
  ];
}

/** A row as a check without render counting writes it. @param {ReturnType<typeof rows>[number]} r */
const unmeasured = (r) => {
  const out = { ...r };
  delete out.renders;
  return out;
};

/** @param {{ react: unknown, rows?: ReturnType<typeof rows> }} o */
function withReact({ react, rows: rs = rows() }) {
  const d = data({ rows: rs, entries: rs.map((r) => entry(r.id)) });
  return { ...d, react };
}

export const REACT_SCENARIOS = {
  react: () => withReact({ react: { status: status(), report: report(), source: 'check' } }),
  'react-running': () =>
    withReact({
      react: { status: status({ compiler: 'running' }), report: report(), source: 'server' },
    }),
  'react-measuring': () =>
    withReact({ react: { status: status(), report: report(), source: 'check' } }),
  'react-off': () =>
    withReact({
      react: {
        status: status({ compiler: 'off', renders: 'off', off: { where: 'config', key: 'react' } }),
        report: null,
        source: null,
      },
      rows: rows().map(unmeasured),
    }),
  'react-not-installed': () =>
    withReact({
      react: {
        status: status({
          compiler: 'not-installed',
          missing: ['babel-plugin-react-compiler', '@babel/core'],
        }),
        report: null,
        source: null,
      },
    }),
  // The analysis ran, but no check counted renders yet.
  'react-unmeasured': () =>
    withReact({
      react: { status: status(), report: report(), source: 'check' },
      rows: rows().map(unmeasured),
    }),
  // The analysis just ended with alerts: the strip's result line.
  'react-done': () =>
    withReact({ react: { status: status(), report: report(), source: 'server' } }),
  // react.compiler: "oxc": the built-in compiler, no Babel packages.
  'react-oxc': () =>
    withReact({ react: { status: status(), report: report({ oxc: true }), source: 'check' } }),
  'react-no-base': () =>
    withReact({
      react: { status: status(), report: report({ base: null }), source: 'check' },
    }),
};

/**
 * Events the stand-in server sends after `hello` (dashboard-check/server.mjs): a running analysis,
 * a measure-renders run part way.
 * @type {Record<string, [string, Record<string, unknown>][]>}
 */
export const REACT_EVENTS = {
  'react-done': [
    [
      'react',
      {
        project: 'demo',
        state: 'running',
        trigger: 'watch',
        files: { done: 0, total: 4 },
        cached: 2,
      },
    ],
    ['react', { project: 'demo', state: 'done', summary: summaryOf(MAIN), ms: 310 }],
  ],
  'react-running': [
    [
      'react',
      {
        project: 'demo',
        state: 'running',
        trigger: 'startup',
        files: { done: 3, total: 4 },
        cached: 2,
      },
    ],
  ],
  'react-measuring': [
    [
      'react',
      {
        project: 'demo',
        state: 'running',
        trigger: 'watch',
        files: { done: 4, total: 4 },
        cached: 2,
      },
    ],
    ['check', { project: 'demo', state: 'running', ids: ['ui-button--primary'], renders: true }],
    ['check', { project: 'demo', state: 'progress', done: 3, total: 7 }],
  ],
};
