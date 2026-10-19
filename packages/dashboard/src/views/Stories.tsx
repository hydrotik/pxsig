import React from 'react';
import { SearchBar, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Toolbar, ToolbarFormField, ToolbarLeft, ToolbarRight } from '@hydrotik/design-system';
import { type Data, type Row, rowsWithPending, statusOf } from '../data';
import { StoryGrid } from '../parts/StoryGrid';
import * as s from '../dashboard.css';

const FILTERS: [string, string][] = [
  ['all', 'All results'],
  ['todo', 'Needs review'],
  ['changed', 'Changed'],
  ['new', 'New (no baseline)'],
  ['flaky', 'Flaky'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['skipped', 'Unaffected (skipped)'],
  ['drift', 'Any drift (ssim < 1)'],
];

export function Stories({ data, filter, setFilter, onOpen }: { data: Data; filter: string; setFilter(f: string): void; onOpen(row: Row, list: Row[]): void }) {
  const [q, setQ] = React.useState('');
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
    if (filter === 'todo') rs = rs.filter((r) => st(r) === 'changed' || st(r) === 'new' || (st(r) === 'error' && !r.skipped));
    else if (filter === 'drift') rs = rs.filter((r) => r.metrics && r.metrics.ssim < 1);
    else if (filter !== 'all') rs = rs.filter((r) => st(r) === filter);
    const key = (r: Row) => (r.metrics?.ssim ?? 2) - (r.detail ? (r.detail.changedTiles + r.detail.newEdgeTiles) / 1000 : 0);
    return [...rs].sort(sort === 'id' ? (a, b) => a.id.localeCompare(b.id) : sort === 'render' ? (a, b) => (b.renderMs ?? 0) - (a.renderMs ?? 0) : (a, b) => key(a) - key(b));
  }, [all, q, mode, filter, sort, data.review]);
  if (!check) return <div className={s.empty}>Run `pxsig check --full` to populate this view.</div>;
  // No bulk approve: it accepted every changed entry in the suite (ignoring this view's filters)
  // behind one confirm(). Approve per entry in the inspector (A), where the images are on screen.
  return (
    <div className={s.stack}>
      <Toolbar>
        <ToolbarLeft>
          <ToolbarFormField label="Story" minInlineSize="14rem" flexGrow={1}>
            <SearchBar value={q} onValueChange={setQ} placeholder="Filter by story id…" />
          </ToolbarFormField>
          <ToolbarFormField label="Result" minInlineSize="11rem">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILTERS.map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ToolbarFormField>
          <ToolbarFormField label="Mode" minInlineSize="8rem">
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All modes</SelectItem>
                {modes.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ToolbarFormField>
          <ToolbarFormField label="Sort" minInlineSize="10rem">
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="worst">Worst first</SelectItem>
                <SelectItem value="id">Story id</SelectItem>
                <SelectItem value="render">Slowest render</SelectItem>
              </SelectContent>
            </Select>
          </ToolbarFormField>
        </ToolbarLeft>
        <ToolbarRight>
          <span className={s.muted}>
            {rows.length} of {all.length}
          </span>
        </ToolbarRight>
      </Toolbar>
      <StoryGrid data={data} rows={rows} scenario={null} onOpen={onOpen} />
    </div>
  );
}
