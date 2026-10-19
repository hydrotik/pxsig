import React from 'react';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, DataGrid, StatPanel, StatusBadge } from '@hydrotik/design-system';
import { type Data, type IntegrityComponent, type IntegrityEntry, type Row, repairSafe, rowsWithPending, served } from '../data';
import * as s from '../dashboard.css';

type Severity = 'error' | 'warn' | 'info';
const TONE: Record<Severity, 'error' | 'warning' | 'success'> = { error: 'error', warn: 'warning', info: 'success' };
const order: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

/** One integrity status → one badge, coloured by severity. */
export function IntegrityStatus({ code, severity }: { code: string; severity: Severity }) {
  return <StatusBadge label={code} tone={code === 'ok' || code === 'drift' ? 'success' : code === 'excluded' ? 'neutral' : TONE[severity]} />;
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
      setMsg(r.applied?.length ? r.applied.map((x) => `${x.action}: ${x.result}`).join(' · ') : 'Nothing to repair automatically.');
    } catch (e) {
      setMsg(`Repair failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Alert variant={L.summary.status === 'attention' || L.setup.some((x) => x.severity === 'error') ? 'destructive' : 'default'} aria-label="Integrity" style={{ boxSizing: 'border-box' }}>
      <AlertTitle>{L.summary.headline}</AlertTitle>
      <AlertDescription>
        <div className={s.stack}>
          {L.setup.map((x) => (
            <span key={x.code}>
              <strong>{x.code}</strong> — {x.reason}
            </span>
          ))}
          <span className={s.row}>
            <Button size="sm" variant="outline" onClick={() => go('integrity')}>
              Show components
            </Button>
            {served ? (
              <Button size="sm" onClick={run} disabled={busy}>
                {busy ? 'Repairing…' : 'Repair safe issues'}
              </Button>
            ) : null}
            <span className={s.muted}>Safe repairs never approve and never write a signature; changed and new entries still need you.</span>
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
  if (!L) return <div className={s.empty}>No integrity ledger yet: run `pxsig doctor` or `pxsig serve`.</div>;
  const comps = [...L.components].filter((c) => all || c.severity !== 'info').sort((a, b) => order[a.severity] - order[b.severity] || a.component.localeCompare(b.component));
  const entries = L.entries.filter((x) => x.component === selected).sort((a, b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id));
  const rows = rowsWithPending(data);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sm = L.summary;
  const ix = L.sources.storyIndex;
  return (
    <div className={s.stack}>
      <StatPanel
        aria-label="Integrity"
        cards={[
          { label: 'Components', value: sm.components, unit: `${sm.componentsBySeverity.error} need attention` },
          { label: 'Errors', value: sm.bySeverity.error, accent: sm.bySeverity.error ? 'error' : 'success' },
          { label: 'Warnings', value: sm.bySeverity.warn, accent: sm.bySeverity.warn ? 'warning' : undefined },
          { label: 'Unregistered', value: sm.byCode.unregistered ?? 0, accent: sm.byCode.unregistered ? 'error' : undefined },
          { label: 'Never checked', value: sm.byCode['never-checked'] ?? 0, accent: sm.byCode['never-checked'] ? 'error' : undefined },
          { label: 'Missing baseline images', value: sm.byCode['missing-baseline-image'] ?? 0, accent: sm.byCode['missing-baseline-image'] ? 'error' : undefined },
        ]}
      />
      <Card>
        <CardHeader>
          <CardTitle>Coverage and integrity, per component</CardTitle>
          <CardDescription>
            Every story in the {ix.source === 'storybook' ? 'Storybook index' : 'static story scan'} ({ix.inScope} in scope) joined with the manifest, signatures, baseline images, renders, the last report and source edits. Ledger {new Date(L.generatedAt).toLocaleString()}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className={s.stack}>
            <span className={s.row}>
              <Button size="sm" variant={all ? 'outline' : 'default'} onClick={() => setAll(false)}>
                Needing attention ({L.components.filter((c) => c.severity !== 'info').length})
              </Button>
              <Button size="sm" variant={all ? 'default' : 'outline'} onClick={() => setAll(true)}>
                All components ({L.components.length})
              </Button>
            </span>
            {comps.length ? (
              <DataGrid
                data={comps}
                getRowId={(r: IntegrityComponent) => r.component}
                density="compact"
                showToolbar
                enablePagination={false}
                onRowClick={(row: { original: IntegrityComponent }) => setSelected(row.original.component)}
                columns={[
                  { id: 'status', accessorKey: 'status', header: 'Status', cell: ({ row }: { row: { original: IntegrityComponent } }) => <IntegrityStatus code={row.original.status} severity={row.original.severity} /> },
                  { id: 'component', accessorKey: 'component', header: 'Component', cell: ({ row }: { row: { original: IntegrityComponent } }) => <strong>{row.original.component}</strong> },
                  { id: 'entries', accessorKey: 'entries', header: 'Entries', align: 'right' },
                  {
                    id: 'issues',
                    accessorKey: 'counts',
                    header: 'Issues',
                    cell: ({ row }: { row: { original: IntegrityComponent } }) => (
                      <span className={s.row}>
                        {Object.entries(row.original.counts).map(([code, n]) => (
                          <Badge key={code} variant={['unregistered', 'never-checked', 'missing-baseline-image', 'render-error'].includes(code) ? 'destructive' : 'secondary'}>
                            {n} {code}
                          </Badge>
                        ))}
                      </span>
                    ),
                  },
                ]}
              />
            ) : (
              <div className={s.empty}>Every component is clean.</div>
            )}
          </div>
        </CardContent>
      </Card>
      {selected ? (
        <Card>
          <CardHeader>
            <CardTitle>{selected}</CardTitle>
            <CardDescription>{entries.length} entries. Click a rendered entry to open it in the inspector.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataGrid
              data={entries}
              getRowId={(r: IntegrityEntry) => r.id}
              density="compact"
              showToolbar={false}
              enablePagination={false}
              onRowClick={(row: { original: IntegrityEntry }) => {
                const r = byId.get(row.original.id);
                if (r && (r.metrics || (r.new && !r.pending))) onOpen(r, rows.filter((x) => entries.some((e) => e.id === x.id)));
              }}
              columns={[
                { id: 'status', accessorKey: 'status', header: 'Status', cell: ({ row }: { row: { original: IntegrityEntry } }) => <IntegrityStatus code={row.original.status} severity={row.original.severity} /> },
                { id: 'id', accessorKey: 'id', header: 'Entry', cell: ({ row }: { row: { original: IntegrityEntry } }) => <span className={s.mono}>{row.original.id}</span> },
                {
                  id: 'why',
                  accessorKey: 'issues',
                  header: 'Why',
                  cell: ({ row }: { row: { original: IntegrityEntry } }) => <span className={s.muted}>{row.original.issues.map((i) => `${i.code}: ${i.reason}`).join(' · ') || 'covered, rendered, checked, fresh'}</span>,
                },
              ]}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
