import React from 'react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, DataGrid, StatPanel, StatusBadge } from '@hydrotik/design-system';
import { type Data, type Queue, type Row, decisionOf, reviewQueue, served } from '../data';
import { Cmd, t, tx } from '../copy';
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

export function Accessibility({ data, onOpen, startReview }: { data: Data; onOpen(row: Row, list: Row[]): void; startReview(kind: Queue): void }) {
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
  if (!data.check) return <div className={s.empty}>{tx('empty.noCheck', { command: <Cmd>pxsig check --full</Cmd> })}</div>;
  if (!rows.length) return <div className={s.empty}>{tx('a11y.empty', { flag: <Cmd>--no-a11y</Cmd> })}</div>;
  const sm = data.check.summary;
  const open = reviewQueue(data, 'a11y').filter((r) => !decisionOf(data, 'a11y', r.id)).length;
  const tone = (i: string) => (i === 'critical' || i === 'serious' ? 'error' : i === 'moderate' ? 'warning' : 'neutral');
  return (
    <div className={s.stack}>
      <StatPanel
        aria-label={t('tabs.a11y')}
        cards={[
          { label: t('a11y.stats.scanned'), value: rows.length },
          { label: t('a11y.stats.violations'), value: sm.a11yViolations },
          { label: t('a11y.stats.new'), value: sm.a11yNew, accent: sm.a11yNew ? 'error' : 'success' },
          { label: t('a11y.stats.rules'), value: rules.length },
        ]}
      />
      <span className={s.row}>
        <span className={s.muted}>{t(sm.a11yNew ? 'a11y.howTo' : 'a11y.noneNew')}</span>
        {served && open ? (
          <Button size="sm" onClick={() => startReview('a11y')}>
            {t('app.startReview.a11y', { count: open })}
          </Button>
        ) : null}
      </span>
      <Card>
        <CardHeader>
          <CardTitle>{t('a11y.title')}</CardTitle>
          <CardDescription>{tx('a11y.description', { file: <Cmd>a11y.json</Cmd> })}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataGrid
            data={rules}
            getRowId={(r: RuleRow) => r.id}
            density="compact"
            showToolbar={false}
            onRowClick={(row: { original: RuleRow }) => onOpen(row.original.rows[0], row.original.rows)}
            columns={[
              { id: 'id', accessorKey: 'id', header: t('a11y.columns.rule'), cell: ({ row }: { row: { original: RuleRow } }) => <span className={s.mono}>{row.original.id}</span> },
              { id: 'impact', accessorKey: 'impact', header: t('a11y.columns.impact'), cell: ({ row }: { row: { original: RuleRow } }) => <StatusBadge label={row.original.impact} tone={tone(row.original.impact)} /> },
              { id: 'help', accessorKey: 'help', header: t('a11y.columns.description') },
              { id: 'entries', accessorKey: 'entries', header: t('a11y.columns.entries') },
              { id: 'nodes', accessorKey: 'nodes', header: t('a11y.columns.nodes') },
              { id: 'accepted', header: t('a11y.columns.accepted'), cell: ({ row }: { row: { original: RuleRow } }) => <span className={s.muted}>{row.original.entries - row.original.fresh}</span> },
              { id: 'fresh', accessorKey: 'fresh', header: t('a11y.columns.new'), cell: ({ row }: { row: { original: RuleRow } }) => (row.original.fresh ? <Badge variant="destructive">{row.original.fresh}</Badge> : <span className={s.muted}>0</span>) },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
