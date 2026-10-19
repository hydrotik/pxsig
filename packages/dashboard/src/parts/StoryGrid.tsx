import React from 'react';
import { Badge, Button } from '@hydrotik/design-system';
import { type Data, type Row, integrityOf, pathsFor, statusOf } from '../data';
import { StatusOf } from './StatusOf';
import * as s from '../dashboard.css';

export function StoryCard({ data, row, scenario, onOpen }: { data: Data; row: Row; scenario: { tag: string; name: string } | null; onOpen(): void }) {
  const p = pathsFor(data, row.id, scenario);
  const m = row.metrics;
  const detailTiles = (row.detail?.changedTiles ?? 0) + (row.detail?.newEdgeTiles ?? 0);
  // Integrity problems the verdict alone does not show (a missing baseline image, a stale verdict…).
  const shown = new Set(['ok', 'drift', 'changed', 'flaky', 'unbaselined', 'render-error', 'excluded']);
  const integrity = scenario ? null : integrityOf(data, row.id);
  const flags = integrity?.issues.filter((i) => !shown.has(i.code)) ?? [];
  return (
    <button type="button" className={s.storyCard} onClick={onOpen} disabled={!m && !(row.new && !row.pending)} aria-label={`${row.id}: ${statusOf(row, data.review)}`}>
      <div className={s.thumb}>
        <img src={p.after} alt="" loading="lazy" decoding="async" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
      </div>
      <div className={s.cardBody}>
        <span className={s.cardId} title={row.id}>
          {row.story ?? row.id}
        </span>
        <span className={s.row}>
          <StatusOf status={scenario ? (row.pass ? 'pass' : 'changed') : statusOf(row, data.review)} />
          {row.mode ? <Badge variant="outline">{row.mode}</Badge> : null}
          {row.state ? <Badge variant="secondary">{row.state}</Badge> : null}
          {row.browser && row.browser !== 'chromium' ? <Badge variant="secondary">{row.browser}</Badge> : null}
          {scenario && row.changed === false ? <Badge variant="secondary">unchanged</Badge> : null}
          {row.a11y?.new ? <Badge variant="destructive">{row.a11y.new} new a11y</Badge> : null}
          {flags.map((i) => (
            <Badge key={i.code} variant={i.severity === 'error' ? 'destructive' : 'secondary'} title={i.reason}>
              {i.code}
            </Badge>
          ))}
        </span>
        {m ? (
          <span className={s.cardStats}>
            <span>ssim {m.ssim}</span>
            <span>cells {m.changedCells}</span>
            {row.detail ? <span>tiles {detailTiles}</span> : null}
          </span>
        ) : row.error ? (
          <span className={s.cardStats}>{row.error}</span>
        ) : row.new ? (
          <span className={s.cardStats}>{row.pending ? 'not rendered yet' : 'no baseline yet: approve its first render'}</span>
        ) : null}
      </div>
    </button>
  );
}

export function StoryGrid({ data, rows, scenario, onOpen, page = 96 }: { data: Data; rows: Row[]; scenario: { tag: string; name: string } | null; onOpen(row: Row, list: Row[]): void; page?: number }) {
  const [shown, setShown] = React.useState(page);
  React.useEffect(() => setShown(page), [rows, page]);
  if (!rows.length) return <div className={s.empty}>No stories match.</div>;
  return (
    <div className={s.stack}>
      <div className={s.cards}>
        {rows.slice(0, shown).map((r) => (
          <StoryCard key={r.id} data={data} row={r} scenario={scenario} onOpen={() => onOpen(r, rows)} />
        ))}
      </div>
      {shown < rows.length ? (
        <div>
          <Button variant="outline" onClick={() => setShown((n) => n + page)}>
            Show more ({rows.length - shown} left)
          </Button>
        </div>
      ) : null}
    </div>
  );
}
