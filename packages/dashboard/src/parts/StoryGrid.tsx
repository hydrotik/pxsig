import React from 'react';
import { Badge, Button } from '@ui';
import {
  type Data,
  type Row,
  componentOf,
  integrityOf,
  pathsFor,
  recheck,
  served,
  statusOf,
  useCheckActivity,
} from '../data';
import { StatusOf } from './StatusOf';
import { Affordance } from './Affordance';
import { codeCopy, t } from '../copy';
import * as s from '../dashboard.css';

export function StoryCard({
  data,
  row,
  scenario,
  onOpen,
}: {
  data: Data;
  row: Row;
  scenario: { tag: string; name: string } | null;
  onOpen(): void;
}) {
  const p = pathsFor(data, row.id, scenario);
  const m = row.metrics;
  const detailTiles = (row.detail?.changedTiles ?? 0) + (row.detail?.newEdgeTiles ?? 0);
  // Integrity problems the verdict alone does not show (a missing baseline image, a stale verdict…).
  const shown = new Set([
    'ok',
    'drift',
    'changed',
    'flaky',
    'unbaselined',
    'render-error',
    'excluded',
  ]);
  const integrity = scenario ? null : integrityOf(data, row.id);
  const flags = integrity?.issues.filter((i) => !shown.has(i.code)) ?? [];
  const status = scenario ? (row.pass ? 'pass' : 'changed') : statusOf(row, data.review);
  const openable = !!m || (!!row.new && !row.pending);
  // A render error or a NEW entry not rendered yet has nothing to inspect: the card offers a
  // re-check instead (a button in the card, so the card itself is not one).
  const offerRecheck = served && !scenario && !openable && (!!row.error || !!row.pending);
  const activity = useCheckActivity();
  const [queued, setQueued] = React.useState(false);
  React.useEffect(() => setQueued(false), [row]);
  const checking = queued || !!activity.running?.includes(row.id);
  const Card = offerRecheck ? 'div' : 'button';
  return (
    <Card
      {...(offerRecheck
        ? { role: 'group', 'aria-label': row.id }
        : { type: 'button' as const, onClick: onOpen, disabled: !openable })}
      className={offerRecheck ? `${s.storyCard} ${s.storyCardStatic}` : s.storyCard}
      data-status={status}
    >
      {m || (row.new && !row.pending) ? <Affordance kind="navigate" /> : null}
      <div className={s.thumb}>
        <img
          src={p.after}
          alt=""
          loading="lazy"
          decoding="async"
          onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')}
        />
      </div>
      <div className={s.cardBody}>
        <span className={s.cardId} title={row.id}>
          {row.story ?? row.id}
        </span>
        <span className={s.row}>
          <StatusOf status={status} />
          {row.mode ? <Badge emphasis="outline">{row.mode}</Badge> : null}
          {row.state ? <Badge>{row.state}</Badge> : null}
          {row.browser && row.browser !== 'chromium' ? <Badge>{row.browser}</Badge> : null}
          {scenario && row.changed === false ? <Badge>{t('review.card.unchanged')}</Badge> : null}
          {data.a11yReview?.[row.id] ? (
            <Badge tone={data.a11yReview[row.id].state === 'accepted' ? 'neutral' : 'danger'}>
              {t(
                data.a11yReview[row.id].state === 'accepted'
                  ? 'review.card.a11yAccepted'
                  : 'review.card.a11yRejected'
              )}
            </Badge>
          ) : row.a11y?.new ? (
            <Badge tone="danger">{t('review.card.newA11y', { count: row.a11y.new })}</Badge>
          ) : null}
          {flags.map((i) => (
            <Badge
              key={i.code}
              tone={i.severity === 'error' ? 'danger' : 'neutral'}
              title={i.reason}
            >
              {codeCopy(i.code).title}
            </Badge>
          ))}
        </span>
        {m ? (
          <span className={s.cardStats}>
            <span>{t('review.card.ssim', { value: m.ssim })}</span>
            <span>{t('review.card.cells', { value: m.changedCells })}</span>
            {row.detail ? <span>{t('review.card.tiles', { value: detailTiles })}</span> : null}
          </span>
        ) : row.error ? (
          <span className={s.cardStats}>{row.error}</span>
        ) : row.new ? (
          <span className={s.cardStats}>
            {row.pending ? t('review.card.notRendered') : t('review.card.noBaseline')}
          </span>
        ) : null}
        {offerRecheck ? (
          <span className={s.row}>
            <Button
              size="sm"
              emphasis="outline"
              disabled={checking}
              title={t('review.card.recheckTitle')}
              onClick={() =>
                recheck([row.id])
                  .then(() => setQueued(true))
                  .catch((e) =>
                    alert(
                      t('inspector.review.failed', {
                        action: t('review.card.recheck'),
                        error: (e as Error).message,
                      })
                    )
                  )
              }
            >
              {checking ? t('app.check.running', { count: 1 }) : t('review.card.recheck')}
            </Button>
          </span>
        ) : null}
      </div>
    </Card>
  );
}

/** "Changed 3 · New 1": a group's entries counted by status, problems first. */
const ORDER = [
  'error',
  'changed',
  'new',
  'rejected',
  'flaky',
  'approved',
  'skipped',
  'pass',
] as const;

export function StoryGrid({
  data,
  rows,
  scenario,
  onOpen,
  page = 96,
  grouped = false,
}: {
  data: Data;
  rows: Row[];
  scenario: { tag: string; name: string } | null;
  onOpen(row: Row, list: Row[]): void;
  page?: number;
  grouped?: boolean;
}) {
  const [shown, setShown] = React.useState(page);
  React.useEffect(() => setShown(page), [rows, page]);
  if (!rows.length) return <div className={s.empty}>{t('review.none')}</div>;
  const visible = rows.slice(0, shown);
  const card = (r: Row) => (
    <StoryCard key={r.id} data={data} row={r} scenario={scenario} onOpen={() => onOpen(r, rows)} />
  );
  // Grouped: one section per component, in the order the list first reaches it.
  const groups = new Map<string, Row[]>();
  if (grouped)
    for (const r of visible)
      groups.set(componentOf(data, r), [...(groups.get(componentOf(data, r)) ?? []), r]);
  return (
    <div className={s.stack}>
      {grouped ? (
        <div className={s.groups}>
          {[...groups].map(([component, rs]) => {
            const counts = ORDER.map(
              (st) => [st, rs.filter((r) => statusOf(r, data.review) === st).length] as const
            ).filter(([, n]) => n);
            return (
              <section key={component} className={s.groupBand} aria-label={component}>
                <h3 className={s.groupHead}>
                  <span>{component}</span>
                  <span className={s.muted}>
                    {counts
                      .map(([st, n]) =>
                        t('review.group.count', { status: t(`status.${st}`), count: n })
                      )
                      .join(' · ')}
                  </span>
                </h3>
                <div className={s.cards}>{rs.map(card)}</div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className={s.cards}>{visible.map(card)}</div>
      )}
      {shown < rows.length ? (
        <div>
          <Button emphasis="outline" onClick={() => setShown((n) => n + page)}>
            {t('review.showMore', { count: rows.length - shown })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
