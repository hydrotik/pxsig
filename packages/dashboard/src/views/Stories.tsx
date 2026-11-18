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
import { type Data, type Row, drifts, rowsWithPending, statusOf } from '../data';
import { masksLarge } from '../inspector/masks';
import { StoryGrid } from '../parts/StoryGrid';
import { Cmd, t, tx } from '../copy';
import * as s from '../dashboard.css';

const FILTERS = [
  'all',
  'todo',
  'changed',
  'new',
  'error',
  'blocked',
  'flaky',
  'approved',
  'rejected',
  'skipped',
  'drift',
  'masks',
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
  // The list follows the search and the choices a moment later, so typing in a large store
  // does not wait for the list (the controls show the new values at once).
  const shownQ = React.useDeferredValue(q);
  const shownMode = React.useDeferredValue(mode);
  const shownFilter = React.useDeferredValue(filter);
  const shownSort = React.useDeferredValue(sort);
  const check = data.check;
  const all = React.useMemo(() => rowsWithPending(data), [data]);
  const modes = [...new Set(all.map((r) => r.mode))];
  const rows = React.useMemo(() => {
    const needle = shownQ.trim().toLowerCase();
    let rs = all.filter((r) => !needle || r.id.includes(needle));
    if (shownMode !== 'all') rs = rs.filter((r) => r.mode === shownMode);
    const st = (r: Row) => statusOf(r, data.review);
    if (shownFilter === 'todo')
      rs = rs.filter(
        (r) => st(r) === 'changed' || st(r) === 'new' || (st(r) === 'error' && !r.skipped)
      );
    else if (shownFilter === 'drift') rs = rs.filter(drifts);
    else if (shownFilter === 'masks') rs = rs.filter(masksLarge);
    else if (shownFilter !== 'all') rs = rs.filter((r) => st(r) === shownFilter);
    const key = (r: Row) =>
      (r.metrics?.ssim ?? 2) -
      (r.detail ? (r.detail.changedTiles + r.detail.newEdgeTiles) / 1000 : 0);
    return [...rs].sort(
      shownSort === 'id'
        ? (a, b) => a.id.localeCompare(b.id)
        : shownSort === 'render'
          ? (a, b) => (b.renderMs ?? 0) - (a.renderMs ?? 0)
          : (a, b) => key(a) - key(b)
    );
  }, [all, shownQ, shownMode, shownFilter, shownSort, data.review]);
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
