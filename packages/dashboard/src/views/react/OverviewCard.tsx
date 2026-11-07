/**
 * The Overview's React card (end column, after Errors): the compiler analysis and the render
 * counts in four figures, each opening the React view where it is listed. Alerts only, not
 * blocking; shown only when there is something to show (a report, or rows with render counts).
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle, StatGroup } from '@ui';
import { t } from '../../copy';
import { type Data, useReactActivity } from '../../data';
import { Affordance } from '../../parts/Affordance';
import * as s from '../../dashboard.css';

/** Diagnostics › React on a part, with its Alerts filter or every row. */
export type OpenReact = (part: 'compiler' | 'renders', all?: boolean) => void;

const when = (iso: string) => new Date(iso).toLocaleString();
/**
 * A tile's figure, then a space: the figure and its unit are separate elements, and without it the
 * tile's name runs them together ("1new · of 1").
 */
const figure = (v: number | string) => `${v} `;

export function ReactCard({ data, openReact }: { data: Data; openReact: OpenReact }) {
  const activity = useReactActivity();
  const react = data.react;
  if (!react || react.status.off?.key === 'react') return null;
  const report = react.report;
  const measured = (data.check?.rows ?? []).filter((r) => !r.skipped && r.renders !== undefined);
  if (!report && !measured.length) return null;
  const status = react.status;
  const noCompiler = status.compiler === 'off' || status.compiler === 'not-installed';
  const away = noCompiler
    ? t(status.compiler === 'off' ? 'overview.react.compilerOff' : 'overview.react.notInstalled')
    : null;
  const sm = !noCompiler ? report?.summary : undefined;
  const reasons = sm ? Math.max(0, sm.alerts - sm.newBailouts - sm.newFindings) : 0;
  const still = measured.filter((r) => r.renders?.settled === false).length;
  const from = report
    ? report.base
      ? t(react.source === 'check' ? 'overview.react.fromCheck' : 'overview.react.fromAnalysis', {
          date: when(report.generatedAt),
          ref: report.base.since,
          commit: report.base.commit,
        })
      : t('overview.react.noBase', { date: when(report.generatedAt) })
    : '';
  const stale = status.stale ? t('overview.react.stale', { count: status.stale.files }) : '';
  const nav = <Affordance kind="navigate" />;
  return (
    <div aria-busy={!!activity.running || status.compiler === 'running' || undefined}>
      <Card>
        <CardHeader>
          <CardTitle>{t('overview.react.title')}</CardTitle>
          <CardDescription>
            {t('overview.react.description', { from: `${from}${stale}` })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className={s.stack}>
            {activity.running ? (
              <span className={s.micro}>
                {t(activity.running.cached ? 'app.react.files' : 'app.react.filesNoCache', {
                  ...activity.running,
                })}
              </span>
            ) : null}
            {/* Tiles, as the Overview's top row: the reference adapter's strip draws a selectable
                item's corner glyph outside its frame. */}
            <StatGroup
              className={s.statCards}
              label={t('overview.react.label')}
              items={[
                {
                  label: t('overview.react.newlySkipped'),
                  value: figure(sm ? sm.newBailouts : '—'),
                  unit:
                    away ??
                    (reasons ? t('overview.react.newReason', { count: reasons }) : undefined),
                  tone: sm?.newBailouts ? 'warning' : undefined,
                  ...(sm ? { onSelect: () => openReact('compiler', false), icon: nav } : {}),
                },
                {
                  label: t('overview.react.findings'),
                  value: figure(sm ? sm.newFindings : '—'),
                  unit:
                    away ??
                    (sm ? t('overview.react.findingsOf', { count: sm.findings }) : undefined),
                  tone: sm?.newFindings ? 'warning' : undefined,
                  ...(sm ? { onSelect: () => openReact('compiler', false), icon: nav } : {}),
                },
                {
                  label: t('overview.react.compiled'),
                  value: figure(sm ? sm.compiled : '—'),
                  unit:
                    away ??
                    (sm ? t('overview.react.compiledOf', { count: sm.functions }) : undefined),
                  ...(sm ? { onSelect: () => openReact('compiler', true), icon: nav } : {}),
                },
                {
                  label: t('overview.react.still'),
                  value: figure(measured.length ? still : '—'),
                  unit: measured.length
                    ? t('overview.react.stillOf', { count: measured.length })
                    : t('overview.react.notMeasured'),
                  tone: still ? 'warning' : undefined,
                  ...(measured.length
                    ? { onSelect: () => openReact('renders', !still), icon: nav }
                    : {}),
                },
              ]}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
