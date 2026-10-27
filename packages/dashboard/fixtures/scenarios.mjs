/**
 * scenarios.mjs — sample data for the dashboard: what `/__pxsig/data` would return, as named
 * scenarios. The flows tests (test/flows.test.mjs) and `pxsig dashboard check` share it, so every
 * screen the check renders is one the tests exercise.
 *
 * Neutral names (`demo`, `ui-button--…`) and fixed timestamps: two runs give the same JSON. No
 * project data, no store, no images (the check generates its images at run time).
 */

export const AT = '2026-10-24T10:00:00.000Z';

// --- builders -----------------------------------------------------------------------------------

export const row = (id, extra = {}) => ({ id, story: id.replace(/(__[^@]+)?(@.+)?$/, ''), mode: id.includes('@light') ? 'light' : 'dark', state: null, pass: true, metrics: { ssim: 1, changedCells: 0 }, reasons: [], checkedAt: AT, ...extra });
export const changed = { pass: false, changed: true, metrics: { ssim: 0.8, changedCells: 12, changedCellsPct: 3, grid: 64 }, reasons: ['ssim 0.8 < min 0.99'] };
export const entry = (id, issues = []) => ({ id, story: id.replace(/(__[^@]+)?(@.+)?$/, ''), component: 'Button', mode: 'dark', state: null, status: issues[0]?.code ?? 'ok', severity: issues[0]?.severity ?? 'info', issues, files: { sig: `${id}.psig`, sigExists: !issues.some((i) => i.code === 'unbaselined'), baseImage: true, latestRender: true } });
export const inComponent = (component, id, issues) => ({ ...entry(id, issues), component });
export const stale = { code: 'stale', severity: 'warn', reason: 'src/x.tsx edited after the verdict' };
export const history = (n) => Array.from({ length: n }, (_, i) => ({ at: `2026-10-2${i}T10:00:00.000Z`, summary: { stories: 4, failed: i % 3, cached: 0, elapsedMs: 40 }, failedIds: [] }));

/** The served data for these rows and ledger entries. */
export function data({ rows, entries, summary = {} }) {
  const byCode = {};
  for (const x of entries) for (const i of x.issues) byCode[i.code] = (byCode[i.code] ?? 0) + 1;
  const err = entries.filter((x) => x.severity === 'error').length;
  const warn = entries.filter((x) => x.severity === 'warn').length;
  return {
    generatedAt: AT,
    project: 'demo',
    store: '.pxsig',
    check: {
      generatedAt: AT,
      manifest: { grid: 64, gate: null, modes: null, defaultMode: 'dark' },
      summary: { entries: rows.length, checked: rows.length, skipped: 0, passed: rows.filter((r) => r.pass).length, failed: rows.filter((r) => !r.pass).length, flaky: 0, errors: rows.filter((r) => r.error).length, cached: 0, a11yViolations: 0, a11yNew: 0, modes: ['dark', 'light'], concurrency: 1, renderWallMs: 100, rustEngineMs: 1, rustProcessMs: 1, retryMs: 0, affected: null, totalMs: 200, ...summary },
      rows,
    },
    detailCalibration: null,
    bench: null,
    history: [],
    review: {},
    a11yReview: {},
    storybook: { baseUrl: 'http://127.0.0.1:1' },
    paths: { diffRoot: '/p/demo/diffs/', renders: '/p/demo/renders/', baselines: '' },
    sigs: {},
    integrity: {
      schemaVersion: 1,
      generatedAt: AT,
      sources: { storyIndex: { source: 'storybook', inScope: entries.length }, report: { generatedAt: AT } },
      setup: [],
      summary: { status: err ? 'attention' : warn ? 'warnings' : 'clean', headline: '', entries: entries.length, components: 1, componentsBySeverity: { error: err ? 1 : 0, warn: !err && warn ? 1 : 0, info: 0 }, bySeverity: { error: err, warn, info: entries.length - err - warn }, byCode },
      components: [{ component: 'Button', status: entries[0]?.status ?? 'ok', severity: err ? 'error' : warn ? 'warn' : 'info', entries: entries.length, stories: 1, counts: byCode }],
      entries,
    },
  };
}

/** Entries spread over components (`Name:index`), the ledger's components counted from them. */
export function spread(d) {
  const L = d.integrity;
  const names = [...new Set(L.entries.map((x) => x.component))];
  L.components = names.map((component) => {
    const es = L.entries.filter((x) => x.component === component);
    const counts = {};
    for (const x of es) for (const i of x.issues) counts[i.code] = (counts[i.code] ?? 0) + 1;
    const severity = es.some((x) => x.severity === 'error') ? 'error' : es.some((x) => x.severity === 'warn') ? 'warn' : 'info';
    return { component, status: es.find((x) => x.severity === severity)?.status ?? 'ok', severity, entries: es.length, stories: 1, counts };
  });
  const by = { error: 0, warn: 0, info: 0 };
  for (const c of L.components) by[c.severity]++;
  L.summary.components = L.components.length;
  L.summary.componentsBySeverity = by;
  L.summary.status = by.error ? 'attention' : by.warn ? 'warnings' : 'clean';
  return d;
}

// --- named scenarios ----------------------------------------------------------------------------

const PRIMARY = 'ui-button--primary';
const changedIssue = { code: 'changed', severity: 'warn', reason: 'gate failed' };
const contrast = { id: 'color-contrast', impact: 'serious', help: 'Elements must meet minimum color contrast ratio thresholds', nodes: 2, targets: ['.label'] };

