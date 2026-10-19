import type React from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, DataGrid, StatPanel } from '@hydrotik/design-system';
import { type Data, type Queue, fmt, rowsWithPending, served, statusOf } from '../data';
import { Cmd, t, tx, type CopyKey } from '../copy';
import * as s from '../dashboard.css';

interface Item {
  id: string;
  label: string;
  count: number;
  detail: string;
  action: CopyKey;
  open(): void;
}

/** "dark 9 · light 3": a count split by mode, when there is more than one. */
const byMode = (modes: string[]) => {
  const n = new Map<string, number>();
  for (const m of modes) n.set(m, (n.get(m) ?? 0) + 1);
  return n.size > 1 ? [...n].map(([m, c]) => `${m} ${c}`).join(' · ') : '';
};

/** The landing tab: what needs doing, then the last check in numbers. */
export function Overview({ data, go, startReview }: { data: Data; go(tab: string, filter?: string): void; startReview(kind: Queue): void }) {
  // With the server, a queue opens straight into the inspector; a static report lists it instead.
  const review = (kind: Queue) => (served ? startReview(kind) : go('stories', kind));
  const sm = data.check?.summary;
  const L = data.integrity;
  const rows = rowsWithPending(data);
  const having = (st: ReturnType<typeof statusOf>) => rows.filter((r) => statusOf(r, data.review) === st);
  const changed = having('changed');
  const fresh = having('new');
  const rejected = having('rejected');
  const errors = having('error').filter((r) => !r.skipped);
  const flaky = having('flaky');
  const items: Item[] = [
    { id: 'changed', label: t('overview.items.changed'), count: changed.length, detail: byMode(changed.map((r) => r.mode)), action: served ? 'overview.actions.start' : 'overview.actions.review', open: () => review('changed') },
    { id: 'new', label: t('overview.items.new'), count: fresh.length, detail: byMode(fresh.map((r) => r.mode)), action: served ? 'overview.actions.start' : 'overview.actions.review', open: () => review('new') },
    { id: 'rejected', label: t('overview.items.rejected'), count: rejected.length, detail: '', action: 'overview.actions.view', open: () => go('stories', 'rejected') },
    { id: 'error', label: t('overview.items.error'), count: errors.length, detail: '', action: 'overview.actions.view', open: () => go('stories', 'error') },
    {
      id: 'coverage',
      label: t('overview.items.coverage'),
      count: L?.summary.bySeverity.error ?? 0,
      detail: L?.summary.componentsBySeverity.error ? t('overview.components', { count: L.summary.componentsBySeverity.error }) : '',
      action: 'overview.actions.open',
      open: () => go('integrity'),
    },
    { id: 'a11y', label: t('overview.items.a11y'), count: sm?.a11yNew ?? 0, detail: sm?.a11yNew ? t('overview.ofTotal', { total: sm.a11yViolations }) : '', action: 'overview.actions.open', open: () => go('a11y') },
    { id: 'flaky', label: t('overview.items.flaky'), count: flaky.length, detail: byMode(flaky.map((r) => r.mode)), action: 'overview.actions.view', open: () => go('stories', 'flaky') },
  ];
  const open = items.some((x) => x.count > 0);
  return (
    <div className={s.stack}>
      {sm ? (
        <StatPanel
          aria-label={t('overview.cards.label')}
          cards={[
            { label: t('overview.cards.checked'), value: sm.checked, unit: sm.skipped ? t('overview.cards.notRun', { count: sm.skipped }) : sm.modes.join(' · ') },
            { label: t('overview.cards.passed'), value: sm.passed, accent: 'success' },
            { label: t('overview.cards.changed'), value: sm.failed, accent: sm.failed ? 'error' : undefined, type: 'filter', onSelect: () => review('changed') },
            { label: t('overview.cards.flaky'), value: sm.flaky, accent: sm.flaky ? 'warning' : undefined, type: 'filter', onSelect: () => go('stories', 'flaky') },
            { label: t('overview.cards.a11y'), value: sm.a11yNew, unit: t('overview.cards.ofTotal', { total: sm.a11yViolations }), accent: sm.a11yNew ? 'error' : undefined, type: 'filter', onSelect: () => go('a11y') },
            // Wall clock for the whole check; rendering in the browser is nearly all of it.
            { label: t('overview.cards.duration'), value: fmt.ms(sm.totalMs), unit: t('overview.cards.rendering', { time: fmt.ms(sm.renderWallMs) }) },
          ]}
        />
      ) : (
        <div className={s.empty}>{tx('empty.noCheck', { command: <Cmd>pxsig check --full</Cmd> })}</div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t('overview.openItems')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={s.stack}>
            {open ? null : <span className={s.muted}>{t('overview.noOpenItems')}</span>}
            <DataGrid
              data={items}
              getRowId={(r: Item) => r.id}
              density="compact"
              showToolbar={false}
              enablePagination={false}
              onRowClick={(row: { original: Item }) => row.original.count && row.original.open()}
              columns={[
                { id: 'label', accessorKey: 'label', header: t('overview.columns.item'), cell: ({ row }: { row: { original: Item } }) => <span className={row.original.count ? undefined : s.muted}>{row.original.label}</span> },
                { id: 'count', accessorKey: 'count', header: t('overview.columns.count'), align: 'right', cell: ({ row }: { row: { original: Item } }) => <span className={row.original.count ? s.mono : `${s.mono} ${s.muted}`}>{row.original.count}</span> },
                { id: 'detail', accessorKey: 'detail', header: t('overview.columns.detail'), cell: ({ row }: { row: { original: Item } }) => <span className={s.muted}>{row.original.detail}</span> },
                {
                  id: 'action',
                  header: t('overview.columns.action'),
                  align: 'right',
                  cell: ({ row }: { row: { original: Item } }) =>
                    row.original.count ? (
                      <Button size="sm" variant="outline" onClick={(e: React.MouseEvent) => (e.stopPropagation(), row.original.open())}>
                        {t(row.original.action)}
                      </Button>
                    ) : null,
                },
              ]}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
