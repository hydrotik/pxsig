import React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  KeyValueItem,
  KeyValueList,
  SegmentedChoice,
  StatusBadge,
  Toolbar,
  ToolbarStart,
} from '@ui';
import { type Data, type Row, type ScenarioReport, suiteKeys, suiteTitle } from '../data';
import { HBars } from '../parts/Charts';
import { t } from '../copy';
import { VERDICT } from '../parts/StatusOf';
import { Scenarios } from './Scenarios';
import { Calibration } from './Calibration';
import { Performance } from './Performance';
import { ReactView, type ReactPart } from './react/ReactView';
import * as s from '../dashboard.css';

type Section = 'react' | 'scenarios' | 'calibration' | 'performance';

/**
 * The sections there is data for (the tab is hidden when there are none): React first (a normal
 * check feeds it), then the ones a research run wrote.
 */
export function diagnosticsOf(data: Data): Section[] {
  return [
    ...(data.react ? (['react'] as const) : []),
    ...(Object.keys(data.scenarioSuites ?? {}).length ? (['scenarios'] as const) : []),
    ...(Object.keys(data.calibrationSuites ?? {}).length || data.detailCalibration
      ? (['calibration'] as const)
      : []),
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
  const suites = suiteKeys(data.scenarioSuites).map((k) => ({
    key: k,
    title: suiteTitle(k, data.scenarioSuites![k]),
    r: detection(data.scenarioSuites![k]),
  }));
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
          data={suites.map((x) => ({
            suite: x.title,
            whole: pct(x.r.whole, x.r.changed),
            shipped: pct(x.r.shipped, x.r.changed),
          }))}
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

export function Diagnostics({
  data,
  onOpen,
  focus = null,
}: {
  data: Data;
  onOpen: (row: Row, list: Row[], scenario?: { tag: string; name: string } | null) => void;
  /** Opened on React (an old `#react` / `#react-renders` link): the part to show. */
  focus?: { part: ReactPart; all?: boolean; at: number } | null;
}) {
  const sections = diagnosticsOf(data);
  // Opened on React (App keys this view by the focus, so a new one starts here again).
  const [picked, setPicked] = React.useState<Section | null>(focus ? 'react' : null);
  const section = picked && sections.includes(picked) ? picked : sections[0];
  if (!section) return null;
  return (
    <div className={s.stack}>
      {sections.length > 1 ? (
        <Toolbar size="sm">
          <ToolbarStart>
            <SegmentedChoice
              value={section}
              onValueChange={(v) => setPicked(v as Section)}
              label={t('diagnostics.sections')}
              options={sections.map((k) => ({ value: k, label: t(`diagnostics.tabs.${k}`) }))}
            />
          </ToolbarStart>
        </Toolbar>
      ) : null}
      {section === 'react' ? null : <span className={s.muted}>{t('diagnostics.description')}</span>}
      {section === 'react' && data.react ? (
        <ReactView
          data={data}
          react={data.react}
          initialPart={focus?.part ?? 'compiler'}
          initialAll={focus?.all}
          onOpen={(r, l) => onOpen(r, l, null)}
        />
      ) : section === 'scenarios' ? (
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
