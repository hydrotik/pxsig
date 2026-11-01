import React from 'react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  StatGroup,
  StatusBadge,
  Toolbar,
  ToolbarStart,
  type Tone,
} from '@ui';
import {
  type Data,
  type Queue,
  type Row,
  repairSafe,
  reviewQueue,
  rowsWithPending,
  served,
} from '../data';
import { Cmd, codeCopy, t, tx } from '../copy';
import { Affordance } from '../parts/Affordance';
import { StaleHeatmap } from '../parts/StaleHeatmap';
import * as s from '../dashboard.css';

type Severity = 'error' | 'warn' | 'info';
const TONE: Record<Severity, Tone> = { error: 'danger', warn: 'warning', info: 'success' };
const order: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

/** One integrity status → one badge, coloured by severity. */
export function IntegrityStatus({ code, severity }: { code: string; severity: Severity }) {
  const c = codeCopy(code);
  return (
    <StatusBadge
      icon="dot"
      label={c.title}
      title={c.help || undefined}
      tone={
        code === 'ok' || code === 'drift'
          ? 'success'
          : code === 'excluded'
            ? 'neutral'
            : TONE[severity]
      }
    />
  );
}

/** The ledger's headline, from its counts (the server's own headline is English-only). */
export function coverageHeadline(L: NonNullable<Data['integrity']>): string {
  const sm = L.summary;
  if (sm.componentsBySeverity.error) {
    const codes = Object.entries(sm.byCode)
      .filter(([code]) =>
        L.entries.some((x) => x.issues.some((i) => i.code === code && i.severity === 'error'))
      )
      .map(([code]) =>
        t('coverage.headline.code', {
          title: codeCopy(code).title,
          count: L.entries.filter((x) =>
            x.issues.some((i) => i.code === code && i.severity === 'error')
          ).length,
        })
      );
    return [t('coverage.headline.error', { count: sm.componentsBySeverity.error }), ...codes].join(
      ' · '
    );
  }
  return sm.componentsBySeverity.warn
    ? t('coverage.headline.warn', { count: sm.componentsBySeverity.warn })
    : t('coverage.headline.clean');
}

/** Whether the ledger has error-severity problems (components or setup): what the banner leads with. */
export const coverageHasErrors = (L: Data['integrity']) =>
  !!L && (L.summary.status === 'attention' || L.setup.length > 0);

/**
 * The banner's body: setup problems, the entries waiting for a first approval, orphaned baselines,
 * and the actions (view components, approve the new entries, the one-click safe repair). The
 * banner shows it on every tab; the Overview's errors card shows it instead of the banner.
 */
