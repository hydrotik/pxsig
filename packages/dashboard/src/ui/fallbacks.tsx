/**
 * Plain renderings for the optional contract components an adapter does not supply. They are
 * semantic HTML styled only with the neutral tokens: correct and accessible, not designed. The
 * conformance report lists every component that renders this way.
 */
import React from 'react';
import type { DataTableProps } from './contract';
import { tokens as v } from './tokens';
import { t } from '../copy';
import { border, type Cell, control, type F } from './fallbacks/base';
import { Chart, Heatmap } from './fallbacks/charts';

const UiProvider: F<'UiProvider'> = ({ mode, children }) => {
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
    document.documentElement.style.colorScheme = mode;
  }, [mode]);
  return <>{children}</>;
};

const AppShell: F<'AppShell'> = ({ children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', blockSize: '100%' }}>{children}</div>
);

const AppMain: F<'AppMain'> = ({ ref, children }) => (
  <main ref={ref} style={{ flex: 1, minBlockSize: 0, overflow: 'auto' }}>
    {children}
  </main>
);

const NavEnd: F<'NavEnd'> = ({ className, children }) => (
  <div className={className}>{children}</div>
);

const StatGroup: F<'StatGroup'> = ({ label, items, className }) => (
  <section
    aria-label={label}
    className={className}
    style={{ display: 'flex', flexWrap: 'wrap', gap: v.space['3'] }}
  >
    {items.map((it, i) => {
      const body = (
        <>
          <span
            style={{
              display: 'block',
              fontSize: v.fontSize['2xs'],
              color: v.color.textMuted,
              textTransform: 'uppercase',
              letterSpacing: v.letterSpacing.caps,
            }}
          >
            {it.label}
          </span>
          <span
            style={{
              fontSize: v.fontSize.lg,
              fontWeight: v.fontWeight.semibold,
              color:
                it.tone && it.tone !== 'neutral'
                  ? v.color[it.tone === 'info' ? 'accent' : it.tone]
                  : undefined,
            }}
          >
            {it.value}
            {it.unit != null ? (
              <small
                style={{
                  marginInlineStart: v.space['1'],
                  fontSize: v.fontSize.xs,
                  color: v.color.textMuted,
                }}
              >
                {it.unit}
              </small>
            ) : null}
          </span>
          {it.icon}
        </>
      );
      const box: React.CSSProperties = {
        position: 'relative',
        textAlign: 'start',
        flex: '1 1 10rem',
        padding: v.space['3'],
        border,
        borderRadius: v.radius.lg,
        background: v.color.surface,
        color: v.color.text,
        font: 'inherit',
      };
      return it.onSelect ? (
        <button
          key={i}
          type="button"
          style={{ ...box, cursor: 'pointer' }}
          aria-pressed={it.active}
          onClick={it.onSelect}
        >
          {body}
        </button>
      ) : (
        <div key={i} style={box}>
          {body}
        </div>
      );
    })}
  </section>
);

function DataTableFallback<T>({
  rows,
  rowId,
  columns,
  onRowClick,
  search,
  paginate,
}: DataTableProps<T>) {
  const [q, setQ] = React.useState('');
  const [sort, setSort] = React.useState<{ id: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = React.useState(0);
  const size = paginate === false ? Infinity : 50;
  // A column's field names a primitive value of the row (contract: DataTable columns).
  const text = (r: T, field?: string) =>
    field ? String((r as Record<string, Cell>)[field] ?? '') : '';
  let shown = q
    ? rows.filter((r) =>
        columns.some((c) => text(r, c.field).toLowerCase().includes(q.toLowerCase()))
      )
    : rows;
  const col = sort && columns.find((c) => c.id === sort.id);
  if (col?.field) {
    const f = col.field;
    shown = [...shown].sort((a, b) => {
      const x = (a as Record<string, unknown>)[f] as never;
      const y = (b as Record<string, unknown>)[f] as never;
      return (x < y ? -1 : x > y ? 1 : 0) * sort!.dir;
    });
  }
  const pages = Math.max(1, Math.ceil(shown.length / size));
  const visible = size === Infinity ? shown : shown.slice(page * size, page * size + size);
  const cellStyle = (align?: string): React.CSSProperties => ({
    textAlign: align === 'end' ? 'end' : 'start',
    paddingBlock: v.space['1_5'],
    paddingInline: v.space['2'],
    borderBlockEnd: border,
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: v.space['2'], overflowX: 'auto' }}>
      {search ? (
        <input
          type="search"
          aria-label={t('ui.fallback.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ ...control, maxInlineSize: '20rem' }}
        />
      ) : null}
      <table style={{ borderCollapse: 'collapse', inlineSize: '100%', fontSize: v.fontSize.sm }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.id}
                scope="col"
                style={{
                  ...cellStyle(c.align),
                  inlineSize: c.width,
                  color: v.color.textMuted,
                  fontWeight: v.fontWeight.semibold,
                }}
                aria-sort={
                  sort?.id === c.id ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined
                }
              >
                {c.field ? (
                  <button
                    type="button"
                    onClick={() =>
                      setSort(
                        sort?.id === c.id
                          ? { id: c.id, dir: sort.dir === 1 ? -1 : 1 }
                          : { id: c.id, dir: 1 }
                      )
                    }
                    style={{ all: 'unset', cursor: 'pointer' }}
                  >
                    {c.header}
                  </button>
                ) : (
                  c.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr
              key={rowId(r)}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) =>
                      (e.key === 'Enter' || e.key === ' ') &&
                      e.target === e.currentTarget &&
                      (e.preventDefault(), onRowClick(r))
                  : undefined
              }
              style={{ cursor: onRowClick ? 'pointer' : undefined }}
            >
              {columns.map((c) => (
                <td key={c.id} style={cellStyle(c.align)}>
                  {c.cell ? c.cell(r) : text(r, c.field)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {pages > 1 ? (
        <span
          style={{
            display: 'flex',
            gap: v.space['2'],
            alignItems: 'center',
            fontSize: v.fontSize.xs,
          }}
        >
          <button
            type="button"
            style={control}
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
            aria-label={t('ui.fallback.previousPage')}
          >
            ‹
          </button>
          {t('ui.fallback.page', { page: page + 1, pages })}
          <button
            type="button"
            style={control}
            disabled={page >= pages - 1}
            onClick={() => setPage(page + 1)}
            aria-label={t('ui.fallback.nextPage')}
          >
            ›
          </button>
        </span>
      ) : null}
    </div>
  );
}

const Slider: F<'Slider'> = ({
  label,
  value,
  onValueChange,
  min = 0,
  max,
  step = 1,
  formatValue = String,
  className,
}) => {
  const id = React.useId();
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: v.space['2'],
        fontSize: v.fontSize.xs,
      }}
    >
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onValueChange(Number(e.target.value))}
        style={{ flex: 1, minInlineSize: 0, accentColor: v.color.accent }}
      />
      <output htmlFor={id}>{formatValue(value)}</output>
    </span>
  );
};

const Switch: F<'Switch'> = ({ checked, onCheckedChange, label }) => (
  <input
    type="checkbox"
    role="switch"
    aria-label={label}
    checked={checked}
    onChange={(e) => onCheckedChange(e.target.checked)}
    style={{ accentColor: v.color.accent }}
  />
);

const SegmentedChoice: F<'SegmentedChoice'> = ({ label, value, onValueChange, options }) => (
  <div
    role="group"
    aria-label={label}
    style={{ display: 'inline-flex', border, borderRadius: v.radius.md, overflow: 'hidden' }}
  >
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        aria-pressed={o.value === value}
        aria-label={o.accessibleLabel}
        title={o.title}
        onClick={() => o.value !== value && onValueChange(o.value)}
        style={{
          ...control,
          border: 'none',
          borderRadius: 0,
          background: o.value === value ? v.color.accent : v.color.surface,
          color: o.value === value ? v.color.background : v.color.text,
          cursor: 'pointer',
        }}
      >
        {o.label}
      </button>
    ))}
  </div>
);

