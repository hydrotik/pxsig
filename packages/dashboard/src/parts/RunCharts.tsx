/**
 * The per-run series of the recorded history (reports/history.ndjson), and the "Changed entries per
 * run" chart in its card: Runs shows it beside the engine time, the Overview in its right column.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui';
import type { HistoryRun } from '../data';
import { Lines } from './Charts';
import { t } from '../copy';

/** One point per recorded run, oldest first: changed entries, engine time, cached entries. */
export const runSeries = (runs: HistoryRun[]) =>
  runs.map((r, i) => ({
    run: i + 1,
    failed: r.summary.failed,
    engine: Math.round(r.summary.elapsedMs),
    cached: r.summary.cached,
  }));

/** Changed entries per run, as a line. Nothing without recorded runs. */
/** `height` in rem (the chart default when unset); the Overview passes a short one. */
export function ChangedPerRun({ runs, height }: { runs: HistoryRun[]; height?: number }) {
  if (!runs.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('runs.changed.title')}</CardTitle>
        <CardDescription>{t('runs.changed.description', { count: runs.length })}</CardDescription>
      </CardHeader>
      <CardContent>
        <Lines
          data={runSeries(runs)}
          x="run"
          series={[{ key: 'failed', label: t('runs.changed.series') }]}
          height={height}
        />
      </CardContent>
    </Card>
  );
}
