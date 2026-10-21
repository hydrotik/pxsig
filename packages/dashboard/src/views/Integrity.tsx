import React from 'react';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, DataTable, StatGroup, StatusBadge, Toolbar, ToolbarStart, type Tone } from '@ui';
import { type Data, type Row, repairSafe, rowsWithPending, served } from '../data';
import { Cmd, codeCopy, t, tx } from '../copy';
import { Affordance } from '../parts/Affordance';
import * as s from '../dashboard.css';

type Severity = 'error' | 'warn' | 'info';
const TONE: Record<Severity, Tone> = { error: 'danger', warn: 'warning', info: 'success' };
const order: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

/** One integrity status → one badge, coloured by severity. */
export function IntegrityStatus({ code, severity }: { code: string; severity: Severity }) {
  const c = codeCopy(code);
  return <StatusBadge icon="dot" label={c.title} title={c.help || undefined} tone={code === 'ok' || code === 'drift' ? 'success' : code === 'excluded' ? 'neutral' : TONE[severity]} />;
}

/** The ledger's headline, from its counts (the server's own headline is English-only). */
export function coverageHeadline(L: NonNullable<Data['integrity']>): string {
  const sm = L.summary;
  if (sm.componentsBySeverity.error) {
    const codes = Object.entries(sm.byCode)
      .filter(([code]) => L.entries.some((x) => x.issues.some((i) => i.code === code && i.severity === 'error')))
      .map(([code]) => t('coverage.headline.code', { title: codeCopy(code).title, count: L.entries.filter((x) => x.issues.some((i) => i.code === code && i.severity === 'error')).length }));
    return [t('coverage.headline.error', { count: sm.componentsBySeverity.error }), ...codes].join(' · ');
  }
  return sm.componentsBySeverity.warn ? t('coverage.headline.warn', { count: sm.componentsBySeverity.warn }) : t('coverage.headline.clean');
}

/**
 * The banner at the top of every tab while anything is error-severity, with the one-click safe
 * repair (register new stories without signatures, re-check, restore baseline images that pass
 * the gate). It never approves, never writes a signature and never prunes.
 */
