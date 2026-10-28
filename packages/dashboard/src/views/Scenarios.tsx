import React from 'react';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
  SegmentedChoice,
  Select,
  StatGroup,
  Toolbar,
  ToolbarField,
  ToolbarStart,
  ToolbarSummary,
} from '@ui';
import { type Data, type Row, type Scenario, fmt, suiteKeys, suiteTitle } from '../data';
import { StoryGrid } from '../parts/StoryGrid';
import { Cmd, t, tx } from '../copy';
import * as s from '../dashboard.css';

const asRow = (r: Scenario['rows'][number]): Row => ({
  ...r,
  story: r.id,
  mode: 'dark',
  state: null,
  pass: r.pass ?? false,
});

export function Scenarios({
  data,
  onOpen,
}: {
  data: Data;
  onOpen: (row: Row, list: Row[], scenario: { tag: string; name: string }) => void;
}) {
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
        {tx('diagnostics.scenario.empty', { command: <Cmd>node tools/scenarios.mjs</Cmd> })}
      </div>
    );
  if (!rep.scenarios?.length)
    return (
      <div className={s.empty}>
        {t('diagnostics.scenario.emptySuite', { suite: suiteTitle(suite, rep) })}
      </div>
    );
  const tag = rep.suite ? `scenarios-${rep.suite.name}` : 'scenarios';
  const sc =
    rep.scenarios.find((x) => x.name === name) ??
    rep.scenarios.find((x) => x.kind === 'regression') ??
    rep.scenarios[0];
  const rows = sc.rows
    .filter((r) => !r.error && r.metrics)
    .filter(
      (r) =>
        filter === 'all' ||
        (filter === 'changed' && r.changed) ||
        (filter === 'fail' && !r.pass) ||
        (filter === 'missed' && r.changed && r.pass) ||
        (filter === 'detail' && !r.pass && r.wholeImagePass)
    )
    .map(asRow)
    .sort((a, b) => (a.metrics?.ssim ?? 1) - (b.metrics?.ssim ?? 1));
  const sm = sc.summary;
  return (
    <div className={s.stack}>
      <div className={s.row}>
        {suites.length > 1 ? (
          <Toolbar size="sm">
            <ToolbarStart>
              <SegmentedChoice
                value={suite}
                onValueChange={(v) => (setSuite(v), setName(null))}
                label={t('diagnostics.scenario.suite')}
                options={suites.map((k) => ({ value: k, label: suiteTitle(k, all[k]) }))}
              />
            </ToolbarStart>
          </Toolbar>
        ) : (
          <strong style={{ fontSize: '0.8125rem' }}>{suiteTitle(suite, rep)}</strong>
        )}
        <span className={s.muted}>
          {rep.suite
            ? t('diagnostics.scenario.sampleMatching', {
                count: rep.sample.stories,
                pattern: rep.suite.pattern ?? rep.suite.name,
              })
            : rep.sample.every > 1
              ? t('diagnostics.scenario.sampleEvery', {
                  count: rep.sample.stories,
                  every: rep.sample.every,
                })
              : t('diagnostics.scenario.sampleAll', { count: rep.sample.stories })}
          {' · '}
          {t('diagnostics.scenario.gate', {
            grid: String(rep.gate.grid),
            minCells: String(rep.gate.minCells),
            threshold: String(rep.gate.threshold),
            detail: t(rep.gate.detail ? 'diagnostics.scenario.on' : 'diagnostics.scenario.off'),
          })}
        </span>
      </div>
      <div
        className={s.scenarioLayout}
        style={{ gridTemplateColumns: 'minmax(min(100%, 18rem), 22rem) minmax(0, 1fr)' }}
      >
        <div className={s.scenarioList} role="group" aria-label={t('diagnostics.scenario.list')}>
          {rep.scenarios.map((x) => {
            const ratio =
              x.kind === 'regression'
                ? x.summary.changed
                  ? x.summary.detected / x.summary.changed
                  : 0
                : x.summary.stories
                  ? (x.summary.stories - (x.summary.falsePositives ?? 0)) / x.summary.stories
                  : 1;
            return (
              <button
                key={x.name}
                type="button"
                className={s.scenarioItem}
                aria-pressed={x.name === sc.name}
                onClick={() => setName(x.name)}
              >
                <span className={s.row}>
                  <strong style={{ fontSize: '0.8125rem' }}>{x.title}</strong>
                  <span className={s.spacer} />
                  <Badge emphasis={x.kind === 'regression' ? 'outline' : 'subtle'}>
                    {t(
                      x.kind === 'regression'
                        ? 'diagnostics.scenario.regression'
                        : 'diagnostics.scenario.noise'
                    )}
                  </Badge>
                </span>
                <Progress
                  value={Math.round(ratio * 100)}
                  showLabel
                  label={
                    x.kind === 'regression'
                      ? t('diagnostics.scenario.progressRegression', {
                          detected: x.summary.detected,
                          changed: x.summary.changed,
                          whole: x.summary.detectedWholeImage,
                        })
                      : t('diagnostics.scenario.progressNoise', {
                          clean: x.summary.stories - (x.summary.falsePositives ?? 0),
                          total: x.summary.stories,
                        })
                  }
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
              <StatGroup
                layout="strip"
                label={t('diagnostics.scenario.result')}
                items={[
                  {
                    label: t('diagnostics.scenario.changed'),
                    value: `${sm.changed}/${sm.stories}`,
                  },
                  sc.kind === 'regression'
                    ? {
                        label: t('diagnostics.scenario.detected'),
                        value: `${sm.detected}/${sm.changed}`,
                        tone: sm.detected === sm.changed ? 'success' : undefined,
                      }
                    : {
                        label: t('diagnostics.scenario.falsePositives'),
                        value: `${sm.falsePositives}/${sm.stories}`,
                        tone: sm.falsePositives ? 'danger' : 'success',
                      },
                  ...(sc.kind === 'regression'
                    ? [
                        {
                          label: t('diagnostics.scenario.wholeOnly'),
                          value: `${sm.detectedWholeImage}/${sm.changed}`,
                        },
                      ]
                    : []),
                  ...(sm.errors
                    ? [
                        {
                          label: t('diagnostics.scenario.errors'),
                          value: sm.errors,
                          tone: 'danger' as const,
                        },
                      ]
                    : []),
                  { label: t('diagnostics.scenario.render'), value: fmt.ms(sm.renderWallMs) },
                  { label: t('diagnostics.scenario.engine'), value: fmt.ms(sm.rustEngineMs) },
                ]}
              />
            </CardContent>
          </Card>
          <Toolbar size="sm">
            <ToolbarStart>
              <ToolbarField label={t('diagnostics.scenario.filter')} minInlineSize="15rem">
                <Select
                  value={filter}
                  onValueChange={setFilter}
                  options={(['changed', 'missed', 'detail', 'fail', 'all'] as const).map((v) => ({
                    value: v,
                    label: t(`diagnostics.scenario.filters.${v}`),
                  }))}
                />
              </ToolbarField>
              <ToolbarSummary>{t('diagnostics.scenario.sorted')}</ToolbarSummary>
            </ToolbarStart>
          </Toolbar>
          <StoryGrid
            data={data}
            rows={rows}
            scenario={{ tag, name: sc.name }}
            onOpen={(r, list) => onOpen(r, list, { tag, name: sc.name })}
          />
        </div>
      </div>
    </div>
  );
}
