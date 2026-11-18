/**
 * The dashboard's two chart shapes on the contract's `Chart`. Sizing is the dashboard's; colours,
 * axes, legend and tooltip are the adapter's. Every chart is named (`label`, its card's title) and
 * summarised in text (`summary`, its copy around the data's ranges: chart-summary.ts).
 */
import { Chart, type SeriesDef } from '@ui';
import * as s from '../dashboard.css';
import { chartSummary, type SummaryVars } from './chart-summary';

export type { SeriesDef };

/** The default value format. Declared once: a default parameter that is a function stops the React Compiler. */
const plain = (v: number) => String(v);

/** Horizontal grouped bars: one row per category, one bar per series. */
export function HBars({
  data,
  series,
  category,
  format = plain,
  max,
  height = 16,
  label,
  summary,
}: {
  label: string;
  summary: (vars: SummaryVars) => string;
  data: Record<string, unknown>[];
  series: SeriesDef[];
  category: string;
  format?: (v: number) => string;
  max?: number;
  height?: number;
}) {
  return (
    <Chart
      kind="bar"
      className={s.chartBox}
      height={`${Math.max(height, data.length * series.length * 1.1 + 4)}rem`}
      data={data}
      series={series}
      x={category}
      format={format}
      max={max}
      label={label}
      summary={chartSummary(summary, data, series, format)}
    />
  );
}

/** Lines over an ordered x (runs, grids). */
export function Lines({
  data,
  series,
  x,
  format = plain,
  height = 16,
  label,
  summary,
}: {
  label: string;
  summary: (vars: SummaryVars) => string;
  data: Record<string, unknown>[];
  series: SeriesDef[];
  x: string;
  format?: (v: number) => string;
  height?: number;
}) {
  return (
    <Chart
      kind="line"
      className={s.chartBox}
      height={`${height}rem`}
      data={data}
      series={series}
      x={x}
      format={format}
      label={label}
      summary={chartSummary(summary, data, series, format)}
    />
  );
}