const row: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-end',
  gap: v.space['2'],
};
const Toolbar: F<'Toolbar'> = ({ className, children }) => (
  <div role="toolbar" className={className} style={{ ...row, justifyContent: 'space-between' }}>
    {children}
  </div>
);
const ToolbarStart: F<'ToolbarStart'> = ({ children }) => <div style={row}>{children}</div>;
const ToolbarEnd: F<'ToolbarEnd'> = ({ children }) => (
  <div style={{ ...row, marginInlineStart: 'auto' }}>{children}</div>
);
const ToolbarField: F<'ToolbarField'> = ({ label, minInlineSize, grow, children }) => (
  <label
    style={{
      display: 'flex',
      flexDirection: 'column',
      gap: v.space['1'],
      minInlineSize,
      flexGrow: grow ? 1 : undefined,
      fontSize: v.fontSize.xs,
      color: v.color.textMuted,
    }}
  >
    {label}
    {children}
  </label>
);
const ToolbarSummary: F<'ToolbarSummary'> = ({ live, children }) => (
  <span
    aria-live={live ? 'polite' : undefined}
    style={{ fontSize: v.fontSize.xs, color: v.color.textMuted }}
  >
    {children}
  </span>
);

const CopyValue: F<'CopyValue'> = ({ value }) => {
  const [done, setDone] = React.useState(false);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: v.space['2'] }}>
      <code style={{ fontFamily: v.font.mono, fontSize: v.fontSize.xs }}>{value}</code>
      <button
        type="button"
        style={control}
        onClick={() =>
          navigator.clipboard?.writeText(value).then(
            () => (setDone(true), setTimeout(() => setDone(false), 1500)),
            () => {}
          )
        }
      >
        {done ? t('ui.fallback.copied') : t('ui.fallback.copy')}
      </button>
    </span>
  );
};

