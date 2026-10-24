import type React from 'react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, DataTable, StatGroup } from '@ui';
import { type Data, type Queue, type Row, fmt, rowsWithPending, served, statusOf } from '../data';
import { Cmd, codeCopy, t, tx, type CopyKey } from '../copy';
import { Affordance } from '../parts/Affordance';
import { ChangedPerRun } from '../parts/RunCharts';
import { StaleHeatmap } from '../parts/StaleHeatmap';
import { CoverageDetails, coverageHasErrors, coverageHeadline } from './Integrity';
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

/** How many error rows the errors card lists before it points to the lists themselves. */
const ERROR_ROWS = 8;
/** How many heatmap tiles the Overview shows; Coverage shows them all. */
const STALE_TILES = 12;

interface ErrorRow {
  id: string;
  kind: string;
  name: string;
  detail: string;
  open(): void;
}

/**
 * The errors card, at the top of the right column only while there are errors: first the coverage
 * banner's own details and actions (the banner stays off this page meanwhile), so a repair is in
 * view; then the render errors of the last check and coverage errors (components and setup), each
 * row opening where it is fixed.
 */
function ErrorsCard({ data, renderErrors, go, startReview }: { data: Data; renderErrors: Row[]; go(tab: string, filter?: string): void; startReview(kind: Queue): void }) {
  const L = data.integrity;
  const coverage = coverageHasErrors(L);
  if (!renderErrors.length && !coverage) return null;
  const rows: ErrorRow[] = [
    ...renderErrors.map((r) => ({ id: `render:${r.id}`, kind: t('overview.errors.render'), name: r.id, detail: (r.error ?? '').split('\n')[0], open: () => go('stories', 'error') })),
    ...(L?.components ?? [])
      .filter((c) => c.severity === 'error')
      .map((c) => ({
        id: `coverage:${c.component}`,
        kind: t('overview.errors.coverage'),
        name: c.component,
        detail: Object.entries(c.counts)
          .filter(([code]) => L!.entries.some((x) => x.component === c.component && x.issues.some((i) => i.code === code && i.severity === 'error')))
          .map(([code, n]) => t('coverage.headline.code', { title: codeCopy(code).title, count: n }))
          .join(' · '),
        open: () => go('integrity', c.component),
      })),
  ];
  const shown = rows.slice(0, ERROR_ROWS);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('overview.errors.title')}</CardTitle>
        <CardDescription>
          {[renderErrors.length ? t('overview.errors.renderCount', { count: renderErrors.length }) : '', coverage && L ? coverageHeadline(L) : ''].filter(Boolean).join(' · ')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className={s.stack}>
          {/* What to do first (repair, approve, open the render errors), the rows to read last. */}
          {renderErrors.length ? (
            <span className={s.row}>
              <Button size="sm" emphasis="outline" onClick={() => go('stories', 'error')}>
                {t('overview.errors.viewRender', { count: renderErrors.length })}
              </Button>
            </span>
          ) : null}
          {coverage ? (
            <div className={s.small}>
              <CoverageDetails data={data} go={go} startReview={startReview} />
            </div>
          ) : null}
          {shown.length ? (
            <DataTable
              rows={shown}
              rowId={(r) => r.id}
              paginate={false}
              onRowClick={(r) => r.open()}
              columns={[
                { id: 'kind', field: 'kind', header: t('overview.errors.columns.kind'), cell: (r) => <span className={s.muted}>{r.kind}</span> },
                { id: 'name', field: 'name', header: t('overview.errors.columns.name'), cell: (r) => <span className={s.mono}>{r.name}</span> },
                { id: 'detail', field: 'detail', header: t('overview.errors.columns.detail'), cell: (r) => <span className={s.muted}>{r.detail}</span> },
              ]}
            />
          ) : null}
          {rows.length > shown.length ? <span className={s.muted}>{t('overview.errors.more', { count: rows.length - shown.length })}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The landing tab: the last check in numbers across the top; below, open items and stale entries
 * by component on the left, errors (only while there are any) and changed entries per run on the
 * right.
 */
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
      <div className={s.overviewCols}>
        <div className={s.overviewGrid}>
          <div className={s.stack} data-column="start">
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
                // Half a page wide: the item's label gets the room, its detail on a second line;
                // count and action are narrow. The grid adds each cell's padding to these widths.
                {
                  id: 'label',
                  field: 'label',
                  header: t('overview.columns.item'),
                  width: '232px',
                  cell: (r) => (
                    <span className={s.cellLines}>
                      <span className={r.count ? undefined : s.muted}>{r.label}</span>
                      {r.detail ? <span className={`${s.muted} ${s.micro}`}>{r.detail}</span> : null}
                    </span>
                  ),
                },
                { id: 'count', field: 'count', header: t('overview.columns.count'), align: 'end', width: '56px', cell: (r) => <span className={r.count ? s.mono : `${s.mono} ${s.muted}`}>{r.count}</span> },
                {
                  id: 'action',
                  header: t('overview.columns.action'),
                  align: 'end',
                  width: '84px',
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
            <StaleHeatmap data={data} limit={STALE_TILES} onSelect={(component) => go('integrity', component)} onViewAll={() => go('integrity')} />
          </div>
          <div className={s.stack} data-column="end">
            <ErrorsCard data={data} renderErrors={errors} go={go} startReview={startReview} />
            <ChangedPerRun runs={data.history ?? []} />
          </div>
        </div>
      </div>
    </div>
  );
}
