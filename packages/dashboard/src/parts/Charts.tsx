/**
 * The dashboard's two chart shapes on the contract's `Chart`. Sizing is the dashboard's; colours,
 * axes, legend and tooltip are the adapter's.
 */
import { Chart, type SeriesDef } from '@ui';
import * as s from '../dashboard.css';

export type { SeriesDef };

/** Horizontal grouped bars: one row per category, one bar per series. */
export function HBars({
  data,
  series,
  category,
  format = (v: number) => String(v),
  max,
  height = 16,
}: {
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
    />
  );
}

/** Lines over an ordered x (runs, grids). */
export function Lines({
  data,
  series,
  x,
  format = (v: number) => String(v),
  height = 16,
}: {
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
    />
  );
}
