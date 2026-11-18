/**
 * A chart's text summary (UI contract 1.8.0), from the same data, series and format as the chart:
 * each series' lowest and highest value ("3 to 12"), named by its label when there are several.
 * The words around it are each chart's own copy (`summary` on `Lines` and `HBars`).
 */
import type { SeriesDef } from '@ui';
import { t } from '../copy';

/** What a chart's summary copy gets: the number of points (rows) and the ranges. */
export type SummaryVars = { count: number; range: string };

/** The ranges of every series that has a number, or null when none has one. */
export function seriesRange(
  data: Record<string, unknown>[],
  series: SeriesDef[],
  format: (v: number) => string
): string | null {
  const ranges = series.flatMap((sd) => {
    const values = data
      .map((d) => d[sd.key])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!values.length) return [];
    const range = t('ui.chart.range', {
      min: format(Math.min(...values)),
      max: format(Math.max(...values)),
    });
    return [series.length > 1 ? t('ui.chart.seriesRange', { series: sd.label, range }) : range];
  });
  return ranges.length ? ranges.join(t('ui.chart.separator')) : null;
}

/** The chart's summary: its copy around the ranges. Unset when no series has a number. */
export function chartSummary(
  summary: ((vars: SummaryVars) => string) | undefined,
  data: Record<string, unknown>[],
  series: SeriesDef[],
  format: (v: number) => string
): string | undefined {
  const range = summary ? seriesRange(data, series, format) : null;
  return summary && range !== null ? summary({ count: data.length, range }) : undefined;
}
