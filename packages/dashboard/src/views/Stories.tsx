import React from 'react';
import {
  SearchField,
  Select,
  Toolbar,
  ToolbarEnd,
  ToolbarField,
  ToolbarStart,
  ToolbarSummary,
} from '@ui';
import { type Data, type Row, rowsWithPending, statusOf } from '../data';
import { StoryGrid } from '../parts/StoryGrid';
import { Cmd, t, tx } from '../copy';
import * as s from '../dashboard.css';

const FILTERS = [
  'all',
  'todo',
  'changed',
  'new',
  'error',
  'flaky',
  'approved',
  'rejected',
  'skipped',
  'drift',
] as const;

export function Stories({
  data,
  filter,
  setFilter,
  onOpen,
}: {
  data: Data;
  filter: string;
  setFilter: (f: string) => void;
  onOpen: (row: Row, list: Row[]) => void;
}) {
  const [q, setQ] = React.useState('');
  const [grouped, setGrouped] = React.useState(true);
  const [mode, setMode] = React.useState('all');
  const [sort, setSort] = React.useState('worst');
  const check = data.check;
  const all = React.useMemo(() => rowsWithPending(data), [data]);
  const modes = [...new Set(all.map((r) => r.mode))];
  const rows = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    let rs = all.filter((r) => !needle || r.id.includes(needle));
    if (mode !== 'all') rs = rs.filter((r) => r.mode === mode);
    const st = (r: Row) => statusOf(r, data.review);
    if (filter === 'todo')
      rs = rs.filter(
        (r) => st(r) === 'changed' || st(r) === 'new' || (st(r) === 'error' && !r.skipped)
      );
    else if (filter === 'drift') rs = rs.filter((r) => r.metrics && r.metrics.ssim < 1);
    else if (filter !== 'all') rs = rs.filter((r) => st(r) === filter);
    const key = (r: Row) =>
      (r.metrics?.ssim ?? 2) -
      (r.detail ? (r.detail.changedTiles + r.detail.newEdgeTiles) / 1000 : 0);
    return [...rs].sort(
      sort === 'id'
        ? (a, b) => a.id.localeCompare(b.id)
        : sort === 'render'
          ? (a, b) => (b.renderMs ?? 0) - (a.renderMs ?? 0)
          : (a, b) => key(a) - key(b)
    );
  }, [all, q, mode, filter, sort, data.review]);
  if (!check)
    return (
      <div className={s.empty}>
        {tx('empty.noCheck', { command: <Cmd>pxsig check --full</Cmd> })}
      </div>
    );
  // No bulk approve: it accepted every changed entry in the suite (ignoring this view's filters)
  // behind one confirm(). Approve per entry in the inspector (A), where the images are on screen.
  return (
    <div className={s.stack}>
      <Toolbar size="sm">
        <ToolbarStart>
          <ToolbarField label={t('review.fields.story')} minInlineSize="14rem" grow>
            <SearchField value={q} onValueChange={setQ} placeholder={t('review.search')} />
          </ToolbarField>
          <ToolbarField label={t('review.fields.result')} minInlineSize="11rem">
            <Select
              value={filter}
              onValueChange={setFilter}
              options={FILTERS.map((v) => ({ value: v, label: t(`review.filters.${v}`) }))}
            />
          </ToolbarField>
          <ToolbarField label={t('review.fields.mode')} minInlineSize="8rem">
            <Select
              value={mode}
              onValueChange={setMode}
              options={[
                { value: 'all', label: t('review.allModes') },
                ...modes.map((m) => ({ value: m, label: m })),
              ]}
            />
          </ToolbarField>
          <ToolbarField label={t('review.fields.sort')} minInlineSize="10rem">
            <Select
              value={sort}
              onValueChange={setSort}
              options={[
                { value: 'worst', label: t('review.sort.worst') },
                { value: 'id', label: t('review.sort.id') },
                { value: 'render', label: t('review.sort.render') },
              ]}
            />
          </ToolbarField>
          <ToolbarField label={t('review.group.label')} minInlineSize="10rem">
            <Select
              value={grouped ? 'component' : 'none'}
              onValueChange={(v) => setGrouped(v === 'component')}
              options={[
                { value: 'component', label: t('review.group.component') },
                { value: 'none', label: t('review.group.none') },
              ]}
            />
          </ToolbarField>
        </ToolbarStart>
        <ToolbarEnd>
          <ToolbarSummary live>
            {t('review.count', { shown: rows.length, total: all.length })}
          </ToolbarSummary>
        </ToolbarEnd>
      </Toolbar>
      <StoryGrid data={data} rows={rows} scenario={null} onOpen={onOpen} grouped={grouped} />
    </div>
  );
}
