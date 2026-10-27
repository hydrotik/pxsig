import React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  SegmentedChoice,
} from '@ui';
import { type CalibrationReport, type Data, suiteKeys, suiteTitle } from '../data';
import { Lines } from '../parts/Charts';
import { Cmd, t, tx } from '../copy';
import * as s from '../dashboard.css';

/** One admissible detail-channel build, as a table row. */
interface DetailRow {
  id: string;
  build: string;
  rule: string;
  caught: string;
  detailOnly: number;
  kb: string;
}

function GridSweep({ cal, title }: { cal: CalibrationReport; title: string }) {
  const grids = cal.grids ?? [];
  if (!grids.length)
    return <div className={s.empty}>{t('diagnostics.calibration.noGrids', { suite: title })}</div>;
  const pick = (g: (typeof grids)[number], n: string) => g.rules.find((r) => r.name === n);
  const data = grids.map((g) => ({
    grid: g.grid,
    default: Math.round(
      ((pick(g, 'default')?.caught ?? 0) / (pick(g, 'default')?.changed || 1)) * 100
    ),
    calibrated: Math.round(
      ((pick(g, 'cells>=2@32')?.caught ?? 0) / (pick(g, 'cells>=2@32')?.changed || 1)) * 100
    ),
    best: Math.round(
      ((pick(g, g.best ?? 'default')?.caught ?? 0) / (pick(g, g.best ?? 'default')?.changed || 1)) *
        100
    ),
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('diagnostics.calibration.gridTitle', { suite: title })}</CardTitle>
        <CardDescription>
          {t('diagnostics.calibration.gridDescription', {
            renders: cal.renders,
            cells: cal.minCellPx
              ? t('diagnostics.calibration.minCell', { px: cal.minCellPx })
              : t('diagnostics.calibration.fixedGrids'),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Lines
          data={data}
          x="grid"
          format={(v) => `${v}%`}
          series={[
            { key: 'default', label: t('diagnostics.calibration.seriesDefault') },
            { key: 'calibrated', label: t('diagnostics.calibration.seriesCalibrated') },
            { key: 'best', label: t('diagnostics.calibration.seriesBest') },
          ]}
        />
        <DataTable
          rows={grids.map((g) => {
            const r = pick(g, 'cells>=2@32');
            return {
              id: String(g.grid),
              grid: g.grid,
              kb: (g.signatureBytes / 1024).toFixed(1),
              calibrated: r ? `${r.caught}/${r.changed}` : '—',
              fp: r ? r.falsePositives : '—',
              best: g.best ?? '—',
            };
          })}
          rowId={(r) => r.id}
          columns={[
            { id: 'grid', field: 'grid', header: t('diagnostics.calibration.grid') },
            { id: 'kb', field: 'kb', header: t('diagnostics.calibration.recordKb') },
            {
              id: 'calibrated',
              field: 'calibrated',
              header: t('diagnostics.calibration.calibrated'),
            },
            { id: 'fp', field: 'fp', header: t('diagnostics.calibration.falsePositives') },
            { id: 'best', field: 'best', header: t('diagnostics.calibration.best') },
          ]}
        />
      </CardContent>
    </Card>
  );
}

export function Calibration({ data }: { data: Data }) {
  const d = data.detailCalibration;
  const all = data.calibrationSuites ?? {};
  const suites = suiteKeys(all);
  const [picked, setSuite] = React.useState<string | null>(null);
  const suite = picked && all[picked] ? picked : suites[0];
  return (
    <div className={s.stack}>
      {d ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('diagnostics.calibration.detailTitle', { count: d.renders })}</CardTitle>
            <CardDescription>
              {t('diagnostics.calibration.detailDescription', {
                sig: `${d.sigOnly.caught}/${d.sigOnly.changed}`,
                best: d.best ? `${d.best.caught}/${d.best.changed}` : '—',
                ms: Math.round(d.sweepMs),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              rows={(d.topAdmissible as any[]).map((c: any, i: number): DetailRow => ({
                id: String(i),
                build: `${c.build.tile}px / ${c.build.block}px / sel ${c.build.selEnergy}`,
                rule: `≥${c.k} tiles, Δ>${c.T}, rise>${c.E ?? '∞'}`,
                caught: `${c.caught}/${c.changed}`,
                detailOnly: c.detailOnly,
                kb: (c.avgRecordBytes / 1024).toFixed(1),
              }))}
              rowId={(r) => r.id}
              columns={[
                { id: 'build', field: 'build', header: t('diagnostics.calibration.build') },
                { id: 'rule', field: 'rule', header: t('diagnostics.calibration.rule') },
                { id: 'caught', field: 'caught', header: t('diagnostics.calibration.detected') },
                {
                  id: 'detailOnly',
                  field: 'detailOnly',
                  header: t('diagnostics.calibration.detailOnly'),
                },
                { id: 'kb', field: 'kb', header: t('diagnostics.calibration.detailKb') },
              ]}
            />
          </CardContent>
        </Card>
      ) : null}
      {suite ? (
        <>
          {suites.length > 1 ? (
            <SegmentedChoice
              value={suite}
              onValueChange={setSuite}
              label={t('diagnostics.calibration.suite')}
              options={suites.map((k) => ({ value: k, label: suiteTitle(k, all[k]) }))}
            />
          ) : null}
          <GridSweep key={suite} cal={all[suite]} title={suiteTitle(suite, all[suite])} />
        </>
      ) : (
        <div className={s.empty}>
          {tx('diagnostics.calibration.empty', { command: <Cmd>node tools/calibrate.mjs</Cmd> })}
        </div>
      )}
    </div>
  );
}
