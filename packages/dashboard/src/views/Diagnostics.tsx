import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, KeyValueItem, KeyValueList, SegmentedChoice, StatusBadge, Toolbar, ToolbarStart } from '@ui';
import { type Data, type Row, type ScenarioReport, suiteKeys, suiteTitle } from '../data';
import { HBars } from '../parts/Charts';
import { t } from '../copy';
import { VERDICT } from '../parts/StatusOf';
import { Scenarios } from './Scenarios';
import { Calibration } from './Calibration';
import { Performance } from './Performance';
import * as s from '../dashboard.css';

type Section = 'scenarios' | 'calibration' | 'performance';

/** The sections a research run wrote data for (the tab is hidden when there are none). */
export function diagnosticsOf(data: Data): Section[] {
  return [
    ...(Object.keys(data.scenarioSuites ?? {}).length ? (['scenarios'] as const) : []),
    ...(Object.keys(data.calibrationSuites ?? {}).length || data.detailCalibration ? (['calibration'] as const) : []),
    ...(data.bench ? (['performance'] as const) : []),
  ];
}

function detection(rep: ScenarioReport) {
  const regs = rep.scenarios.filter((x) => x.kind === 'regression');
  const noise = rep.scenarios.filter((x) => x.kind === 'noise');
  return {
    changed: regs.reduce((a, x) => a + x.summary.changed, 0),
    shipped: regs.reduce((a, x) => a + x.summary.detected, 0),
    whole: regs.reduce((a, x) => a + x.summary.detectedWholeImage, 0),
    fp: noise.reduce((a, x) => a + (x.summary.falsePositives ?? 0), 0),
  };
}

/** Detection rate per scenario suite: whole-image signature alone, and with the detail channel. */
function DetectionRate({ data }: { data: Data }) {
  const suites = suiteKeys(data.scenarioSuites).map((k) => ({ key: k, title: suiteTitle(k, data.scenarioSuites![k]), r: detection(data.scenarioSuites![k]) }));
  if (!suites.length) return null;
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  const fp = suites.reduce((a, x) => a + x.r.fp, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('diagnostics.detection.title')}</CardTitle>
        <CardDescription>{t('diagnostics.detection.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <HBars
          category="suite"
          max={100}
          format={(v) => `${v}%`}
          series={[
            { key: 'whole', label: t('diagnostics.detection.whole') },
            { key: 'shipped', label: t('diagnostics.detection.shipped') },
          ]}
          data={suites.map((x) => ({ suite: x.title, whole: pct(x.r.whole, x.r.changed), shipped: pct(x.r.shipped, x.r.changed) }))}
          height={10}
        />
        <KeyValueList orientation="horizontal">
          {suites.map((x) => (
            <KeyValueItem key={x.key} label={x.title}>
              {t('diagnostics.detection.detected', { detected: x.r.shipped, changed: x.r.changed })}
            </KeyValueItem>
          ))}
          <KeyValueItem label={t('diagnostics.detection.falsePositives')}>
            <StatusBadge {...(fp ? VERDICT.error : VERDICT.pass)} label={String(fp)} />
          </KeyValueItem>
        </KeyValueList>
      </CardContent>
    </Card>
  );
}

export function Diagnostics({ data, onOpen }: { data: Data; onOpen(row: Row, list: Row[], scenario: { tag: string; name: string }): void }) {
  const sections = diagnosticsOf(data);
  const [picked, setPicked] = React.useState<Section | null>(null);
  const section = picked && sections.includes(picked) ? picked : sections[0];
  if (!section) return null;
  return (
    <div className={s.stack}>
      {sections.length > 1 ? (
        <Toolbar size="sm">
          <ToolbarStart>
            <SegmentedChoice value={section} onValueChange={(v) => setPicked(v as Section)} label={t('diagnostics.sections')} options={sections.map((k) => ({ value: k, label: t(`diagnostics.tabs.${k}`) }))} />
          </ToolbarStart>
        </Toolbar>
      ) : null}
      <span className={s.muted}>{t('diagnostics.description')}</span>
      {section === 'scenarios' ? (
        <>
          <DetectionRate data={data} />
          <Scenarios data={data} onOpen={onOpen} />
        </>
      ) : section === 'calibration' ? (
        <Calibration data={data} />
      ) : (
        <Performance data={data} />
      )}
    </div>
  );
}
