/**
 * A page for the chart tests (test/ui-chart.test.mjs): `@ui`'s Chart, built with whichever adapter
 * the test picks, between two buttons, once as a line and once as bars, each named by `label` and
 * summarised by `summary` (UI contract 1.8.0). It also puts the dashboard's summaries
 * (src/parts/chart-summary.ts) of a few data shapes on `window.harness.summaries`.
 */
import { createRoot } from 'react-dom/client';
import { Chart, UiRoot } from '@ui';
import { chartSummary } from '../../../src/parts/chart-summary';

const copy = {
  summary: ({ count, data }: { count: number; data: string }) => `Shown, ${count}: ${data}.`,
  noData: 'Shown: no data.',
};
const ms = (v: number) => `${v} ms`;
const one = [{ key: 'v', label: 'V' }];
const two = [
  { key: 'a', label: 'A' },
  { key: 'b', label: 'B' },
];
const summaries = {
  line: chartSummary(
    'line',
    copy,
    [
      { x: 1, v: 3 },
      { x: 2, v: 12 },
    ],
    one,
    'x',
    String
  ),
  flat: chartSummary('line', copy, [{ x: 1, v: 3 }], one, 'x', String),
  lines: chartSummary(
    'line',
    copy,
    [
      { x: 1, a: 1, b: 5 },
      { x: 2, a: 2, b: 5 },
    ],
    two,
    'x',
    String
  ),
  bars: chartSummary(
    'bar',
    copy,
    [
      { way: 'CLI process', v: 3 },
      { way: 'Server request', v: 120 },
    ],
    one,
    'way',
    ms
  ),
  groups: chartSummary(
    'bar',
    copy,
    [
      { s: 'S1', a: 1, b: 2 },
      { s: 'S2', a: 3, b: 4 },
    ],
    two,
    's',
    String
  ),
  empty: chartSummary('line', copy, [], one, 'x', String),
  noNumbers: chartSummary('line', copy, [{ x: 1, v: Number.NaN }], one, 'x', String),
};
Object.assign(window, { harness: { summaries } });

const data = [
  { run: 1, failed: 3 },
  { run: 2, failed: 12 },
  { run: 3, failed: 7 },
];
const series = [{ key: 'failed', label: 'Changed' }];

createRoot(document.getElementById('root')!).render(
  <UiRoot>
    <button type="button">Before</button>
    <div style={{ inlineSize: '40rem' }}>
      <Chart
        kind="line"
        data={data}
        series={series}
        x="run"
        height="12rem"
        label="Changed Entries per Run"
        summary="Changed entries per run, 3 runs: 3 to 12."
      />
      <Chart
        kind="bar"
        data={data}
        series={series}
        x="run"
        height="12rem"
        label="Changed by Run"
        summary="Changed by run, 3 runs: 3 to 12."
      />
    </div>
    <button type="button">After</button>
  </UiRoot>
);
