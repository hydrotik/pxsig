import React from 'react';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Progress, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatPanel, ToggleGroup, ToggleGroupItem } from '@hydrotik/design-system';
import { type Data, type Row, type Scenario, fmt, suiteKeys, suiteTitle } from '../data';
import { StoryGrid } from '../parts/StoryGrid';
import * as s from '../dashboard.css';

const asRow = (r: Scenario['rows'][number]): Row => ({ ...r, story: r.id, mode: 'dark', state: null, pass: r.pass ?? false } as Row);

export function Scenarios({ data, onOpen }: { data: Data; onOpen(row: Row, list: Row[], scenario: { tag: string; name: string }): void }) {
  const all = data.scenarioSuites ?? {};
  const suites = suiteKeys(all);
  const [picked, setSuite] = React.useState<string | null>(null);
  const suite = picked && all[picked] ? picked : suites[0];
  const rep = suite ? all[suite] : undefined;
  const [name, setName] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState('changed');
  if (!rep)
    return (
      <div className={s.empty}>
        No scenario data for this project: <code>node tools/scenarios.mjs</code> writes it (<code>--suite &lt;name&gt;</code> for a named suite).
      </div>
    );
  if (!rep.scenarios?.length) return <div className={s.empty}>The {suiteTitle(suite!, rep)} suite has no scenarios.</div>;
  const tag = rep.suite ? `scenarios-${rep.suite.name}` : 'scenarios';
  const sc = rep.scenarios.find((x) => x.name === name) ?? rep.scenarios.find((x) => x.kind === 'regression') ?? rep.scenarios[0];
  const rows = sc.rows
    .filter((r) => !r.error && r.metrics)
    .filter((r) => filter === 'all' || (filter === 'changed' && r.changed) || (filter === 'fail' && !r.pass) || (filter === 'missed' && r.changed && r.pass) || (filter === 'detail' && !r.pass && r.wholeImagePass))
    .map(asRow)
    .sort((a, b) => (a.metrics?.ssim ?? 1) - (b.metrics?.ssim ?? 1));
  const sm = sc.summary;
  return (
    <div className={s.stack}>
      <div className={s.row}>
        {suites.length > 1 ? (
          <ToggleGroup type="single" value={suite} onValueChange={(v) => v && (setSuite(v), setName(null))} aria-label="Scenario suite">
            {suites.map((k) => (
              <ToggleGroupItem key={k} value={k}>
                {suiteTitle(k, all[k])}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : (
          <strong style={{ fontSize: '0.8125rem' }}>{suiteTitle(suite!, rep)}</strong>
        )}
        <span className={s.muted}>
          {rep.sample.stories} stories{rep.suite ? ` (every story matching ${rep.suite.pattern ?? rep.suite.name})` : rep.sample.every > 1 ? ` (every ${rep.sample.every}th)` : ''} · gate grid {String(rep.gate.grid)}, ≥{String(rep.gate.minCells)} cells @ {String(rep.gate.threshold)}, detail {rep.gate.detail ? 'on' : 'off'}
        </span>
      </div>
      <div className={s.scenarioLayout} style={{ gridTemplateColumns: 'minmax(min(100%, 18rem), 22rem) minmax(0, 1fr)' }}>
        <div className={s.scenarioList} role="group" aria-label="Scenarios">
          {rep.scenarios.map((x) => {
            const ratio = x.kind === 'regression' ? (x.summary.changed ? x.summary.detected / x.summary.changed : 0) : x.summary.stories ? (x.summary.stories - (x.summary.falsePositives ?? 0)) / x.summary.stories : 1;
            return (
              <button key={x.name} type="button" className={s.scenarioItem} aria-pressed={x.name === sc.name} onClick={() => setName(x.name)}>
                <span className={s.row}>
                  <strong style={{ fontSize: '0.8125rem' }}>{x.title}</strong>
                  <span className={s.spacer} />
                  <Badge variant={x.kind === 'regression' ? 'outline' : 'secondary'}>{x.kind === 'regression' ? 'break' : 'noise'}</Badge>
                </span>
                <Progress
                  value={Math.round(ratio * 100)}
                  showValue
                  label={x.kind === 'regression' ? `${x.summary.detected}/${x.summary.changed} caught · whole-image ${x.summary.detectedWholeImage}` : `${x.summary.stories - (x.summary.falsePositives ?? 0)}/${x.summary.stories} clean`}
                />
              </button>
            );
          })}
        </div>
        <div className={s.stack}>
          <Card>
            <CardHeader>
              <CardTitle>{sc.title}</CardTitle>
              <CardDescription className={s.mono}>{sc.change}</CardDescription>
            </CardHeader>
            <CardContent>
              <StatPanel
                variant="strip"
                aria-label="Scenario result"
                cards={[
                  { label: 'Changed', value: `${sm.changed}/${sm.stories}` },
                  sc.kind === 'regression'
                    ? { label: 'Caught (shipped)', value: `${sm.detected}/${sm.changed}`, accent: sm.detected === sm.changed ? 'success' : undefined }
                    : { label: 'False positives', value: `${sm.falsePositives}/${sm.stories}`, accent: sm.falsePositives ? 'error' : 'success' },
                  ...(sc.kind === 'regression' ? [{ label: 'Whole-image only', value: `${sm.detectedWholeImage}/${sm.changed}` }] : []),
                  ...(sm.errors ? [{ label: 'Errors', value: sm.errors, accent: 'error' as const }] : []),
                  { label: 'Render', value: fmt.ms(sm.renderWallMs) },
                  { label: 'Rust engine', value: fmt.ms(sm.rustEngineMs) },
                ]}
              />
            </CardContent>
          </Card>
          <div className={s.row}>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger size="sm" aria-label="Filter renders" style={{ inlineSize: '15rem' }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="changed">Changed renders</SelectItem>
                <SelectItem value="missed">Changed but missed</SelectItem>
                <SelectItem value="detail">Caught only by detail</SelectItem>
                <SelectItem value="fail">Failed</SelectItem>
                <SelectItem value="all">All renders</SelectItem>
              </SelectContent>
            </Select>
            <span className={s.muted}>worst ssim first · open one to inspect the pixels</span>
          </div>
          <StoryGrid data={data} rows={rows} scenario={{ tag, name: sc.name }} onOpen={(r, list) => onOpen(r, list, { tag, name: sc.name })} />
        </div>
      </div>
    </div>
  );
}
