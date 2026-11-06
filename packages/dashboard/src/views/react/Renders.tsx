/**
 * Diagnostics › React › Renders: React's commits and renders per entry, counted while pxsig
 * rendered it, with the entries React was still committing at capture first. Measure renders runs
 * a visual check of the entries in scope with counting on (their visual results are replaced, as
 * by Re-check); Cancel stops it, and the entries rendered by then keep their new results.
 */
import React from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  Progress,
  Select,
  SidePanel,
  SidePanelLayout,
  SidePanelMain,
  Toolbar,
  ToolbarEnd,
  ToolbarField,
  ToolbarStart,
} from '@ui';
import { t } from '../../copy';
import {
  cancelCheck,
  type Data,
  measureRenders,
  type ReactData,
  type RenderCounts,
  type Row,
  useCheckActivity,
} from '../../data';
import { useApproving } from '../../link';
import * as s from '../../dashboard.css';
import { RendersPanel } from './RendersPanel';
import { num, OffNote, offersRuns, PartChoice, type ReactPart, readOnlyTitle } from './shared';

/** A row that was measured: its counts, or null when no React renderer loaded. */
type Measured = Row & { renders: RenderCounts | null };

const still = (r: Measured) => r.renders?.settled === false;
/** "+12 commits", "−1 commit", "0", or "new" with nothing to compare with (information only). */
export function sinceLast(c: RenderCounts | null) {
  if (!c) return '—';
  if (!c.prev) return t('diagnostics.react.renders.sinceNew');
  const d = c.mount.commits - c.prev.commits;
  if (!d) return '0';
  return t('diagnostics.react.renders.sinceCommits', {
    sign: d > 0 ? '+' : '−',
    count: Math.abs(d),
  });
}
/** The top component: "Button ×14 · not compiled". */
export const topOf = (c: RenderCounts | null) => {
  const top = c?.top[0];
  return top
    ? t('diagnostics.react.renders.top', {
        name: top.name,
        count: top.renders,
        compiled: t(
          top.compiled
            ? 'diagnostics.react.renders.compiled'
            : 'diagnostics.react.renders.notCompiled'
        ),
      })
    : '—';
};

