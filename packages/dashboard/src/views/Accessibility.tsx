import React from 'react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, DataTable, StatGroup, StatusBadge, type Tone } from '@ui';
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
  // A rule every entry has accepted is greyed out: still listed, nothing to act on.
  const dim = (r: RuleRow, extra = '') => (r.fresh ? extra : `${extra} ${s.muted}`).trim() || undefined;
  const tone = (i: string): Tone => (i === 'critical' || i === 'serious' ? 'danger' : i === 'moderate' ? 'warning' : 'neutral');
  return (
    <div className={s.stack}>
      <StatGroup
        label={t('tabs.a11y')}
        items={[
          { label: t('a11y.stats.scanned'), value: rows.length },
          { label: t('a11y.stats.violations'), value: sm.a11yViolations },
          { label: t('a11y.stats.new'), value: sm.a11yNew, tone: sm.a11yNew ? 'danger' : 'success' },
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
          <DataTable
            rows={rules}
            rowId={(r) => r.id}
            onRowClick={(r) => onOpen(r.rows[0], r.rows)}
            columns={[
              {
                id: 'status',
                header: t('a11y.columns.status'),
                cell: (r) => (r.fresh ? <StatusBadge icon="dot" label={t('a11y.status.new', { count: r.fresh })} tone="danger" /> : <StatusBadge icon="dot" label={t('a11y.status.accepted')} tone="neutral" />),
              },
              { id: 'id', field: 'id', header: t('a11y.columns.rule'), cell: (r) => <span className={dim(r, s.mono)}>{r.id}</span> },
              { id: 'impact', field: 'impact', header: t('a11y.columns.impact'), cell: (r) => (r.fresh ? <StatusBadge icon="dot" label={r.impact} tone={tone(r.impact)} /> : <span className={s.muted}>{r.impact}</span>) },
              { id: 'help', field: 'help', header: t('a11y.columns.description'), cell: (r) => <span className={dim(r)}>{r.help}</span> },
              { id: 'entries', field: 'entries', header: t('a11y.columns.entries'), cell: (r) => <span className={dim(r)}>{r.entries}</span> },
              { id: 'nodes', field: 'nodes', header: t('a11y.columns.nodes'), cell: (r) => <span className={dim(r)}>{r.nodes}</span> },
              { id: 'accepted', header: t('a11y.columns.accepted'), cell: (r) => <span className={s.muted}>{r.entries - r.fresh}</span> },
              { id: 'fresh', field: 'fresh', header: t('a11y.columns.new'), cell: (r) => (r.fresh ? <Badge tone="danger">{r.fresh}</Badge> : <span className={s.muted}>0</span>) },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
