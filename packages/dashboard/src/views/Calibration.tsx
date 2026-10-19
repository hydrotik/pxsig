import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, DataGrid, ToggleGroup, ToggleGroupItem } from '@hydrotik/design-system';
import { type CalibrationReport, type Data, suiteKeys, suiteTitle } from '../data';
import { Lines } from '../parts/Charts';
import * as s from '../dashboard.css';

function GridSweep({ cal, title }: { cal: CalibrationReport; title: string }) {
  const grids = cal.grids ?? [];
  if (!grids.length) return <div className={s.empty}>The {title} calibration has no grids.</div>;
  const pick = (g: (typeof grids)[number], n: string) => g.rules.find((r) => r.name === n);
  const data = grids.map((g) => ({
    grid: g.grid,
    default: Math.round(((pick(g, 'default')?.caught ?? 0) / (pick(g, 'default')?.changed || 1)) * 100),
    calibrated: Math.round(((pick(g, 'cells>=2@32')?.caught ?? 0) / (pick(g, 'cells>=2@32')?.changed || 1)) * 100),
    best: Math.round(((pick(g, g.best ?? 'default')?.caught ?? 0) / (pick(g, g.best ?? 'default')?.changed || 1)) * 100),
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}: recall by signature grid</CardTitle>
        <CardDescription>{cal.renders} saved renders{cal.minCellPx ? `, min cell ${cal.minCellPx}px` : ', fixed grids'}. Whole-image signature only. A rule counts only if it raises zero false positives on every noise scenario.</CardDescription>
      </CardHeader>
      <CardContent>
        <Lines
          data={data}
          x="grid"
          format={(v) => `${v}%`}
          series={[
            { key: 'default', label: 'v1 rule (ssim / 2%)' },
            { key: 'calibrated', label: '≥ 2 cells off by > 32' },
            { key: 'best', label: 'Best zero-FP rule' },
          ]}
        />
        <DataGrid
          data={grids.map((g) => {
            const r = pick(g, 'cells>=2@32');
            return { id: String(g.grid), grid: g.grid, kb: (g.signatureBytes / 1024).toFixed(1), calibrated: r ? `${r.caught}/${r.changed}` : '—', fp: r ? r.falsePositives : '—', best: g.best ?? '—' };
          })}
          getRowId={(r: { id: string }) => r.id}
          density="compact"
          showToolbar={false}
          columns={[
            { id: 'grid', accessorKey: 'grid', header: 'Grid' },
            { id: 'kb', accessorKey: 'kb', header: 'Record KB' },
            { id: 'calibrated', accessorKey: 'calibrated', header: '≥2 cells @ 32' },
            { id: 'fp', accessorKey: 'fp', header: 'False +' },
            { id: 'best', accessorKey: 'best', header: 'Best zero-FP rule' },
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
            <CardTitle>Detail channel (M6): chosen from {d.renders} saved renders</CardTitle>
            <CardDescription>
              Signature gate alone catches {d.sigOnly.caught}/{d.sigOnly.changed}; with the detail rule {d.best ? `${d.best.caught}/${d.best.changed}` : '—'}, still zero false positives. Swept in Rust in {Math.round(d.sweepMs)} ms.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataGrid
              data={d.topAdmissible.map((c: any, i: number) => ({ id: String(i), build: `${c.build.tile}px / ${c.build.block}px / sel ${c.build.selEnergy}`, rule: `≥${c.k} tiles, Δ>${c.T}, rise>${c.E ?? '∞'}`, caught: `${c.caught}/${c.changed}`, detailOnly: c.detailOnly, kb: (c.avgRecordBytes / 1024).toFixed(1) }))}
              getRowId={(r: { id: string }) => r.id}
              density="compact"
              showToolbar={false}
              columns={[
                { id: 'build', accessorKey: 'build', header: 'Tile / block / selection' },
                { id: 'rule', accessorKey: 'rule', header: 'Rule' },
                { id: 'caught', accessorKey: 'caught', header: 'Caught' },
                { id: 'detailOnly', accessorKey: 'detailOnly', header: 'Only by detail' },
                { id: 'kb', accessorKey: 'kb', header: 'Detail KB / record' },
              ]}
            />
          </CardContent>
        </Card>
      ) : null}
      {suite ? (
        <>
          {suites.length > 1 ? (
            <ToggleGroup type="single" value={suite} onValueChange={(v) => v && setSuite(v)} aria-label="Calibration suite">
              {suites.map((k) => (
                <ToggleGroupItem key={k} value={k}>
                  {suiteTitle(k, all[k])}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : null}
          <GridSweep key={suite} cal={all[suite]} title={suiteTitle(suite, all[suite])} />
        </>
      ) : (
        <div className={s.empty}>
          No grid calibration for this project: <code>node tools/calibrate.mjs</code> writes it from the saved scenario renders (<code>--suite &lt;name&gt;</code> for a named suite).
        </div>
      )}
    </div>
  );
}
