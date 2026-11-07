/**
 * The inspector's React section (side/Side.tsx, after Accessibility, before Files; not in the
 * Storybook panel): the entry's render counts and whether React had settled at capture, its top
 * components, the counts before, and the React Compiler alerts whose file reaches the entry, each
 * opening Diagnostics › React on that function. Alerts only: it decides nothing.
 */
import { Badge, Button, KeyValueItem, KeyValueList } from '@ui';
import { t } from '../../copy';
import type { Data, Row } from '../../data';
import * as s from '../../dashboard.css';
import { sinceLast } from '../../views/react/Renders';
import { ChangeBadge, num, pathOf, rulesOf } from '../../views/react/shared';

/** Top components listed. */
const TOP = 5;

export function ReactSection({
  data,
  row,
  onGo,
}: {
  data: Data;
  row: Row;
  /** Diagnostics › React on a function (`react`, its id). */
  onGo?: (tab: string, filter?: string) => void;
}) {
  const c = row.renders;
  const report = data.react?.report ?? null;
  const reaching = new Set(
    (report?.files ?? []).filter((f) => f.all || f.ids?.includes(row.id)).map((f) => f.path)
  );
  const alerts = (report?.functions ?? []).filter((f) => f.alert && reaching.has(pathOf(f)));
  if (c === undefined && !alerts.length) return null;
  return (
    <section className={s.sideSection}>
      <h3 className={s.sectionTitle}>{t('inspector.sections.react')}</h3>
      {c === null ? <span className={s.small}>{t('inspector.react.notReact')}</span> : null}
      {c ? (
        <>
          <KeyValueList>
            <KeyValueItem label={t('inspector.react.rendersLabel')}>
              {c.build === 'production'
                ? t('inspector.react.rendersProduction', {
                    commits: num(c.mount.commits),
                    rendered: num(c.mount.rendered),
                  })
                : t('inspector.react.renders', {
                    commits: num(c.mount.commits),
                    rendered: num(c.mount.rendered),
                    ms:
                      c.ms != null
                        ? t('diagnostics.react.renders.ms', { ms: c.ms.toFixed(1) })
                        : '—',
                    build: t(`diagnostics.react.renders.build.${c.build}`),
                  })}
            </KeyValueItem>
            {c.interaction ? (
              <KeyValueItem label={t('inspector.react.interaction')}>
                {t('inspector.react.interactionValue', {
                  commits: num(c.interaction.commits),
                  rendered: num(c.interaction.rendered),
                })}
              </KeyValueItem>
            ) : null}
            <KeyValueItem label={t('inspector.react.settled')}>
              {t(c.settled ? 'inspector.react.settledYes' : 'inspector.react.settledNo')}
            </KeyValueItem>
          </KeyValueList>
          {c.settled ? null : (
            <div className={s.sideSection}>
              <h4 className={s.sectionTitle}>{t('inspector.react.alert')}</h4>
              <span className={s.small}>
                {t('diagnostics.react.renders.stillAlert', {
                  id: row.id,
                  commits: c.mount.commits,
                })}
              </span>
            </div>
          )}
          {c.top.slice(0, TOP).map((x) => (
            <span key={x.name} className={s.row}>
              <span className={s.mono}>{x.name}</span>
              <span>{num(x.renders)}</span>
              <Badge tone={x.compiled ? 'neutral' : 'warning'}>
                {t(
                  x.compiled
                    ? 'diagnostics.react.renders.compiledBadge'
                    : 'diagnostics.react.renders.notCompiledBadge'
                )}
              </Badge>
            </span>
          ))}
          {c.prev?.at ? (
            <span className={s.muted}>
              {t('inspector.react.since', {
                time: new Date(c.prev.at).toLocaleTimeString(),
                delta: sinceLast(c),
              })}
            </span>
          ) : null}
        </>
      ) : null}
      {alerts.length && report ? (
        <div className={s.sideSection}>
          <h4 className={s.sectionTitle}>
            {t('inspector.react.compilerAlerts', { count: alerts.length })}
          </h4>
          {alerts.map((f) => {
            const r = rulesOf(f);
            return (
              <div key={f.id} className={s.sideSection}>
                <span className={s.row}>
                  <strong>{f.name}</strong>
                  <ChangeBadge change={f.change} />
                </span>
                <span className={s.small}>
                  {t('inspector.react.alertWhere', {
                    path: pathOf(f),
                    rule: r.rule,
                    line: r.line ?? f.line,
                  })}
                </span>
                {onGo ? (
                  <Button size="sm" emphasis="outline" onClick={() => onGo('react', f.id)}>
                    {t('inspector.react.openInReact')}
                  </Button>
                ) : null}
              </div>
            );
          })}
          <span className={s.muted}>
            {t('inspector.react.from', {
              time: new Date(report.generatedAt).toLocaleTimeString(),
            })}
          </span>
        </div>
      ) : null}
    </section>
  );
}
