import React from 'react';
import { Badge, Button } from '@hydrotik/design-system';
import { type Data, type Row, componentOf, integrityOf, pathsFor, statusOf } from '../data';
import { StatusOf } from './StatusOf';
import { codeCopy, t } from '../copy';
import * as s from '../dashboard.css';

export function StoryCard({ data, row, scenario, onOpen }: { data: Data; row: Row; scenario: { tag: string; name: string } | null; onOpen(): void }) {
  const p = pathsFor(data, row.id, scenario);
  const m = row.metrics;
  const detailTiles = (row.detail?.changedTiles ?? 0) + (row.detail?.newEdgeTiles ?? 0);
  // Integrity problems the verdict alone does not show (a missing baseline image, a stale verdict…).
  const shown = new Set(['ok', 'drift', 'changed', 'flaky', 'unbaselined', 'render-error', 'excluded']);
  const integrity = scenario ? null : integrityOf(data, row.id);
  const flags = integrity?.issues.filter((i) => !shown.has(i.code)) ?? [];
  const status = scenario ? (row.pass ? 'pass' : 'changed') : statusOf(row, data.review);
  return (
    <button type="button" className={s.storyCard} data-status={status} onClick={onOpen} disabled={!m && !(row.new && !row.pending)} aria-label={`${row.id}: ${t(`status.${statusOf(row, data.review)}`)}`}>
      <div className={s.thumb}>
        <img src={p.after} alt="" loading="lazy" decoding="async" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
      </div>
      <div className={s.cardBody}>
        <span className={s.cardId} title={row.id}>
          {row.story ?? row.id}
        </span>
        <span className={s.row}>
          <StatusOf status={status} />
          {row.mode ? <Badge variant="outline">{row.mode}</Badge> : null}
          {row.state ? <Badge variant="secondary">{row.state}</Badge> : null}
          {row.browser && row.browser !== 'chromium' ? <Badge variant="secondary">{row.browser}</Badge> : null}
          {scenario && row.changed === false ? <Badge variant="secondary">{t('review.card.unchanged')}</Badge> : null}
          {row.a11y?.new ? <Badge variant="destructive">{t('review.card.newA11y', { count: row.a11y.new })}</Badge> : null}
          {flags.map((i) => (
            <Badge key={i.code} variant={i.severity === 'error' ? 'destructive' : 'secondary'} title={i.reason}>
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
          <span className={s.cardStats}>{row.pending ? t('review.card.notRendered') : t('review.card.noBaseline')}</span>
        ) : null}
      </div>
    </button>
  );
}

/** "Changed 3 · New 1": a group's entries counted by status, problems first. */
const ORDER = ['error', 'changed', 'new', 'rejected', 'flaky', 'approved', 'skipped', 'pass'] as const;

export function StoryGrid({ data, rows, scenario, onOpen, page = 96, grouped = false }: { data: Data; rows: Row[]; scenario: { tag: string; name: string } | null; onOpen(row: Row, list: Row[]): void; page?: number; grouped?: boolean }) {
  const [shown, setShown] = React.useState(page);
  React.useEffect(() => setShown(page), [rows, page]);
  if (!rows.length) return <div className={s.empty}>{t('review.none')}</div>;
  const visible = rows.slice(0, shown);
  const card = (r: Row) => <StoryCard key={r.id} data={data} row={r} scenario={scenario} onOpen={() => onOpen(r, rows)} />;
  // Grouped: one section per component, in the order the list first reaches it.
  const groups = new Map<string, Row[]>();
  if (grouped) for (const r of visible) groups.set(componentOf(data, r), [...(groups.get(componentOf(data, r)) ?? []), r]);
  return (
    <div className={s.stack}>
      {grouped ? (
        [...groups].map(([component, rs]) => {
          const counts = ORDER.map((st) => [st, rs.filter((r) => statusOf(r, data.review) === st).length] as const).filter(([, n]) => n);
          return (
            <section key={component} className={s.stack} aria-label={component}>
              <h3 className={s.groupHead}>
                <span>{component}</span>
                <span className={s.muted}>{counts.map(([st, n]) => t('review.group.count', { status: t(`status.${st}`), count: n })).join(' · ')}</span>
              </h3>
              <div className={s.cards}>{rs.map(card)}</div>
            </section>
          );
        })
      ) : (
        <div className={s.cards}>{visible.map(card)}</div>
      )}
      {shown < rows.length ? (
        <div>
          <Button variant="outline" onClick={() => setShown((n) => n + page)}>
            {t('review.showMore', { count: rows.length - shown })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
