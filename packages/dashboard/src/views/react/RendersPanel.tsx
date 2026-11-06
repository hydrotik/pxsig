/**
 * The side panel of Diagnostics › React › Renders: one entry's counts (mount, interaction), the
 * still-rendering alert, its top components, the counts before (since the last check in this
 * store, information only) and the build; it opens the entry in the inspector or measures it alone.
 */
import { Badge, Button, KeyValueItem, KeyValueList } from '@ui';
import { t } from '../../copy';
import type { RenderCounts, Row } from '../../data';
import * as s from '../../dashboard.css';
import { num } from './shared';

const phase = (p: RenderCounts['mount'], ms?: number) => (
  <KeyValueList>
    <KeyValueItem label={t('diagnostics.react.renders.side.commits')}>
      {num(p.commits)}
    </KeyValueItem>
    <KeyValueItem label={t('diagnostics.react.renders.side.rendered')}>
      {num(p.rendered)}
    </KeyValueItem>
    {p.mounted !== undefined ? (
      <KeyValueItem label={t('diagnostics.react.renders.side.mounted')}>
        {num(p.mounted)}
      </KeyValueItem>
    ) : null}
    {ms != null ? (
      <KeyValueItem label={t('diagnostics.react.renders.side.time')}>
        {t('diagnostics.react.renders.ms', { ms: ms.toFixed(1) })}
      </KeyValueItem>
    ) : null}
  </KeyValueList>
);

export function RendersPanel({
  row,
  canMeasure,
  onMeasure,
  onOpen,
}: {
  row: Row;
  canMeasure: boolean;
  onMeasure: () => void;
  onOpen: () => void;
}) {
  const c = row.renders ?? null;
  return (
    <div className={s.stack}>
      {c && !c.settled ? (
        <section className={s.sideSection}>
          <h4 className={s.sectionTitle}>{t('diagnostics.react.side.alert')}</h4>
          <span className={s.small}>
            {t('diagnostics.react.renders.stillAlert', { id: row.id, commits: c.mount.commits })}
          </span>
        </section>
      ) : null}
      {c ? (
        <>
          <section className={s.sideSection}>
            {c.at ? (
              <span className={s.muted}>
                {t('diagnostics.react.renders.side.measuredAt', {
                  time: new Date(c.at).toLocaleString(),
                })}
              </span>
            ) : null}
            <span className={s.small}>
              {t(
                c.settled
                  ? 'diagnostics.react.renders.side.settled'
                  : 'diagnostics.react.renders.side.notSettled'
              )}
            </span>
            {c.mount.rendered == null ? (
              <span className={s.muted}>{t('diagnostics.react.renders.side.budget')}</span>
            ) : null}
          </section>
          <section className={s.sideSection}>
            <h4 className={s.sectionTitle}>{t('diagnostics.react.renders.side.mount')}</h4>
            {phase(c.mount, c.interaction ? undefined : c.ms)}
          </section>
          {c.interaction ? (
            <section className={s.sideSection}>
              <h4 className={s.sectionTitle}>{t('diagnostics.react.renders.side.interaction')}</h4>
              {phase(c.interaction, c.ms)}
            </section>
          ) : null}
          {c.top.length ? (
            <section className={s.sideSection}>
              <h4 className={s.sectionTitle}>{t('diagnostics.react.renders.side.topTitle')}</h4>
              {c.top.map((x) => (
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
            </section>
          ) : null}
          {c.prev ? (
            <section className={s.sideSection}>
              <h4 className={s.sectionTitle}>{t('diagnostics.react.renders.side.sinceTitle')}</h4>
              <KeyValueList>
                <KeyValueItem label={t('diagnostics.react.renders.side.sinceCommits')}>
                  {t('diagnostics.react.renders.side.sinceValue', {
                    before: c.prev.commits,
                    now: c.mount.commits,
                  })}
                </KeyValueItem>
                <KeyValueItem label={t('diagnostics.react.renders.side.sinceRendered')}>
                  {t('diagnostics.react.renders.side.sinceValue', {
                    before: c.prev.rendered ?? '—',
                    now: c.mount.rendered ?? '—',
                  })}
                </KeyValueItem>
              </KeyValueList>
              {c.prev.at ? (
                <span className={s.muted}>
                  {t('diagnostics.react.renders.side.sinceAt', {
                    time: new Date(c.prev.at).toLocaleString(),
                  })}
                </span>
              ) : null}
            </section>
          ) : null}
          <section className={s.sideSection}>
            <h4 className={s.sectionTitle}>{t('diagnostics.react.renders.side.build')}</h4>
            <span className={s.small}>
              {t('diagnostics.react.renders.side.buildValue', {
                build: t(`diagnostics.react.renders.build.${c.build}`),
                version: c.react ?? '—',
              })}
            </span>
          </section>
        </>
      ) : (
        <span className={s.small}>{t('diagnostics.react.renders.notReact')}</span>
      )}
      <span className={s.row}>
        <Button size="sm" emphasis="outline" onClick={onOpen}>
          {t('diagnostics.react.renders.side.open')}
        </Button>
        {canMeasure ? (
          <Button size="sm" emphasis="outline" onClick={onMeasure}>
            {t('diagnostics.react.renders.side.measureOne')}
          </Button>
        ) : null}
      </span>
    </div>
  );
}
