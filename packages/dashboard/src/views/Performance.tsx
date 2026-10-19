import { Card, CardContent, CardDescription, CardHeader, CardTitle, DataGrid, StatPanel } from '@hydrotik/design-system';
import { type Data, fmt } from '../data';
import { HBars } from '../parts/Charts';
import * as s from '../dashboard.css';

const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const mb = (b: number) => `${Math.round(b / 1e6)} MB`;
const callMs = (v: number) => (v >= 10 ? `${Math.round(v)} ms` : `${v.toFixed(v >= 1 ? 1 : 2)} ms`);

export function Performance({ data }: { data: Data }) {
  const b = data.bench;
  const c = data.check?.summary;
  if (!b)
    return (
      <div className={s.empty}>
        No benchmark data for this project: <code>node tools/bench.mjs</code> writes it.
      </div>
    );

  // Batch check by thread count, against one thread.
  const rust = b.check?.rust ?? {};
  const threads = Object.keys(rust)
    .map(Number)
    .filter((t) => ok(rust[t]?.wallMs))
    .sort((x, y) => x - y);
  const wall = (t: number) => rust[t].wallMs;
  const one = threads.includes(1) ? wall(1) : null;
  const top = threads[threads.length - 1];

  // Render throughput by page-pool size.
  const byConc = b.render?.byConcurrency ?? {};
  const pools = Object.keys(byConc)
    .map(Number)
    .filter((p) => ok(byConc[p]?.msPerStory))
    .sort((x, y) => x - y);
  const renders = pools.map((p) => ({ pages: `${p} page${p === 1 ? '' : 's'}`, ms: Math.round(byConc[p].msPerStory) }));

  const capWall = b.capture?.rustWallMs;
  const capInternal = b.capture?.rustInternalMs;
  const cli = b.perCall?.rustMs;
  const serve = b.perCall?.serveMs;
  const perCall = ok(cli) && ok(serve);
  const rss = b.memory?.rustPeakRssBytes;
  const bin = b.footprint?.rustBinaryBytes;
  const cards = [
    ...(top !== undefined ? [{ label: `Batch check · ${top} thread${top === 1 ? '' : 's'}`, value: fmt.ms(wall(top)), unit: one && top !== 1 ? `${fmt.x(one / wall(top))} vs 1 thread` : `${b.stories} renders`, accent: 'success' as const }] : []),
    ...(ok(capWall) ? [{ label: 'Baselines (capture)', value: fmt.ms(capWall), unit: ok(capInternal) ? `${fmt.ms(capInternal)} in engine` : `${b.stories} renders` }] : []),
    ...(perCall ? [{ label: 'Per call, CLI → daemon', value: `${callMs(cli!)} → ${callMs(serve!)}`, unit: fmt.x(cli! / serve!) }] : []),
    ...(ok(rss) ? [{ label: 'Peak memory (batch check)', value: mb(rss) }] : []),
    ...(ok(bin) ? [{ label: 'Binary size', value: mb(bin) }] : []),
    ...(c ? [{ label: 'Full check (latest)', value: fmt.ms(c.totalMs), unit: `${c.checked} entries` }] : []),
  ];
  if (!threads.length && !renders.length && !ok(capWall) && !perCall)
    return (
      <div className={s.empty}>
        The benchmark report has no results: re-run <code>node tools/bench.mjs</code>.
      </div>
    );

  return (
    <div className={s.stack}>
      <span className={s.muted}>
        {b.stories} entries · {b.cpus} CPUs{b.cpu ? ` (${b.cpu})` : ''} · median of {b.runs} runs{b.generatedAt ? ` · ${new Date(b.generatedAt).toLocaleString()}` : ''}
      </span>
      {cards.length ? <StatPanel aria-label="Engine" cards={cards} /> : null}
      <div className={s.twoCol}>
        <Card>
          <CardHeader>
            <CardTitle>Rendering: ms per story by page-pool size</CardTitle>
            <CardDescription>{b.render ? `${b.render.stories} stories per run. ` : ''}Rendering is most of a run; parallel pages are the biggest lever.</CardDescription>
          </CardHeader>
          <CardContent>
            {renders.length ? (
              <>
                <HBars data={renders} category="pages" series={[{ key: 'ms', label: 'ms per story' }]} format={(v) => `${v} ms`} height={10} />
                <DataGrid
                  data={pools.map((p) => ({
                    id: String(p),
                    pages: p,
                    wall: ok(byConc[p].wallMs) ? fmt.ms(byConc[p].wallMs) : '—',
                    ms: Math.round(byConc[p].msPerStory),
                    speedup: pools.includes(1) ? fmt.x(byConc[1].msPerStory / byConc[p].msPerStory) : '—',
                    errors: byConc[p].errors ?? 0,
                    reloads: byConc[p].reloads ?? 0,
                  }))}
                  getRowId={(r: { id: string }) => r.id}
                  density="compact"
                  showToolbar={false}
                  columns={[
                    { id: 'pages', accessorKey: 'pages', header: 'Pages' },
                    { id: 'wall', accessorKey: 'wall', header: 'Wall' },
                    { id: 'ms', accessorKey: 'ms', header: 'ms / story' },
                    { id: 'speedup', accessorKey: 'speedup', header: 'vs 1 page' },
                    { id: 'errors', accessorKey: 'errors', header: 'Errors' },
                    { id: 'reloads', accessorKey: 'reloads', header: 'Reloads' },
                  ]}
                />
              </>
            ) : (
              <div className={s.empty}>No render timings in this benchmark (run without --no-render to measure them).</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Batch check by thread count</CardTitle>
            <CardDescription>Same renders, same verdicts. Wall is the whole process; engine is the time the engine reports.</CardDescription>
          </CardHeader>
          <CardContent>
            {threads.length ? (
              <DataGrid
                data={threads.map((t) => ({ id: String(t), threads: t, wall: Math.round(wall(t)), internal: ok(rust[t].internalMs) ? Math.round(rust[t].internalMs) : '—', speedup: one ? fmt.x(one / wall(t)) : '—' }))}
                getRowId={(r: { id: string }) => r.id}
                density="compact"
                showToolbar={false}
                columns={[
                  { id: 'threads', accessorKey: 'threads', header: 'Threads' },
                  { id: 'wall', accessorKey: 'wall', header: 'Wall ms' },
                  { id: 'internal', accessorKey: 'internal', header: 'Engine ms' },
                  { id: 'speedup', accessorKey: 'speedup', header: 'vs 1 thread' },
                ]}
              />
            ) : (
              <div className={s.empty}>No batch-check timings in this benchmark.</div>
            )}
          </CardContent>
        </Card>
      </div>
      {perCall ? (
        <Card>
          <CardHeader>
            <CardTitle>One compare: CLI process vs stdio daemon</CardTitle>
            <CardDescription>
              Median over {b.perCall?.samples ?? '?'} entries. A process per call pays start-up every time; <code>pxsig serve</code> keeps one engine open and answers requests over stdio.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HBars
              data={[
                { way: 'CLI process', ms: Number(cli!.toFixed(2)) },
                { way: 'Daemon request', ms: Number(serve!.toFixed(2)) },
              ]}
              category="way"
              series={[{ key: 'ms', label: 'ms per compare' }]}
              format={(v) => `${v} ms`}
              height={6}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
