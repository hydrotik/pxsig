import { Card, CardContent, CardDescription, CardHeader, CardTitle, DataGrid } from '@hydrotik/design-system';
import { type Data, fmt } from '../data';
import { Lines } from '../parts/Charts';
import * as s from '../dashboard.css';

export function History({ data }: { data: Data }) {
  const runs = data.history ?? [];
  if (!runs.length) return <div className={s.empty}>No runs recorded yet: every check appends to the store's reports/history.ndjson.</div>;
  const series = runs.map((r, i) => ({ run: i + 1, failed: r.summary.failed, engine: Math.round(r.summary.elapsedMs), cached: r.summary.cached }));
  return (
    <div className={s.stack}>
      <div className={s.twoCol}>
        <Card>
          <CardHeader>
            <CardTitle>Changed entries per run</CardTitle>
            <CardDescription>{runs.length} runs recorded by the Rust check (--history).</CardDescription>
          </CardHeader>
          <CardContent>
            <Lines data={series} x="run" series={[{ key: 'failed', label: 'Changed' }]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Engine time per run</CardTitle>
            <CardDescription>Cache hits make re-checks of unchanged renders near-free.</CardDescription>
          </CardHeader>
          <CardContent>
            <Lines data={series} x="run" format={(v) => `${v} ms`} series={[{ key: 'engine', label: 'Rust engine ms' }]} />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Runs</CardTitle>
        </CardHeader>
        <CardContent>
          <DataGrid
            data={[...runs].reverse().map((r, i) => ({ id: String(i), at: new Date(r.at).toLocaleString(), entries: r.summary.stories, failed: r.summary.failed, cached: r.summary.cached, engine: fmt.ms(r.summary.elapsedMs), ids: r.failedIds.slice(0, 4).join(', ') + (r.failedIds.length > 4 ? '…' : '') }))}
            getRowId={(r: { id: string }) => r.id}
            density="compact"
            showToolbar={false}
            columns={[
              { id: 'at', accessorKey: 'at', header: 'When' },
              { id: 'entries', accessorKey: 'entries', header: 'Entries' },
              { id: 'failed', accessorKey: 'failed', header: 'Changed' },
              { id: 'cached', accessorKey: 'cached', header: 'Cached' },
              { id: 'engine', accessorKey: 'engine', header: 'Engine' },
              { id: 'ids', accessorKey: 'ids', header: 'Changed entries' },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
