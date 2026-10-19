/**
 * Charts on the design system's Chart (recharts + tokens). Categorical colours
 * come from the chart tokens in a fixed order; text stays in text tokens.
 */
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { vars } from '@hydrotik/tokens';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@hydrotik/design-system/chart';
import * as s from '../dashboard.css';

const SERIES = [vars.color.chart1, vars.color.chart2, vars.color.chart3, vars.color.chart4];

export interface SeriesDef {
  key: string;
  label: string;
}

/** Horizontal grouped bars: one row per category, one bar per series. */
export function HBars({ data, series, category, format = (v: number) => String(v), max, height = 16 }: { data: Record<string, unknown>[]; series: SeriesDef[]; category: string; format?: (v: number) => string; max?: number; height?: number }) {
  const config = Object.fromEntries(series.map((x, i) => [x.key, { label: x.label, color: SERIES[i % SERIES.length] }]));
  return (
    <ChartContainer config={config} className={s.chartBox} style={{ blockSize: `${Math.max(height, data.length * series.length * 1.1 + 4)}rem` }}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }} barGap={2}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" domain={[0, max ?? 'auto']} tickFormatter={format} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey={category} width={150} tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        {series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {series.map((x) => (
          <Bar key={x.key} dataKey={x.key} fill={`var(--color-${x.key})`} radius={[0, 4, 4, 0]} />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

/** Lines over an ordered x (runs, grids). */
export function Lines({ data, series, x, format = (v: number) => String(v), height = 16 }: { data: Record<string, unknown>[]; series: SeriesDef[]; x: string; format?: (v: number) => string; height?: number }) {
  const config = Object.fromEntries(series.map((sd, i) => [sd.key, { label: sd.label, color: SERIES[i % SERIES.length] }]));
  return (
    <ChartContainer config={config} className={s.chartBox} style={{ blockSize: `${height}rem` }}>
      <LineChart data={data} margin={{ left: 8, right: 24, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey={x} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={format} tickLine={false} axisLine={false} width={48} />
        <ChartTooltip content={<ChartTooltipContent />} />
        {series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {series.map((sd) => (
          <Line key={sd.key} dataKey={sd.key} stroke={`var(--color-${sd.key})`} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
        ))}
      </LineChart>
    </ChartContainer>
  );
}
