import { Card, CardContent, CardDescription, CardHeader, CardTitle, DataTable, StatGroup } from '@ui';
import { type Data, fmt } from '../data';
import { Lines } from '../parts/Charts';
import { Cmd, t, tx } from '../copy';
import * as s from '../dashboard.css';

/** The Runs tab: the last check's timing, then every recorded run. */
export function History({ data }: { data: Data }) {
  const runs = data.history ?? [];
  const sm = data.check?.summary;
  const latest = sm ? (
    <Card>
      <CardHeader>
        <CardTitle>{t('runs.latest.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <StatGroup
          layout="strip"
          label={t('runs.latest.title')}
          items={[
            { label: t('runs.latest.render'), value: fmt.ms(sm.renderWallMs), unit: t('runs.latest.pages', { count: sm.concurrency }) },
            { label: t('runs.latest.engine'), value: fmt.ms(sm.rustEngineMs), unit: t('runs.latest.cached', { count: sm.cached }) },
            { label: t('runs.latest.retries'), value: fmt.ms(sm.retryMs) },
            { label: t('runs.latest.scope'), value: sm.affected ?? t('runs.latest.allEntries') },
          ]}
        />
      </CardContent>
    </Card>
  ) : null;
  if (!runs.length)
    return (
      <div className={s.stack}>
        {latest}
        <div className={s.empty}>{tx('runs.empty', { file: <Cmd>reports/history.ndjson</Cmd> })}</div>
      </div>
    );
  const series = runs.map((r, i) => ({ run: i + 1, failed: r.summary.failed, engine: Math.round(r.summary.elapsedMs), cached: r.summary.cached }));
  return (
    <div className={s.stack}>
      {latest}
      <div className={s.twoCol}>
        <Card>
          <CardHeader>
            <CardTitle>{t('runs.changed.title')}</CardTitle>
            <CardDescription>{t('runs.changed.description', { count: runs.length })}</CardDescription>
          </CardHeader>
          <CardContent>
            <Lines data={series} x="run" series={[{ key: 'failed', label: t('runs.changed.series') }]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('runs.engine.title')}</CardTitle>
            <CardDescription>{t('runs.engine.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Lines data={series} x="run" format={(v) => `${v} ms`} series={[{ key: 'engine', label: t('runs.engine.series') }]} />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('runs.table.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={[...runs].reverse().map((r, i) => ({ id: String(i), at: new Date(r.at).toLocaleString(), entries: r.summary.stories, failed: r.summary.failed, cached: r.summary.cached, engine: fmt.ms(r.summary.elapsedMs), ids: r.failedIds.slice(0, 4).join(', ') + (r.failedIds.length > 4 ? '…' : '') }))}
            rowId={(r) => r.id}
            columns={[
              { id: 'at', field: 'at', header: t('runs.table.when') },
              { id: 'entries', field: 'entries', header: t('runs.table.entries') },
              { id: 'failed', field: 'failed', header: t('runs.table.changed') },
              { id: 'cached', field: 'cached', header: t('runs.table.cached') },
              { id: 'engine', field: 'engine', header: t('runs.table.engine') },
              { id: 'ids', field: 'ids', header: t('runs.table.ids') },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
