import { Card, CardContent, CardDescription, CardHeader, CardTitle, StatPanel, StaticList, StaticListItem, StatusBadge } from '@hydrotik/design-system';
import { type Data, type ScenarioReport, fmt, suiteKeys, suiteTitle } from '../data';
import { HBars } from '../parts/Charts';
import * as s from '../dashboard.css';

function recall(rep: ScenarioReport | null) {
  if (!rep) return null;
  const regs = rep.scenarios.filter((x) => x.kind === 'regression');
  const noise = rep.scenarios.filter((x) => x.kind === 'noise');
  const changed = regs.reduce((a, x) => a + x.summary.changed, 0);
  return {
    changed,
    shipped: regs.reduce((a, x) => a + x.summary.detected, 0),
    whole: regs.reduce((a, x) => a + x.summary.detectedWholeImage, 0),
    fp: noise.reduce((a, x) => a + (x.summary.falsePositives ?? 0), 0),
    noise: noise.reduce((a, x) => a + x.summary.stories, 0),
  };
}

export function Overview({ data, go }: { data: Data; go(tab: string, filter?: string): void }) {
  const c = data.check;
  const sm = c?.summary;
  const suites = suiteKeys(data.scenarioSuites)
    .map((k) => ({ key: k, title: suiteTitle(k, data.scenarioSuites![k]), r: recall(data.scenarioSuites![k]) }))
    .filter((x) => x.r) as { key: string; title: string; r: NonNullable<ReturnType<typeof recall>> }[];
  const fp = suites.reduce((a, x) => a + x.r.fp, 0);
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  const g = c?.manifest.gate ?? {};
  return (
    <div className={s.stack}>
      {sm ? (
        <StatPanel
          aria-label="Latest check"
          cards={[
            { label: 'Checked', value: sm.checked, unit: sm.skipped ? `+${sm.skipped} unaffected` : `${sm.modes.join(' · ')}` },
            { label: 'Passed', value: sm.passed, accent: 'success' },
            { label: 'Changed', value: sm.failed, accent: sm.failed ? 'error' : undefined, type: 'filter', onSelect: () => go('stories', 'changed') },
            { label: 'Flaky', value: sm.flaky, accent: sm.flaky ? 'warning' : undefined, type: 'filter', onSelect: () => go('stories', 'flaky') },
            { label: 'New a11y issues', value: sm.a11yNew, unit: `of ${sm.a11yViolations}`, accent: sm.a11yNew ? 'error' : undefined, type: 'filter', onSelect: () => go('a11y') },
            { label: 'Total', value: fmt.ms(sm.totalMs), unit: `Rust ${fmt.ms(sm.rustEngineMs)}` },
          ]}
        />
      ) : (
        <div className={s.empty}>Run `pxsig check --full` to populate this view.</div>
      )}
      <div className={s.twoCol}>
        <Card>
          <CardHeader>
            <CardTitle>The gate as shipped</CardTitle>
            <CardDescription>Applied identically by CI, the dashboard and the Storybook addon. A story can tune it with parameters.pxsig.gate.</CardDescription>
          </CardHeader>
          <CardContent>
            <StaticList>
              <StaticListItem label="Signature">grid {c?.manifest.grid ?? 64}×{c?.manifest.grid ?? 64} RGB, box-averaged</StaticListItem>
              <StaticListItem label="Whole-image rule">
                ssim &lt; 0.99, or &gt; 2% of cells, or ≥ {g.minCells ?? 2} cells off by &gt; {g.threshold ?? 32}
              </StaticListItem>
              <StaticListItem label="Detail channel">16 px tiles, 4 px blocks: ≥ 3 tiles moved by &gt; 32 or gained an edge</StaticListItem>
              <StaticListItem label="Modes">{c ? Object.keys(c.manifest.modes ?? {}).join(' · ') : '—'}</StaticListItem>
              <StaticListItem label="Engine">Rust (pxsig-core), spec v1 signatures in .psig baselines</StaticListItem>
            </StaticList>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Does it catch real breaks?</CardTitle>
            <CardDescription>Simulated regressions, recall over renders whose pixels changed. Noise scenarios must never fail.</CardDescription>
          </CardHeader>
          <CardContent>
            {suites.length ? (
              <>
                <HBars
                  category="suite"
                  max={100}
                  format={(v) => `${v}%`}
                  series={[
                    { key: 'whole', label: 'Whole-image signature' },
                    { key: 'shipped', label: 'With detail channel (shipped)' },
                  ]}
                  data={suites.map((x) => ({ suite: x.title, whole: pct(x.r.whole, x.r.changed), shipped: pct(x.r.shipped, x.r.changed) }))}
                  height={10}
                />
                <StaticList orientation="horizontal">
                  {suites.map((x) => (
                    <StaticListItem key={x.key} label={x.title}>
                      {x.r.shipped}/{x.r.changed} caught
                    </StaticListItem>
                  ))}
                  <StaticListItem label="False positives">{fp === 0 ? <StatusBadge status="complete" label="0" /> : <StatusBadge status="failed" label={String(fp)} />}</StaticListItem>
                </StaticList>
              </>
            ) : (
              <div className={s.empty}>No simulated-regression run for this project yet: <code>node tools/scenarios.mjs</code> writes one.</div>
            )}
          </CardContent>
        </Card>
      </div>
      {sm ? (
        <Card>
          <CardHeader>
            <CardTitle>Where the time goes</CardTitle>
            <CardDescription>Rendering dominates; the engine is the Rust batch with a content cache.</CardDescription>
          </CardHeader>
          <CardContent>
            <StatPanel
              variant="strip"
              aria-label="Timing"
              cards={[
                { label: 'Render', value: fmt.ms(sm.renderWallMs), unit: `${sm.concurrency} pages` },
                { label: 'Rust engine', value: fmt.ms(sm.rustEngineMs), unit: `${sm.cached} cached` },
                { label: 'Retries', value: fmt.ms(sm.retryMs) },
                { label: 'Affected', value: sm.affected ?? 'all entries' },
              ]}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
