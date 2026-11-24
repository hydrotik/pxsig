/**
 * A chart's text summary (UI contract 1.9.0), from the same data, series and format as the chart.
 * Lines: each series' lowest and highest value ("3 to 12"), or the value alone when they are the
 * same, named by its series when there are several. Bars: each bar's value, by its category ("CLI
 * process 3 ms, Server request 120 ms"), and by series when there are several. A chart with no
 * number gets its no-data copy. The words around the data are each chart's own copy.
 */
import type { SeriesDef } from '@ui';
import { t } from '../copy';

/** What a chart's summary copy gets: the number of points (rows) and the data as text. */
export type SummaryVars = { count: number; data: string };
/** A chart's summary copy: the words around the data, and the line for no data. */
export type SummaryCopy = { summary: (vars: SummaryVars) => string; noData: string };

type Rows = Record<string, unknown>[];
type Format = (v: number) => string;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One series over the rows: "3 to 12", or "3" when flat. Null without a number. */
function range(data: Rows, key: string, format: Format): string | null {
  const values = data.map((d) => d[key]).filter(num);
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? format(min) : t('ui.chart.range', { min: format(min), max: format(max) });
}

/** Lines: each series' range, named by the series when there are several. */
function lineParts(data: Rows, series: SeriesDef[], format: Format): string[] {
  return series.flatMap((sd) => {
    const r = range(data, sd.key, format);
    if (r === null) return [];
    return [series.length > 1 ? t('ui.chart.seriesRange', { series: sd.label, range: r }) : r];
  });
}

/** Bars: each bar's value by its category, and by its series when there are several. */
function barParts(data: Rows, series: SeriesDef[], x: string, format: Format): string[] {
  return data.flatMap((d) => {
    const bars = series.flatMap((sd) => {
      const v = d[sd.key];
      if (!num(v)) return [];
      const name = series.length > 1 ? sd.label : String(d[x]);
      return [t('ui.chart.value', { name, value: format(v) })];
    });
    if (!bars.length) return [];
    if (series.length === 1) return bars;
    const values = bars.join(t('ui.chart.listSeparator'));
    return [t('ui.chart.categoryValues', { category: String(d[x]), values })];
  });
}

/** The chart's summary: its copy around the data, or its no-data copy. */
export function chartSummary(
  kind: 'bar' | 'line',
  copy: SummaryCopy,
  data: Rows,
  series: SeriesDef[],
  x: string,
  format: Format
): string {
  const parts =
    kind === 'bar' ? barParts(data, series, x, format) : lineParts(data, series, format);
  if (!parts.length) return copy.noData;
  // One series of bars is one list ("A 3 ms, B 120 ms"); otherwise one part per series or
  // category ("A: …; B: …").
  const one = kind === 'bar' && series.length === 1;
  const sep = t(one ? 'ui.chart.listSeparator' : 'ui.chart.separator');
  return copy.summary({ count: data.length, data: parts.join(sep) });
}
