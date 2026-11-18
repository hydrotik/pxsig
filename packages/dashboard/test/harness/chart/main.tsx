/**
 * A page for the chart tests (test/ui-chart.test.mjs): `@ui`'s Chart, built with whichever adapter
 * the test picks, between two buttons, once as a line and once as bars, each named by `label` and
 * summarised by `summary` (UI contract 1.8.0).
 */
import { createRoot } from 'react-dom/client';
import { Chart, UiRoot } from '@ui';

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