// The native title: the browser shows it on hover after its own delay.
const Tooltip: F<'Tooltip'> = ({ content, children }) =>
  React.cloneElement(children as React.ReactElement<{ title?: string }>, { title: content });

const Kbd: F<'Kbd'> = ({ children }) => (
  <kbd
    style={{
      fontFamily: v.font.mono,
      fontSize: v.fontSize['2xs'],
      border,
      borderRadius: v.radius.sm,
      paddingInline: v.space['1'],
    }}
  >
    {children}
  </kbd>
);

const Link: F<'Link'> = ({ href, external, title, className, render, children }) => {
  const props: React.AnchorHTMLAttributes<HTMLAnchorElement> = {
    href,
    title,
    className,
    ...(external ? { target: '_blank', rel: 'noreferrer' } : {}),
    children,
    style: { color: v.color.accent },
  };
  return render ? render(props) : <a {...props} />;
};

const Progress: F<'Progress'> = ({ value, label, showLabel, className }) => (
  <span
    className={className}
    style={{ display: 'flex', flexDirection: 'column', gap: v.space['1'], fontSize: v.fontSize.xs }}
  >
    {showLabel ? (
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: v.space['2'] }}>
        <span>{label}</span>
        <span>{value}%</span>
      </span>
    ) : null}
    <progress
      value={value}
      max={100}
      aria-label={label}
      style={{ inlineSize: '100%', accentColor: v.color.accent }}
    />
  </span>
);

const KeyValueList: F<'KeyValueList'> = ({ orientation = 'vertical', labelWidth, children }) => (
  <dl
    style={{
      margin: 0,
      display: 'grid',
      gridTemplateColumns: orientation === 'vertical' ? `${labelWidth ?? '40%'} 1fr` : undefined,
      gridAutoFlow: orientation === 'horizontal' ? 'column' : undefined,
      gap: v.space['2'],
      fontSize: v.fontSize.sm,
    }}
  >
    {children}
  </dl>
);
const KeyValueItem: F<'KeyValueItem'> = ({ label, children }) => (
  <div style={{ display: 'contents' }}>
    <dt style={{ color: v.color.textMuted }}>{label}</dt>
    <dd style={{ margin: 0 }}>{children}</dd>
  </div>
);

const Alert: F<'Alert'> = ({ tone, label, children }) => (
  <section
    aria-label={label}
    style={{
      padding: v.space['3'],
      border: `1px solid ${tone === 'danger' ? v.color.danger : v.color.border}`,
      borderRadius: v.radius.lg,
      background: v.color.surface,
    }}
  >
    {children}
  </section>
);
const AlertTitle: F<'AlertTitle'> = ({ children }) => (
  <strong style={{ display: 'block', marginBlockEnd: v.space['2'] }}>{children}</strong>
);
const AlertDescription: F<'AlertDescription'> = ({ children }) => (
  <div style={{ fontSize: v.fontSize.sm }}>{children}</div>
);

const SearchField: F<'SearchField'> = ({ value, onValueChange, placeholder }) => (
  <input
    type="search"
    value={value}
    placeholder={placeholder}
    aria-label={placeholder}
    onChange={(e) => onValueChange(e.target.value)}
    style={{ ...control, inlineSize: '100%', boxSizing: 'border-box' }}
  />
);

/** The fallback for every optional contract component. */
export const fallbacks = {
  UiProvider,
  AppShell,
  AppMain,
  NavEnd,
  StatGroup,
  DataTable: DataTableFallback as F<'DataTable'>,
  Slider,
  Switch,
  SegmentedChoice,
  Toolbar,
  ToolbarStart,
  ToolbarEnd,
  ToolbarField,
  ToolbarSummary,
  CopyValue,
  Kbd,
  Tooltip,
  Link,
  Progress,
  KeyValueList,
  KeyValueItem,
  Alert,
  AlertTitle,
  AlertDescription,
  SearchField,
  Chart,
  Heatmap,
};
