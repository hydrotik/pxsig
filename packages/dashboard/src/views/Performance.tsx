import { Card, CardContent, CardDescription, CardHeader, CardTitle, DataGrid, StatPanel } from '@hydrotik/design-system';
import { type Data, fmt } from '../data';
import { HBars } from '../parts/Charts';
import { Cmd, t, tx } from '../copy';
import * as s from '../dashboard.css';

const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const mb = (b: number) => `${Math.round(b / 1e6)} MB`;
const callMs = (v: number) => (v >= 10 ? `${Math.round(v)} ms` : `${v.toFixed(v >= 1 ? 1 : 2)} ms`);

export function Performance({ data }: { data: Data }) {
  const b = data.bench;
  const c = data.check?.summary;
  if (!b)
    return (
      <div className={s.empty}>{tx('diagnostics.performance.empty', { command: <Cmd>node tools/bench.mjs</Cmd> })}</div>
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
  const renders = pools.map((p) => ({ pages: t('diagnostics.performance.pages', { count: p }), ms: Math.round(byConc[p].msPerStory) }));

  const capWall = b.capture?.rustWallMs;
  const capInternal = b.capture?.rustInternalMs;
  const cli = b.perCall?.rustMs;
  const serve = b.perCall?.serveMs;
  const perCall = ok(cli) && ok(serve);
  const rss = b.memory?.rustPeakRssBytes;
  const bin = b.footprint?.rustBinaryBytes;
  const cards = [
    ...(top !== undefined ? [{ label: t('diagnostics.performance.batch', { count: top }), value: fmt.ms(wall(top)), unit: one && top !== 1 ? t('diagnostics.performance.vsOne', { factor: fmt.x(one / wall(top)) }) : t('diagnostics.performance.renders', { count: b.stories }) }] : []),
    ...(ok(capWall) ? [{ label: t('diagnostics.performance.capture'), value: fmt.ms(capWall), unit: ok(capInternal) ? t('diagnostics.performance.inEngine', { ms: fmt.ms(capInternal) }) : t('diagnostics.performance.renders', { count: b.stories }) }] : []),
    ...(perCall ? [{ label: t('diagnostics.performance.perCall'), value: `${callMs(cli!)} → ${callMs(serve!)}`, unit: fmt.x(cli! / serve!) }] : []),
    ...(ok(rss) ? [{ label: t('diagnostics.performance.memory'), value: mb(rss) }] : []),
    ...(ok(bin) ? [{ label: t('diagnostics.performance.binary'), value: mb(bin) }] : []),
    ...(c ? [{ label: t('diagnostics.performance.fullCheck'), value: fmt.ms(c.totalMs), unit: t('diagnostics.performance.entries', { count: c.checked }) }] : []),
  ];
  if (!threads.length && !renders.length && !ok(capWall) && !perCall)
    return (
      <div className={s.empty}>{tx('diagnostics.performance.noResults', { command: <Cmd>node tools/bench.mjs</Cmd> })}</div>
    );

  return (
    <div className={s.stack}>
      <span className={s.muted}>
        {[t('diagnostics.performance.entries', { count: b.stories }), `${t('diagnostics.performance.cpus', { count: b.cpus })}${b.cpu ? ` (${b.cpu})` : ''}`, t('diagnostics.performance.median', { count: b.runs }), ...(b.generatedAt ? [new Date(b.generatedAt).toLocaleString()] : [])].join(' · ')}
      </span>
      {cards.length ? <StatPanel aria-label={t('diagnostics.performance.engine')} cards={cards} /> : null}
      <div className={s.twoCol}>
        <Card>
          <CardHeader>
            <CardTitle>{t('diagnostics.performance.renderTitle')}</CardTitle>
            {b.render ? <CardDescription>{t('diagnostics.performance.renderDescription', { count: b.render.stories })}</CardDescription> : null}
          </CardHeader>
          <CardContent>
            {renders.length ? (
              <>
                <HBars data={renders} category="pages" series={[{ key: 'ms', label: t('diagnostics.performance.renderSeries') }]} format={(v) => `${v} ms`} height={10} />
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
                    { id: 'pages', accessorKey: 'pages', header: t('diagnostics.performance.pagesColumn') },
                    { id: 'wall', accessorKey: 'wall', header: t('diagnostics.performance.wall') },
                    { id: 'ms', accessorKey: 'ms', header: t('diagnostics.performance.msPerStory') },
                    { id: 'speedup', accessorKey: 'speedup', header: t('diagnostics.performance.vsOnePage') },
                    { id: 'errors', accessorKey: 'errors', header: t('diagnostics.performance.errors') },
                    { id: 'reloads', accessorKey: 'reloads', header: t('diagnostics.performance.reloads') },
                  ]}
                />
              </>
            ) : (
              <div className={s.empty}>{tx('diagnostics.performance.noRender', { flag: <Cmd>--no-render</Cmd> })}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('diagnostics.performance.threadsTitle')}</CardTitle>
            <CardDescription>{t('diagnostics.performance.threadsDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            {threads.length ? (
              <DataGrid
                data={threads.map((t) => ({ id: String(t), threads: t, wall: Math.round(wall(t)), internal: ok(rust[t].internalMs) ? Math.round(rust[t].internalMs) : '—', speedup: one ? fmt.x(one / wall(t)) : '—' }))}
                getRowId={(r: { id: string }) => r.id}
                density="compact"
                showToolbar={false}
                columns={[
                  { id: 'threads', accessorKey: 'threads', header: t('diagnostics.performance.threads') },
                  { id: 'wall', accessorKey: 'wall', header: t('diagnostics.performance.wallMs') },
                  { id: 'internal', accessorKey: 'internal', header: t('diagnostics.performance.engineMs') },
                  { id: 'speedup', accessorKey: 'speedup', header: t('diagnostics.performance.vsOneThread') },
                ]}
              />
            ) : (
              <div className={s.empty}>{t('diagnostics.performance.noThreads')}</div>
            )}
          </CardContent>
        </Card>
      </div>
      {perCall ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('diagnostics.performance.perCallTitle')}</CardTitle>
            <CardDescription>{tx('diagnostics.performance.perCallDescription', { count: b.perCall?.samples ?? '?', command: <Cmd>pxsig serve</Cmd> })}</CardDescription>
          </CardHeader>
          <CardContent>
            <HBars
              data={[
                { way: t('diagnostics.performance.cli'), ms: Number(cli!.toFixed(2)) },
                { way: t('diagnostics.performance.server'), ms: Number(serve!.toFixed(2)) },
              ]}
              category="way"
              series={[{ key: 'ms', label: t('diagnostics.performance.perCallSeries') }]}
              format={(v) => `${v} ms`}
              height={6}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
