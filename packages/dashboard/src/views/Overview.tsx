import type React from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, DataTable, StatGroup } from '@ui';
import { type Data, type Queue, fmt, rowsWithPending, served, statusOf } from '../data';
import { Cmd, t, tx, type CopyKey } from '../copy';
import { Affordance } from '../parts/Affordance';
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
  // Entries whose new violations have no decision yet (an accessibility one, or a visual approval).
  const a11yOpen = rows.filter((r) => (r.a11y?.new ?? 0) > 0 && !data.a11yReview?.[r.id] && data.review[r.id]?.state !== 'approved');
  const items: Item[] = [
    { id: 'changed', label: t('overview.items.changed'), count: changed.length, detail: byMode(changed.map((r) => r.mode)), action: served ? 'overview.actions.start' : 'overview.actions.review', open: () => review('changed') },
    { id: 'new', label: t('overview.items.new'), count: fresh.length, detail: byMode(fresh.map((r) => r.mode)), action: served ? 'overview.actions.start' : 'overview.actions.review', open: () => review('new') },
    { id: 'rejected', label: t('overview.items.rejected'), count: rejected.length, detail: '', action: 'overview.actions.view', open: () => go('stories', 'rejected') },
    { id: 'error', label: t('overview.items.error'), count: errors.length, detail: '', action: 'overview.actions.view', open: () => go('stories', 'error') },
    {
      id: 'coverage',
      label: t('overview.items.coverage'),
      // Components, as the Coverage tab's count and the banner say; the entries are the detail.
      count: L?.summary.componentsBySeverity.error ?? 0,
      detail: L?.summary.bySeverity.error ? t('overview.entries', { count: L.summary.bySeverity.error }) : '',
      action: 'overview.actions.open',
      open: () => go('integrity'),
    },
    { id: 'a11y', label: t('overview.items.a11y'), count: a11yOpen.length, detail: a11yOpen.length ? t('overview.violations', { count: a11yOpen.reduce((n, r) => n + (r.a11y?.new ?? 0), 0) }) : '', action: served ? 'overview.actions.start' : 'overview.actions.open', open: () => (served ? startReview('a11y') : go('a11y')) },
    { id: 'flaky', label: t('overview.items.flaky'), count: flaky.length, detail: byMode(flaky.map((r) => r.mode)), action: 'overview.actions.view', open: () => go('stories', 'flaky') },
  ];
  const open = items.some((x) => x.count > 0);
  return (
    <div className={s.stack}>
      {sm ? (
        <StatGroup
          className={s.statCards}
          label={t('overview.cards.label')}
          items={[
            { label: t('overview.cards.checked'), value: sm.checked, unit: sm.skipped ? t('overview.cards.notRun', { count: sm.skipped }) : sm.modes.join(' · ') },
            { label: t('overview.cards.passed'), value: sm.passed, tone: 'success' },
            // Changes still waiting for a decision: not new entries, render errors or approved ones
            // (`summary.failed` counts all of those), so it matches "Changed, awaiting review".
            { label: t('overview.cards.changed'), value: changed.length, tone: changed.length ? 'danger' : undefined, onSelect: () => review('changed'), icon: <Affordance kind="navigate" /> },
            { label: t('overview.cards.flaky'), value: sm.flaky, tone: sm.flaky ? 'warning' : undefined, onSelect: () => go('stories', 'flaky'), icon: <Affordance kind="navigate" /> },
            { label: t('overview.cards.a11y'), value: sm.a11yNew, unit: t('overview.cards.a11yOf', { count: sm.a11yViolations }), tone: sm.a11yNew ? 'danger' : undefined, onSelect: () => (served ? startReview('a11y') : go('a11y')), icon: <Affordance kind="navigate" /> },
            // Wall clock for the whole check; rendering in the browser is nearly all of it.
            { label: t('overview.cards.duration'), value: fmt.ms(sm.totalMs), unit: sm.renderWallMs == null ? undefined : t('overview.cards.rendering', { time: fmt.ms(sm.renderWallMs) }) },
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
            <DataTable
              rows={items}
              rowId={(r) => r.id}
              paginate={false}
              onRowClick={(r) => r.count && r.open()}
              columns={[
                { id: 'label', field: 'label', header: t('overview.columns.item'), cell: (r) => <span className={r.count ? undefined : s.muted}>{r.label}</span> },
                { id: 'count', field: 'count', header: t('overview.columns.count'), align: 'end', cell: (r) => <span className={r.count ? s.mono : `${s.mono} ${s.muted}`}>{r.count}</span> },
                { id: 'detail', field: 'detail', header: t('overview.columns.detail'), cell: (r) => <span className={s.muted}>{r.detail}</span> },
                {
                  id: 'action',
                  header: t('overview.columns.action'),
                  align: 'end',
                  cell: (r) =>
                    r.count ? (
                      <Button size="sm" emphasis="outline" onClick={(e: React.MouseEvent) => (e.stopPropagation(), r.open())}>
                        {t(r.action)}
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
