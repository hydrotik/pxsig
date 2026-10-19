import React from 'react';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, DataGrid, StatPanel, StatusBadge } from '@hydrotik/design-system';
import type { Data, Row } from '../data';
import * as s from '../dashboard.css';

interface RuleRow {
  id: string;
  impact: string;
  help: string;
  entries: number;
  nodes: number;
  fresh: number;
  rows: Row[];
}

const IMPACT = ['critical', 'serious', 'moderate', 'minor', 'n/a'];

export function Accessibility({ data, onOpen }: { data: Data; onOpen(row: Row, list: Row[]): void }) {
  const rows = (data.check?.rows ?? []).filter((r) => r.a11y?.violations);
  const rules = React.useMemo(() => {
    const m = new Map<string, RuleRow>();
    for (const r of rows)
      for (const v of r.a11y!.violations!) {
        const e = m.get(v.id) ?? { id: v.id, impact: v.impact ?? 'n/a', help: v.help, entries: 0, nodes: 0, fresh: 0, rows: [] };
        e.entries++;
        e.nodes += v.nodes;
        if (r.a11y?.baseline && !r.a11y.baseline.includes(v.id)) e.fresh++;
        e.rows.push(r);
        m.set(v.id, e);
      }
    return [...m.values()].sort((a, b) => b.fresh - a.fresh || IMPACT.indexOf(a.impact) - IMPACT.indexOf(b.impact) || b.entries - a.entries);
  }, [rows]);
  if (!data.check) return <div className={s.empty}>Run `pxsig check --full` to populate this view.</div>;
  if (!rows.length) return <div className={s.empty}>No axe results in this check (was it run with --no-a11y?).</div>;
  const sm = data.check.summary;
  const tone = (i: string) => (i === 'critical' || i === 'serious' ? 'error' : i === 'moderate' ? 'warning' : 'neutral');
  return (
    <div className={s.stack}>
      <StatPanel
        aria-label="Accessibility"
        cards={[
          { label: 'Entries scanned', value: rows.length },
          { label: 'Violations', value: sm.a11yViolations },
          { label: 'New since baseline', value: sm.a11yNew, accent: sm.a11yNew ? 'error' : 'success' },
          { label: 'Rules hit', value: rules.length },
        ]}
      />
      <Card>
        <CardHeader>
          <CardTitle>Rules</CardTitle>
          <CardDescription>axe-core runs on every render in the same page pool, after the screenshot. "New" counts violations not in the a11y baseline (the store's a11y.json).</CardDescription>
        </CardHeader>
        <CardContent>
          <DataGrid
            data={rules}
            getRowId={(r: RuleRow) => r.id}
            density="compact"
            showToolbar={false}
            onRowClick={(row: { original: RuleRow }) => onOpen(row.original.rows[0], row.original.rows)}
            columns={[
              { id: 'id', accessorKey: 'id', header: 'Rule', cell: ({ row }: { row: { original: RuleRow } }) => <span className={s.mono}>{row.original.id}</span> },
              { id: 'impact', accessorKey: 'impact', header: 'Impact', cell: ({ row }: { row: { original: RuleRow } }) => <StatusBadge label={row.original.impact} tone={tone(row.original.impact)} /> },
              { id: 'help', accessorKey: 'help', header: 'What it means' },
              { id: 'entries', accessorKey: 'entries', header: 'Entries' },
              { id: 'nodes', accessorKey: 'nodes', header: 'Nodes' },
              { id: 'fresh', accessorKey: 'fresh', header: 'New', cell: ({ row }: { row: { original: RuleRow } }) => (row.original.fresh ? <Badge variant="destructive">{row.original.fresh}</Badge> : <span className={s.muted}>0</span>) },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
