/**
 * Diagnostics › React › Compiler: the React Compiler's verdict on the changed component and hook
 * files, base against now, as a table (alerts first), with the selected function's diagnostics
 * in a side panel. Analyse runs the analysis again; nothing here decides anything.
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
  SidePanel,
  SidePanelLayout,
  SidePanelMain,
  Toolbar,
  ToolbarEnd,
  ToolbarStart,
  ToolbarSummary,
} from '@ui';
import { t } from '../../copy';
import {
  analyseReact,
  type Data,
  type ReactData,
  type ReactFunction,
  type Row,
  skipReact,
  useReactActivity,
} from '../../data';
import { useApproving } from '../../link';
import * as s from '../../dashboard.css';
import { CompilerPanel } from './CompilerPanel';
import {
  ALERT_ORDER,
  ChangeBadge,
  fromLabel,
  OffNote,
  offersRuns,
  outcomeLabel,
  PartChoice,
  pathOf,
  rulesOf,
  type ReactPart,
  readOnlyTitle,
  RunNotes,
} from './shared';

const order = (f: ReactFunction) => {
  const i = f.alert ? ALERT_ORDER.indexOf(f.change ?? '') : -1;
  return i < 0 ? ALERT_ORDER.length : i;
};

export function Compiler({
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
  const report = react.report;
  const activity = useReactActivity();
  const approving = useApproving();
  const readOnly = approving?.allowed === false;
  const status = react.status;
  const running =
    activity.running ?? (status.compiler === 'running' ? { done: 0, total: 0, cached: 0 } : null);
  const failed =
    activity.ended?.state === 'error'
      ? activity.ended.error
      : !activity.ended && status.compiler === 'failed'
        ? status.error
        : null;
  const skippedAt = activity.ended?.state === 'skipped' ? activity.ended.at : null;
  const noBase = !!report && !report.base;
  const fns = React.useMemo(
    () =>
      [...(report?.functions ?? [])].sort(
        (a, b) => order(a) - order(b) || a.name.localeCompare(b.name)
      ),
    [report]
  );
  const alerts = fns.filter((f) => f.alert);
  const [all, setAll] = React.useState<boolean | null>(initialAll ?? null);
  const showAll = noBase || (all ?? !alerts.length);
  const shown = showAll ? fns : alerts;
  const [picked, setPicked] = React.useState<string | null>(null);
  const selected = shown.find((f) => f.id === picked) ?? null;
  const entriesOf = (path: string) => report?.files.find((x) => x.path === path);
  const ref = report?.base?.since ?? 'main';
  const off = status.compiler === 'off' || status.compiler === 'not-installed';
  const offers = offersRuns(data) && !off;
  const [asking, setAsking] = React.useState(false);
  const analyse = async () => {
    setAsking(true);
    try {
      await analyseReact();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setAsking(false);
    }
  };
  const busy = !!running || asking;
  const sm = report?.summary;
  return (
    <div className={s.stack}>
      <Toolbar size="sm">
        <ToolbarStart>
          <PartChoice part={part} onPart={onPart} />
        </ToolbarStart>
        <ToolbarEnd>
          {report ? <ToolbarSummary>{fromLabel(report, react.source)}</ToolbarSummary> : null}
          {report && status.stale ? (
            <Badge tone="warning">{t('diagnostics.react.stale')}</Badge>
          ) : null}
          {offers ? (
            <Button
              emphasis="outline"
              disabled={busy || readOnly || status.compiler === 'bad-config'}
              title={
                readOnly
                  ? readOnlyTitle()
                  : status.compiler === 'bad-config'
                    ? (status.configWarning ?? undefined)
                    : t('diagnostics.react.compiler.analyseTitle', { ref })
              }
              onClick={() => void analyse()}
            >
              {busy
                ? t('diagnostics.react.compiler.analysing')
                : t('diagnostics.react.compiler.analyse')}
            </Button>
          ) : null}
        </ToolbarEnd>
      </Toolbar>
      <OffNote react={react} whole={false} />
      {running ? (
        <div className={s.runBar}>
          <Progress
            className={s.grow}
            value={running.total ? (running.done / running.total) * 100 : 0}
            label={t('diagnostics.react.compiler.progressLabel')}
          />
          <span className={s.micro}>
            {t('diagnostics.react.compiler.progress', {
              done: running.done,
              total: running.total,
              count: running.total,
            })}
          </span>
          {offersRuns(data) ? (
            <Button
              size="sm"
              emphasis="outline"
              disabled={readOnly}
              title={readOnly ? readOnlyTitle() : t('diagnostics.react.skipTitle')}
              onClick={() => void skipReact().catch((e: Error) => alert(e.message))}
            >
              {t('diagnostics.react.skip')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <RunNotes react={react} failed={failed} />
      {skippedAt && !running ? (
        <span className={s.muted}>
          {t('diagnostics.react.compiler.skippedNote', {
            time: new Date(skippedAt).toLocaleTimeString(),
          })}
        </span>
      ) : null}
      {report && status.stale ? (
        <span className={s.muted}>
          {t('diagnostics.react.compiler.staleNote', { count: status.stale.files })}
        </span>
      ) : null}
      {noBase ? <p className={s.lede}>{t('diagnostics.react.noBase', { ref })}</p> : null}
      {!report ? (
        off ? null : (
          <div className={s.empty}>{t('diagnostics.react.compiler.none')}</div>
        )
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('diagnostics.react.compiler.title')}</CardTitle>
            {sm ? (
              <CardDescription>
                {t('diagnostics.react.compiler.summary', {
                  files: sm.files,
                  functions: sm.functions,
                  compiled: sm.compiled,
                  skipped: sm.bailouts,
                  optedOut: sm.optedOut,
                  fixed: sm.fixed,
                  time: `${((sm.ms ?? 0) / 1000).toFixed(1)} s`,
                  cached: sm.cached,
                })}
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            <SidePanelLayout>
              <SidePanelMain>
                <div className={s.stack} aria-busy={running ? true : undefined}>
                  <Toolbar size="sm">
                    <ToolbarStart>
                      <Button
                        emphasis={showAll ? 'outline' : 'solid'}
                        disabled={noBase}
                        onClick={() => setAll(false)}
                      >
                        {t('diagnostics.react.compiler.filterAlerts', { count: alerts.length })}
                      </Button>
                      <Button emphasis={showAll ? 'solid' : 'outline'} onClick={() => setAll(true)}>
                        {t('diagnostics.react.compiler.filterAll', { count: fns.length })}
                      </Button>
                    </ToolbarStart>
                  </Toolbar>
                  {shown.length ? (
                    <DataTable
                      rows={shown}
                      rowId={(f) => f.id}
                      search
                      paginate={false}
                      onRowClick={(f) => setPicked(f.id)}
                      columns={[
                        {
                          id: 'function',
                          field: 'name',
                          header: t('diagnostics.react.compiler.columns.function'),
                          cell: (f) => (
                            <span className={s.cellLines}>
                              <strong>
                                {f.name}
                                {f.id === picked ? (
                                  <span className={s.srOnly}>
                                    {t('diagnostics.react.side.selected')}
                                  </span>
                                ) : null}
                              </strong>
                              <ChangeBadge change={f.change} />
                            </span>
                          ),
                        },
                        {
                          id: 'file',
                          header: t('diagnostics.react.compiler.columns.file'),
                          cell: (f) => <span className={s.mono}>{pathOf(f)}</span>,
                        },
                        {
                          id: 'before',
                          header: t('diagnostics.react.compiler.columns.before'),
                          cell: (f) => outcomeLabel(f.base?.outcome),
                        },
                        {
                          id: 'now',
                          header: t('diagnostics.react.compiler.columns.now'),
                          cell: (f) => outcomeLabel(f.head?.outcome),
                        },
                        {
                          id: 'rule',
                          header: t('diagnostics.react.compiler.columns.rule'),
                          cell: (f) => {
                            const r = rulesOf(f);
                            return (
                              <span className={s.cellLines}>
                                <span className={s.mono}>{r.rule}</span>
                                {r.others.length ? (
                                  <span className={s.muted}>
                                    {t('diagnostics.react.compiler.otherRules', {
                                      rules: r.others.join(', '),
                                    })}
                                  </span>
                                ) : null}
                              </span>
                            );
                          },
                        },
                        {
                          id: 'line',
                          header: t('diagnostics.react.compiler.columns.line'),
                          align: 'end',
                          cell: (f) => rulesOf(f).line ?? '',
                        },
                        {
                          id: 'entries',
                          header: t('diagnostics.react.compiler.columns.entries'),
                          align: 'end',
                          cell: (f) => entriesOf(pathOf(f))?.entries ?? '',
                        },
                      ]}
                    />
                  ) : (
                    <div className={s.empty}>
                      {t(
                        showAll
                          ? 'diagnostics.react.compiler.noneAnalysed'
                          : 'diagnostics.react.compiler.noAlerts',
                        { ref }
                      )}
                    </div>
                  )}
                </div>
              </SidePanelMain>
              <SidePanel
                key={selected?.id}
                open={!!selected}
                onOpenChange={(o) => (o ? null : setPicked(null))}
                title={selected?.name ?? ''}
                closeLabel={t('diagnostics.react.side.close')}
              >
                {selected && report ? (
                  <CompilerPanel
                    data={data}
                    report={report}
                    fn={selected}
                    file={entriesOf(pathOf(selected))}
                    onOpen={onOpen}
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