export function Renders({
  data,
  react,
  part,
  onPart,
  onOpen,
  initialAll,
}: {
  data: Data;
  react: ReactData;
  part: ReactPart;
  onPart: (p: ReactPart) => void;
  onOpen: (row: Row, list: Row[]) => void;
  initialAll?: boolean;
}) {
  const activity = useCheckActivity();
  const approving = useApproving();
  const readOnly = approving?.allowed === false;
  const off = react.status.renders === 'off';
  const rows = (data.check?.rows ?? []).filter((r) => !r.skipped);
  const measured = React.useMemo(
    () =>
      rows
        .filter((r): r is Measured => r.renders !== undefined)
        .sort(
          (a, b) =>
            Number(still(b)) - Number(still(a)) ||
            Number(!!b.renders) - Number(!!a.renders) ||
            (b.renders?.mount.commits ?? 0) - (a.renders?.mount.commits ?? 0) ||
            a.id.localeCompare(b.id)
        ),
    [data] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const alerts = measured.filter(still);
  const [all, setAll] = React.useState<boolean | null>(initialAll ?? null);
  const showAll = all ?? !alerts.length;
  const shown = showAll ? measured : alerts;
  const [picked, setPicked] = React.useState<string | null>(null);
  const selected = measured.find((r) => r.id === picked) ?? null;
  const [scope, setScope] = React.useState<'all' | 'shown' | 'one'>('all');
  const scoped = scope === 'one' && selected ? [selected] : scope === 'shown' ? shown : rows;
  const measuring = !!activity.running && activity.renders;
  const progress = measuring ? activity.progress : null;
  const [asking, setAsking] = React.useState(false);
  const measure = async (ids: string[]) => {
    setAsking(true);
    try {
      await measureRenders(ids);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setAsking(false);
    }
  };
  const offers = offersRuns(data) && !off;
  const busy = measuring || asking;
  const first = measured.find((r) => r.renders)?.renders ?? null;
  const production = first?.build === 'production';
  const noteId = React.useId();
  const runTitle = readOnly ? readOnlyTitle() : t('diagnostics.react.renders.measureTitle');
  return (
    <div className={s.stack}>
      <Toolbar size="sm">
        <ToolbarStart>
          <PartChoice part={part} onPart={onPart} />
        </ToolbarStart>
        {offers ? (
          <ToolbarEnd>
            <ToolbarField label={t('diagnostics.react.renders.scope')}>
              <Select
                value={scope === 'one' && !selected ? 'all' : scope}
                onValueChange={(v) => setScope(v as typeof scope)}
                options={[
                  {
                    value: 'all',
                    label: t('diagnostics.react.renders.scopeAll', { count: rows.length }),
                  },
                  ...(shown.length !== rows.length
                    ? [
                        {
                          value: 'shown',
                          label: t('diagnostics.react.renders.scopeShown', { count: shown.length }),
                        },
                      ]
                    : []),
                  ...(selected ? [{ value: 'one', label: selected.id }] : []),
                ]}
              />
            </ToolbarField>
            <Button
              disabled={busy || readOnly || !scoped.length}
              title={runTitle}
              aria-describedby={noteId}
              onClick={() => void measure(scoped.map((r) => r.id))}
            >
              {busy
                ? t('diagnostics.react.renders.measuring')
                : t('diagnostics.react.renders.measure')}
            </Button>
          </ToolbarEnd>
        ) : null}
      </Toolbar>
      {offers ? (
        <span id={noteId} className={s.muted}>
          {t('diagnostics.react.renders.measureNote', { count: scoped.length })}
        </span>
      ) : null}
      {off ? <OffNote react={react} whole /> : null}
      {progress ? (
        <div className={s.runBar}>
          <Progress
            className={s.grow}
            value={progress.total ? (progress.done / progress.total) * 100 : 0}
            label={t('diagnostics.react.renders.progressLabel')}
          />
          <span className={s.micro}>
            {t('diagnostics.react.renders.progress', {
              done: progress.done,
              total: progress.total,
              count: progress.total,
            })}
          </span>
          <Button
            size="sm"
            emphasis="outline"
            disabled={readOnly}
            title={readOnly ? readOnlyTitle() : t('diagnostics.react.renders.cancelTitle')}
            onClick={() => void cancelCheck().catch((e: Error) => alert(e.message))}
          >
            {t('diagnostics.react.renders.cancel')}
          </Button>
        </div>
      ) : null}
      {off ? null : !measured.length ? (
        <div className={s.empty}>{t('diagnostics.react.renders.none')}</div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('diagnostics.react.renders.title')}</CardTitle>
            <CardDescription>
              {t('diagnostics.react.renders.summary', {
                count: measured.length,
                build: t(`diagnostics.react.renders.build.${first?.build ?? 'development'}`),
                version: first?.react ?? '—',
                still: alerts.length
                  ? t('diagnostics.react.renders.summaryStill', { count: alerts.length })
                  : '',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SidePanelLayout>
              <SidePanelMain>
                <div className={s.stack}>
                  {production ? (
                    <span className={s.muted}>{t('diagnostics.react.renders.productionNote')}</span>
                  ) : null}
                  <Toolbar size="sm">
                    <ToolbarStart>
                      <Button
                        emphasis={showAll ? 'outline' : 'solid'}
                        onClick={() => setAll(false)}
                      >
                        {t('diagnostics.react.renders.filterAlerts', { count: alerts.length })}
                      </Button>
                      <Button emphasis={showAll ? 'solid' : 'outline'} onClick={() => setAll(true)}>
                        {t('diagnostics.react.renders.filterAll', { count: measured.length })}
                      </Button>
                    </ToolbarStart>
                  </Toolbar>
                  {shown.length ? (
                    <DataTable
                      rows={shown}
                      rowId={(r) => r.id}
                      search
                      paginate={false}
                      onRowClick={(r) => setPicked(r.id)}
                      columns={[
                        {
                          id: 'entry',
                          field: 'id',
                          header: t('diagnostics.react.renders.columns.entry'),
                          cell: (r) => (
                            <span className={s.cellLines}>
                              <span className={s.mono}>
                                {r.id}
                                {r.id === picked ? (
                                  <span className={s.srOnly}>
                                    {t('diagnostics.react.side.selected')}
                                  </span>
                                ) : null}
                              </span>
                              {still(r) ? (
                                <Badge tone="warning">
                                  {t('diagnostics.react.renders.stillBadge')}
                                </Badge>
                              ) : null}
                            </span>
                          ),
                        },
                        {
                          id: 'commits',
                          header: t('diagnostics.react.renders.columns.commits'),
                          align: 'end',
                          cell: (r) =>
                            r.renders
                              ? r.renders.mount.commits
                              : t('diagnostics.react.renders.notReact'),
                        },
                        {
                          id: 'rendered',
                          header: t('diagnostics.react.renders.columns.rendered'),
                          align: 'end',
                          cell: (r) => num(r.renders?.mount.rendered),
                        },
                        ...(production
                          ? []
                          : [
                              {
                                id: 'time',
                                header: t('diagnostics.react.renders.columns.time'),
                                align: 'end' as const,
                                cell: (r: Measured) =>
                                  r.renders?.ms != null
                                    ? t('diagnostics.react.renders.ms', {
                                        ms: r.renders.ms.toFixed(1),
                                      })
                                    : '—',
                              },
                            ]),
                        {
                          id: 'top',
                          header: t('diagnostics.react.renders.columns.top'),
                          cell: (r) => topOf(r.renders),
                        },
                        {
                          id: 'since',
                          header: t('diagnostics.react.renders.columns.since'),
                          cell: (r) => sinceLast(r.renders),
                        },
                      ]}
                    />
                  ) : (
                    <div className={s.empty}>{t('diagnostics.react.renders.noAlerts')}</div>
                  )}
                </div>
              </SidePanelMain>
              <SidePanel
                key={selected?.id}
                open={!!selected}
                onOpenChange={(o) => (o ? null : setPicked(null))}
                title={selected?.id ?? ''}
                closeLabel={t('diagnostics.react.renders.side.close')}
              >
                {selected ? (
                  <RendersPanel
                    row={selected}
                    canMeasure={offers && !readOnly && !busy}
                    onMeasure={() => void measure([selected.id])}
                    onOpen={() => onOpen(selected, shown)}
                  />
                ) : null}
              </SidePanel>
            </SidePanelLayout>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