export function IntegrityBanner({ data, go }: { data: Data; go(tab: string): void }) {
  const L = data.integrity;
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  if (!L || (L.summary.status !== 'attention' && !L.setup.length && !msg)) return null;
  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await repairSafe();
      setMsg(r.applied?.length ? r.applied.map((x) => `${x.action}: ${x.result}`).join(' · ') : t('coverage.banner.nothing'));
    } catch (e) {
      setMsg(t('coverage.banner.failed', { error: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Alert tone={L.summary.status === 'attention' || L.setup.some((x) => x.severity === 'error') ? 'danger' : 'neutral'} label={t('coverage.banner.label')}>
      <AlertTitle>{coverageHeadline(L)}</AlertTitle>
      <AlertDescription>
        <div className={s.stack}>
          {L.setup.map((x) => (
            <span key={x.code}>
              <strong>{codeCopy(x.code).title}</strong> · {x.reason}
            </span>
          ))}
          <span className={s.row}>
            <Button size="sm" emphasis="outline" onClick={() => go('integrity')}>
              {t('coverage.banner.viewComponents')}
            </Button>
            {served ? (
              <Button size="sm" onClick={run} disabled={busy}>
                {busy ? t('coverage.banner.repairing') : t('coverage.banner.repair')}
              </Button>
            ) : null}
            <span className={s.muted}>{t('coverage.banner.repairNote')}</span>
          </span>
          {msg ? <span className={s.mono}>{msg}</span> : null}
        </div>
      </AlertDescription>
    </Alert>
  );
}

export function Integrity({ data, onOpen }: { data: Data; onOpen(row: Row, list: Row[]): void }) {
  const L = data.integrity;
  const [selected, setSelected] = React.useState<string | null>(null);
  const [all, setAll] = React.useState(false);
  // A count card filters the table below it to the components with that issue.
  const [code, setCode] = React.useState<string | null>(null);
  if (!L) return <div className={s.empty}>{tx('coverage.empty', { command: <Cmd>pxsig doctor</Cmd>, command2: <Cmd>pxsig serve</Cmd> })}</div>;
  const comps = [...L.components].filter((c) => (code ? (c.counts[code] ?? 0) > 0 : all || c.severity !== 'info')).sort((a, b) => order[a.severity] - order[b.severity] || a.component.localeCompare(b.component));
  const entries = L.entries.filter((x) => x.component === selected).sort((a, b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id));
  const rows = rowsWithPending(data);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sm = L.summary;
  const ix = L.sources.storyIndex;
  return (
    <div className={s.stack}>
      <StatGroup
        className={s.statCards}
        label={t('tabs.coverage')}
        items={[
          { label: t('coverage.stats.components'), value: sm.components, unit: t('coverage.stats.withErrors', { count: sm.componentsBySeverity.error }) },
          { label: t('coverage.stats.errors'), value: sm.bySeverity.error, tone: sm.bySeverity.error ? 'danger' : 'success' },
          { label: t('coverage.stats.warnings'), value: sm.bySeverity.warn, tone: sm.bySeverity.warn ? 'warning' : undefined },
          ...(['unregistered', 'never-checked', 'missing-baseline-image'] as const).map((c) =>
            sm.byCode[c]
              ? { label: codeCopy(c).title, value: sm.byCode[c], tone: 'danger' as const, active: code === c, onSelect: () => setCode(code === c ? null : c), icon: <Affordance kind="filter" /> }
              : { label: codeCopy(c).title, value: 0 }
          ),
        ]}
      />
      <Card>
        <CardHeader>
          <CardTitle>{t('coverage.table.title')}</CardTitle>
          <CardDescription>{t(ix.source === 'storybook' ? 'coverage.table.sourceStorybook' : 'coverage.table.sourceStatic', { count: ix.inScope, date: new Date(L.generatedAt).toLocaleString() })}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className={s.stack}>
            <Toolbar size="sm">
              <ToolbarStart>
                <Button emphasis={!code && !all ? 'solid' : 'outline'} onClick={() => (setAll(false), setCode(null))}>
                  {t('coverage.table.withIssues', { count: L.components.filter((c) => c.severity !== 'info').length })}
                </Button>
                <Button emphasis={!code && all ? 'solid' : 'outline'} onClick={() => (setAll(true), setCode(null))}>
                  {t('coverage.table.all', { count: L.components.length })}
                </Button>
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
                  { id: 'status', field: 'status', header: t('coverage.table.status'), cell: (r) => <IntegrityStatus code={r.status} severity={r.severity} /> },
                  { id: 'component', field: 'component', header: t('coverage.table.component'), cell: (r) => <strong>{r.component}</strong> },
                  { id: 'entries', field: 'entries', header: t('coverage.table.entries'), align: 'end' },
                  {
                    id: 'issues',
                    field: 'counts',
                    header: t('coverage.table.issues'),
                    cell: (r) => (
                      <span className={s.row}>
                        {Object.entries(r.counts).map(([code, n]) => (
                          <Badge key={code} tone={['unregistered', 'never-checked', 'missing-baseline-image', 'render-error'].includes(code) ? 'danger' : 'neutral'} title={codeCopy(code).help || undefined}>
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
        <Card>
          <CardHeader>
            <CardTitle>{selected}</CardTitle>
            <CardDescription>{t('coverage.entries.description', { count: entries.length })}</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              rows={entries}
              rowId={(r) => r.id}
              paginate={false}
              onRowClick={(e) => {
                const r = byId.get(e.id);
                if (r && (r.metrics || (r.new && !r.pending))) onOpen(r, rows.filter((x) => entries.some((e) => e.id === x.id)));
              }}
              columns={[
                { id: 'status', field: 'status', header: t('coverage.entries.status'), cell: (e) => <IntegrityStatus code={e.status} severity={e.severity} /> },
                { id: 'id', field: 'id', header: t('coverage.entries.entry'), cell: (e) => <span className={s.mono}>{e.id}</span> },
                {
                  id: 'why',
                  field: 'issues',
                  header: t('coverage.entries.detail'),
                  cell: (e) => <span className={s.muted}>{e.issues.map((i) => `${codeCopy(i.code).title}: ${i.reason}`).join(' · ') || t('coverage.entries.noIssues')}</span>,
                },
              ]}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