/** What `pxsig bench` writes: enough for the Diagnostics section's Performance part. */
const bench = {
  generatedAt: AT,
  project: 'demo',
  stories: 4,
  cpus: 8,
  cpu: 'sample cpu',
  runs: 3,
  check: { rust: { warm: { internalMs: 12, wallMs: 20 }, cold: { internalMs: 30, wallMs: 45 } } },
  capture: { rustWallMs: 30, rustInternalMs: 25 },
  perCall: { rustMs: 1, serveMs: 2, samples: 10 },
  memory: { rustPeakRssBytes: 12_000_000 },
  footprint: { rustBinaryBytes: 5_000_000 },
  render: { stories: 4, byConcurrency: { 1: { wallMs: 400, msPerStory: 100, errors: 0 }, 4: { wallMs: 160, msPerStory: 40, errors: 0 } } },
};

/**
 * Every scenario by name: a function returning fresh data. The server behaviours that are not data
 * (`loading`: the data never arrives; `load-error`: the data request fails; `offline`: no event
 * stream; `static`: the data inlined, as `pxsig report` writes it) are named by SERVER_STATES and
 * use the `clean` data.
 */
export const SCENARIOS = {
  clean() {
    const ids = ['ui-button--primary', 'ui-button--primary@light', 'ui-card--default', 'ui-card--default@light'];
    const d = spread(data({ rows: ids.map((id) => row(id)), entries: [...ids.slice(0, 2).map((id) => entry(id)), ...ids.slice(2).map((id) => inComponent('Card', id))] }));
    d.history = history(4);
    d.bench = bench;
    return d;
  },
  changed() {
    const d = data({
      rows: [row(PRIMARY, changed), row(`${PRIMARY}@light`, { ...changed, mode: 'light' }), row('ui-button--ok')],
      entries: [entry(PRIMARY, [changedIssue]), entry(`${PRIMARY}@light`, [changedIssue]), entry('ui-button--ok')],
    });
    d.history = history(3);
    return d;
  },
  'first-approval'() {
    const ids = ['ui-button--new', 'ui-button--new@light'];
    return data({
      rows: [row('ui-button--ok'), ...ids.map((id) => row(id, { pass: false, new: true, metrics: null, reasons: ['new'] }))],
      entries: [entry('ui-button--ok'), ...ids.map((id) => entry(id, [{ code: 'unbaselined', severity: 'warn', reason: 'no signature' }]))],
    });
  },
  errors() {
    const broken = 'ui-card--broken';
    const d = spread(
      data({
        rows: [row('ui-button--ok'), row(broken, { pass: false, metrics: null, error: 'locator.click: Timeout 5000ms exceeded' })],
        entries: [entry('ui-button--ok', [stale]), inComponent('Card', broken, [{ code: 'never-checked', severity: 'error', reason: 'no verdict' }])],
      })
    );
    d.history = history(3);
    return d;
  },
  a11y() {
    const ids = ['ui-button--primary', 'ui-button--primary@light'];
    return data({
      rows: ids.map((id) => row(id, { a11y: { violations: [contrast], new: 1, baseline: [] } })),
      entries: ids.map((id) => entry(id, [{ code: 'a11y-new', severity: 'warn', reason: 'color-contrast is new' }])),
      summary: { a11yViolations: 2, a11yNew: 2 },
    });
  },
  flaky() {
    return data({ rows: [row('ui-button--primary', { flaky: true }), row('ui-button--ok')], entries: [entry('ui-button--primary', [{ code: 'flaky', severity: 'warn', reason: 'passed on retry' }]), entry('ui-button--ok')], summary: { flaky: 1 } });
  },
  stale() {
    const d = spread(
      data({
        rows: [],
        entries: [
          inComponent('Button', 'ui-button--a', [stale]),
          inComponent('Button', 'ui-button--b'),
          inComponent('Button', 'ui-button--c'),
          inComponent('Card', 'ui-card--a', [stale]),
          inComponent('Card', 'ui-card--b', [stale]),
          inComponent('Dialog', 'ui-dialog--a'),
        ],
      })
    );
    d.history = history(2);
    return d;
  },
  empty() {
    const d = data({ rows: [], entries: [] });
    d.check = null;
    d.integrity = null;
    return d;
  },
  'several-projects'() {
    return SCENARIOS.clean();
  },
};

/** Scenarios that are a server behaviour over the `clean` data, not data of their own. */
export const SERVER_STATES = ['loading', 'load-error', 'offline', 'static'];
/** What the data request answers in the `load-error` state. */
export const LOAD_ERROR = 'the report could not be read (sample)';

export const scenarioNames = () => [...Object.keys(SCENARIOS), ...SERVER_STATES];

/** The projects `/__pxsig/projects` lists for a scenario. */
export function projectsOf(name) {
  const one = (n, entries) => ({ name: n, root: n === 'demo' ? '.' : `packages/${n}`, entries, integrity: null });
  const d = scenarioData(name);
  const entries = d.check?.rows.length ?? 0;
  return name === 'several-projects' ? [one('demo', entries), one('docs', 12)] : [one('demo', entries)];
}

/** The data for a scenario name (the server states use `clean`). */
export function scenarioData(name) {
  if (SERVER_STATES.includes(name)) return SCENARIOS.clean();
  const f = SCENARIOS[name];
  if (!f) throw new Error(`unknown dashboard scenario "${name}" (known: ${scenarioNames().join(', ')})`);
  return f();
}
