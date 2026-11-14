/**
 * The React progress strip: a row at the top of every section while the server analyses (with
 * Skip) or measures renders (with Cancel), then how the run ended until dismissed. It never takes
 * focus, never blocks and never counts down; only a run's start and end are announced. Not drawn
 * in a static report or with nothing to say.
 */
import React from 'react';
import { Alert, AlertDescription, AlertTitle, Button, Progress } from '@ui';
import { t } from '../copy';
import {
  cancelCheck,
  type Data,
  dismissMeasured,
  dismissReact,
  served,
  skipReact,
  useCheckActivity,
  useReactActivity,
} from '../data';
import { useApproving } from '../link';
import * as s from '../dashboard.css';
import { useFailure } from './Failure';

/** The parts of an analysis' result line, the zero ones left out. */
function resultParts(sm: {
  newBailouts: number;
  newFindings: number;
  fixed: number;
  alerts: number;
}) {
  const reason = Math.max(0, sm.alerts - sm.newBailouts - sm.newFindings);
  return [
    sm.newBailouts ? t('app.react.part.newlySkipped', { count: sm.newBailouts }) : null,
    reason ? t('app.react.part.newReason', { count: reason }) : null,
    sm.newFindings ? t('app.react.part.newFinding', { count: sm.newFindings }) : null,
    sm.fixed ? t('app.react.part.fixed', { count: sm.fixed }) : null,
  ].filter(Boolean) as string[];
}

export function ReactStrip({
  data,
  live,
  openReact,
}: {
  data: Data;
  /** Connected to the server: offline, the rows stay as they were and their buttons are disabled. */
  live: boolean;
  /** Diagnostics › React, on a part. */
  openReact: (part: 'compiler' | 'renders') => void;
}) {
  const react = useReactActivity();
  const check = useCheckActivity();
  const approving = useApproving();
  const readOnly = approving?.allowed === false;
  const offline = !live;
  const failure = useFailure();
  const box = React.useRef<HTMLElement>(null);
  const had = React.useRef(false);
  // A focused Skip or Cancel that goes away: focus moves to the line that replaced it, else to
  // the section's heading.
  React.useLayoutEffect(() => {
    const el = box.current;
    if (had.current && document.activeElement === document.body)
      (
        el?.querySelector<HTMLElement>('button') ?? document.getElementById('section-title')
      )?.focus();
    had.current = !!el && el.contains(document.activeElement);
  });
  if (!served || data.static || !data.react) return null;

  const measuring = !!check.running && check.renders;
  const done = react.ended?.state === 'done' ? react.ended.summary : null;
  const parts = done ? resultParts(done) : [];
  const m = check.measured;
  const still = m
    ? (data.check?.rows ?? []).filter((r) => m.ids.includes(r.id) && r.renders?.settled === false)
        .length
    : 0;
  const rows = [
    react.running ? (
      <div key="react" className={s.runBar}>
        <strong>{t('app.react.analysing')}</strong>
        <Progress
          className={s.grow}
          value={react.running.total ? (react.running.done / react.running.total) * 100 : 0}
          label={t('app.react.progressLabel')}
        />
        <span className={s.micro}>
          {react.running.cached
            ? t('app.react.files', { ...react.running })
            : t('app.react.filesNoCache', { ...react.running })}
        </span>
        <Button
          size="sm"
          emphasis="outline"
          disabled={readOnly || offline}
          title={readOnly ? t('diagnostics.react.readOnlyTitle') : t('app.react.skipTitle')}
          onClick={() =>
            void skipReact().catch((e: Error) => failure.report(e, t('app.react.skip')))
          }
        >
          {t('app.react.skip')}
        </Button>
        {failure.note}
      </div>
    ) : done && parts.length ? (
      <div key="react" className={s.runBar}>
        <span>{t('app.react.result', { parts: parts.join(' · ') })}</span>
        <Button size="sm" emphasis="outline" onClick={() => openReact('compiler')}>
          {t('app.react.open')}
        </Button>
        <Button size="sm" emphasis="ghost" onClick={dismissReact}>
          {t('app.check.dismiss')}
        </Button>
      </div>
    ) : react.ended?.state === 'skipped' ? (
      <div key="react" className={s.runBar}>
        <span>{t('app.react.skipped')}</span>
        <Button size="sm" emphasis="ghost" onClick={dismissReact}>
          {t('app.check.dismiss')}
        </Button>
      </div>
    ) : react.ended?.state === 'error' ? (
      <Alert key="react" tone="neutral" label={t('app.react.failedTitle')}>
        <AlertTitle>{t('app.react.failedTitle')}</AlertTitle>
        <AlertDescription>
          <span className={s.row}>
            <span>{t('app.react.failed', { error: react.ended.error })}</span>
            <Button size="sm" emphasis="ghost" onClick={dismissReact}>
              {t('app.check.dismiss')}
            </Button>
          </span>
        </AlertDescription>
      </Alert>
    ) : null,
    measuring ? (
      <div key="measure" className={s.runBar}>
        <strong>{t('app.react.measuring')}</strong>
        <Progress
          className={s.grow}
          value={check.progress?.total ? (check.progress.done / check.progress.total) * 100 : 0}
          label={t('app.react.measureLabel')}
        />
        <span className={s.micro}>
          {t('app.react.entries', {
            done: check.progress?.done ?? 0,
            total: check.progress?.total ?? check.running?.length ?? 0,
            count: check.progress?.total ?? check.running?.length ?? 0,
          })}
        </span>
        <Button
          size="sm"
          emphasis="outline"
          disabled={readOnly || offline}
          title={readOnly ? t('diagnostics.react.readOnlyTitle') : t('app.react.cancelTitle')}
          onClick={() =>
            void cancelCheck().catch((e: Error) => failure.report(e, t('app.react.cancel')))
          }
        >
          {t('app.react.cancel')}
        </Button>
        {failure.note}
      </div>
    ) : m ? (
      <div key="measure" className={s.runBar}>
        <span>
          {m.cancelled
            ? t('app.react.cancelled', { done: m.done, total: m.total })
            : [
                t('app.react.measured', { count: m.done }),
                ...(still ? [t('app.react.measuredStill', { count: still })] : []),
              ].join(' · ')}
        </span>
        {m.cancelled ? null : (
          <Button size="sm" emphasis="outline" onClick={() => openReact('renders')}>
            {t('app.react.openRenders')}
          </Button>
        )}
        <Button size="sm" emphasis="ghost" onClick={dismissMeasured}>
          {t('app.check.dismiss')}
        </Button>
      </div>
    ) : null,
  ].filter(Boolean);
  if (!rows.length) return null;
  // Announced: a run's start and its end line, never its ticks.
  const said = react.running
    ? t('app.react.analysing')
    : measuring
      ? t('app.react.measuring')
      : done && parts.length
        ? t('app.react.result', { parts: parts.join(' · ') })
        : react.ended?.state === 'skipped'
          ? t('app.react.skipped')
          : m
            ? m.cancelled
              ? t('app.react.cancelled', { done: m.done, total: m.total })
              : t('app.react.measured', { count: m.done })
            : '';
  return (
    <section ref={box} aria-label={t('app.react.region')} className={s.stack}>
      {rows}
      <output className={s.srOnly}>{said}</output>
    </section>
  );
}