export function CoverageDetails({
  data,
  go,
  startReview,
  onBusy,
}: {
  data: Data;
  go: (tab: string) => void;
  startReview?: (kind: Queue) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const L = data.integrity;
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const errors = coverageHasErrors(L);
  const firsts = L?.summary.byCode.unbaselined ?? 0;
  const clean = !L || (!errors && !firsts);
  // The server pushes the repaired ledger, so the banner closes on its own once nothing is left
  // to repair (the result used to hold it open until a reload). The result belongs to the ledger
  // it was shown with, so it goes when the ledger turns clean or turns bad again.
  React.useEffect(() => setMsg(null), [clean]);
  if (!L) return null;
  const orphans = L.summary.byCode.orphaned ?? 0;
  // New entries already rendered can be approved now; the rest need a render first (the repair).
  const toApprove = reviewQueue(data, 'new').filter((r) => !data.review[r.id]).length;
  const repairable =
    errors || L.entries.some((x) => x.files && x.issues.some((i) => i.code === 'missing-render'));
  const working = (b: boolean) => (setBusy(b), onBusy?.(b));
  const run = async () => {
    working(true);
    setMsg(null);
    try {
      const r = await repairSafe();
      setMsg(
        r.applied?.length
          ? r.applied.map((x) => `${x.action}: ${x.result}`).join(' · ')
          : t('coverage.banner.nothing')
      );
    } catch (e) {
      setMsg(t('coverage.banner.failed', { error: (e as Error).message }));
    } finally {
      working(false);
    }
  };
  return (
    <div className={s.stack}>
      {L.setup.map((x) => (
        <span key={x.code}>
          <strong>{codeCopy(x.code).title}</strong> · {x.reason}
        </span>
      ))}
      {firsts ? (
        <span className={s.row}>
          {errors ? (
            <Badge tone="warning">{t('coverage.banner.firstApproval', { count: firsts })}</Badge>
          ) : null}
          <span className={s.muted}>{t('coverage.banner.firstApprovalNote')}</span>
        </span>
      ) : null}
      {orphans ? (
        <span className={s.muted}>
          {tx('coverage.banner.orphans', {
            count: orphans,
            command: <Cmd>pxsig doctor --repair --prune --apply</Cmd>,
          })}
        </span>
      ) : null}
      <span className={s.row}>
        <Button size="sm" emphasis="outline" onClick={() => go('integrity')}>
          {t('coverage.banner.viewComponents')}
        </Button>
        {served && toApprove && startReview ? (
          <Button
            size="sm"
            emphasis={repairable ? 'outline' : 'solid'}
            onClick={() => startReview('new')}
          >
            {t('coverage.banner.approveNew', { count: toApprove })}
          </Button>
        ) : null}
        {served && (repairable || busy) ? (
          <Button size="sm" onClick={run} disabled={busy}>
            {busy ? t('coverage.banner.repairing') : t('coverage.banner.repair')}
          </Button>
        ) : null}
        {repairable ? <span className={s.muted}>{t('coverage.banner.repairNote')}</span> : null}
      </span>
      {msg ? <span className={s.mono}>{msg}</span> : null}
    </div>
  );
}

/**
 * The banner at the top of every tab while anything is error-severity, or while registered entries
 * wait for their first approval (a warning, counted on its own so it does not vanish once the
 * errors are repaired). It carries the one-click safe repair (register new stories and render
 * them, re-check, restore baseline images that pass the gate) and, for the new entries, the
 * review queue that approves them. It never approves, never writes a signature and never prunes.
 * `errorsShownElsewhere`: the page shows the errors itself (the Overview's errors card), so the
 * banner stays away while there are errors.
 */
export function IntegrityBanner({
  data,
  go,
  startReview,
  errorsShownElsewhere,
}: {
  data: Data;
  go: (tab: string) => void;
  startReview?: (kind: Queue) => void;
  errorsShownElsewhere?: boolean;
}) {
  const L = data.integrity;
  const [busy, setBusy] = React.useState(false);
  const firsts = L?.summary.byCode.unbaselined ?? 0;
  const errors = coverageHasErrors(L);
  const clean = !L || (!errors && !firsts);
  if (!L || (clean && !busy) || (errors && errorsShownElsewhere)) return null;
  return (
    <Alert
      tone={
        errors && (L.summary.status === 'attention' || L.setup.some((x) => x.severity === 'error'))
          ? 'danger'
          : 'neutral'
      }
      label={t('coverage.banner.label')}
    >
      <AlertTitle>
        {errors ? coverageHeadline(L) : t('coverage.banner.firstApproval', { count: firsts })}
      </AlertTitle>
      <AlertDescription>
        <CoverageDetails data={data} go={go} startReview={startReview} onBusy={setBusy} />
      </AlertDescription>
    </Alert>
  );
}

/** A request to open Coverage on one component (a heatmap tile, an error row); `at` makes each request new. */
export interface CoverageFocus {
  component: string;
  at: number;
}

export function Integrity({
  data,
  onOpen,
  focus,
}: {
  data: Data;
  onOpen: (row: Row, list: Row[]) => void;
  focus?: CoverageFocus | null;
}) {
  const L = data.integrity;
  const [selected, setSelected] = React.useState<string | null>(focus?.component ?? null);
  const [all, setAll] = React.useState(false);
  // A count card filters the table below it to the components with that issue.
  const [code, setCode] = React.useState<string | null>(null);
  // A heatmap tile (here or on the Overview) filters the table to its component and opens it.
  const [only, setOnly] = React.useState<string | null>(focus?.component ?? null);
  const entriesRef = React.useRef<HTMLDivElement>(null);
  const show = (component: string) => {
    setOnly(component);
    setSelected(component);
    setCode(null);
  };
  React.useEffect(() => {
    if (focus) show(focus.component);
  }, [focus?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  // The component's entries open below the table: bring them into view (after the frame, so the
  // app's own scroll to the top of a newly opened section runs first).
  React.useEffect(() => {
    if (!only) return;
    const id = requestAnimationFrame(() =>
      entriesRef.current?.scrollIntoView?.({ block: 'nearest' })
    );
    return () => cancelAnimationFrame(id);
  }, [only, focus?.at]);
  if (!L)
    return (
      <div className={s.empty}>
        {tx('coverage.empty', {
          command: <Cmd>pxsig doctor</Cmd>,
          command2: <Cmd>pxsig serve</Cmd>,
        })}
      </div>
    );
  const comps = [...L.components]
    .filter((c) =>
      only ? c.component === only : code ? (c.counts[code] ?? 0) > 0 : all || c.severity !== 'info'
    )
    .sort(
      (a, b) => order[a.severity] - order[b.severity] || a.component.localeCompare(b.component)
    );
  const entries = L.entries
    .filter((x) => x.component === selected)
    .sort((a, b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id));
  const rows = rowsWithPending(data);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sm = L.summary;
  const ix = L.sources.storyIndex;
  return (
    <div className={s.stack}>
      <StatGroup
        className={s.statCards}
        label={t('coverage.stats.label')}
        items={[
          {
            label: t('coverage.stats.components'),
            value: sm.components,
            unit: t('coverage.stats.withErrors', { count: sm.componentsBySeverity.error }),
          },
          {
            label: t('coverage.stats.errors'),
            value: sm.bySeverity.error,
            tone: sm.bySeverity.error ? 'danger' : 'success',
          },
          {
            label: t('coverage.stats.warnings'),
            value: sm.bySeverity.warn,
            tone: sm.bySeverity.warn ? 'warning' : undefined,
          },
          ...(
            ['unregistered', 'never-checked', 'missing-baseline-image', 'unbaselined'] as const
          ).map((c) =>
            sm.byCode[c]
              ? {
                  label: codeCopy(c).title,
                  value: sm.byCode[c],
                  tone: c === 'unbaselined' ? ('warning' as const) : ('danger' as const),
                  active: code === c,
                  onSelect: () => (setOnly(null), setCode(code === c ? null : c)),
                  icon: <Affordance kind="filter" />,
                }
              : { label: codeCopy(c).title, value: 0 }
          ),
        ]}
      />
      <StaleHeatmap data={data} onSelect={show} />
      <Card>
        <CardHeader>
          <CardTitle>{t('coverage.table.title')}</CardTitle>
          <CardDescription>
            {t(
              ix.source === 'dashboard-screens'
                ? 'coverage.table.sourceScreens'
                : ix.source === 'storybook'
                  ? 'coverage.table.sourceStorybook'
                  : 'coverage.table.sourceStatic',
              {
                count: ix.source === 'dashboard-screens' ? sm.entries : ix.inScope,
                date: new Date(L.generatedAt).toLocaleString(),
              }
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className={s.stack}>
            <Toolbar size="sm">
              <ToolbarStart>
                <Button
                  emphasis={!only && !code && !all ? 'solid' : 'outline'}
                  onClick={() => (setAll(false), setCode(null), setOnly(null))}
                >
                  {t('coverage.table.withIssues', {
                    count: L.components.filter((c) => c.severity !== 'info').length,
                  })}
                </Button>
                <Button
                  emphasis={!only && !code && all ? 'solid' : 'outline'}
                  onClick={() => (setAll(true), setCode(null), setOnly(null))}
                >
                  {t('coverage.table.all', { count: L.components.length })}
                </Button>
                {only ? (
                  <Button
                    emphasis="solid"
                    title={t('coverage.table.clearOnly')}
                    onClick={() => setOnly(null)}
                  >
                    {t('coverage.table.only', { component: only })}
                  </Button>
                ) : null}
              </ToolbarStart>
            </Toolbar>
            {comps.length ? (
              <DataTable
                rows={comps}
                rowId={(r) => r.component}
                search
                paginate={false}
                onRowClick={(r) => setSelected(r.component)}
                columns={[
                  {
                    id: 'status',
                    field: 'status',
                    header: t('coverage.table.status'),
                    cell: (r) => <IntegrityStatus code={r.status} severity={r.severity} />,
                  },
                  {
                    id: 'component',
                    field: 'component',
                    header: t('coverage.table.component'),
                    cell: (r) => <strong>{r.component}</strong>,
                  },
                  {
                    id: 'entries',
                    field: 'entries',
                    header: t('coverage.table.entries'),
                    align: 'end',
                  },
                  {
                    id: 'issues',
                    field: 'counts',
                    header: t('coverage.table.issues'),
                    cell: (r) => (
                      <span className={s.row}>
                        {Object.entries(r.counts).map(([code, n]) => (
                          <Badge
                            key={code}
                            tone={
                              [
                                'unregistered',
                                'never-checked',
                                'missing-baseline-image',
                                'render-error',
                              ].includes(code)
                                ? 'danger'
                                : 'neutral'
                            }
                            title={codeCopy(code).help || undefined}
                          >
                            {t('coverage.headline.code', { title: codeCopy(code).title, count: n })}
                          </Badge>
                        ))}
                      </span>
                    ),
                  },
                ]}
              />
            ) : (
              <div className={s.empty}>{t('coverage.table.none')}</div>
            )}
          </div>
        </CardContent>
      </Card>
      {selected ? (
        <div ref={entriesRef}>
          <Card>
            <CardHeader>
              <CardTitle>{selected}</CardTitle>
              <CardDescription>
                {t('coverage.entries.description', { count: entries.length })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                rows={entries}
                rowId={(r) => r.id}
                paginate={false}
                onRowClick={(e) => {
                  const r = byId.get(e.id);
                  if (r && (r.metrics || (r.new && !r.pending)))
                    onOpen(
                      r,
                      rows.filter((x) => entries.some((e) => e.id === x.id))
                    );
                }}
                columns={[
                  {
                    id: 'status',
                    field: 'status',
                    header: t('coverage.entries.status'),
                    cell: (e) => <IntegrityStatus code={e.status} severity={e.severity} />,
                  },
                  {
                    id: 'id',
                    field: 'id',
                    header: t('coverage.entries.entry'),
                    cell: (e) => <span className={s.mono}>{e.id}</span>,
                  },
                  {
                    id: 'why',
                    field: 'issues',
                    header: t('coverage.entries.detail'),
                    cell: (e) => (
                      <span className={s.muted}>
                        {e.issues
                          .map((i) => `${codeCopy(i.code).title}: ${i.reason}`)
                          .join(' · ') || t('coverage.entries.noIssues')}
                      </span>
                    ),
                  },
                ]}
              />
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
