/** The chart fallbacks (fallbacks.tsx): a series as a table, and a heatmap of plain tiles. */
import React from 'react';
import { heatStep } from '../contract';
import { tokens as v } from '../tokens';
import { border, type Cell, type F } from './base';

/** Without a chart library: the series as a table, so the numbers are still there. */
export const Chart: F<'Chart'> = ({ data, series, x, format = String, className }) => (
  <div className={className} style={{ overflowX: 'auto' }}>
    <table style={{ borderCollapse: 'collapse', fontSize: v.fontSize.sm }}>
      <thead>
        <tr>
          {/* The corner over the row headers: a cell, since a header with no text names nothing. */}
          <td style={{ paddingInline: v.space['2'] }} />
          {series.map((s) => (
            <th
              key={s.key}
              scope="col"
              style={{ textAlign: 'end', paddingInline: v.space['2'], color: v.color.textMuted }}
            >
              {s.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((d, i) => (
          <tr key={i}>
            <th
              scope="row"
              style={{ textAlign: 'start', paddingInline: v.space['2'], fontWeight: 'normal' }}
            >
              {String(d[x])}
            </th>
            {series.map((s) => (
              <td
                key={s.key}
                style={{ textAlign: 'end', paddingInline: v.space['2'], fontFamily: v.font.mono }}
              >
                {typeof d[s.key] === 'number'
                  ? format(d[s.key] as number)
                  : String((d[s.key] as Cell) ?? '')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/** The accent over the surface (the charts' blue in the reference adapter), one mix per step of the scale (step 0 is the plain surface). */
const HEAT_MIX = [0, 14, 29, 44, 66, 86];
const heat = (step: number) =>
  step
    ? `color-mix(in srgb, ${v.color.accent} ${HEAT_MIX[step]}%, ${v.color.surface})`
    : v.color.surface;
const swatch = (step: number): React.CSSProperties => ({
  flexShrink: 0,
  inlineSize: '0.75rem',
  blockSize: '0.75rem',
  borderRadius: v.radius.sm,
  background: heat(step),
  border,
});

/**
 * Without a designed heatmap: plain tiles, a swatch of the step beside the text (the text stays on
 * the surface, so it meets contrast whatever the step), and the legend as five swatches.
 */
export const Heatmap: F<'Heatmap'> = ({ label, cells, legend, onSelect, className }) => (
  <div
    className={className}
    style={{ display: 'flex', flexDirection: 'column', gap: v.space['2'] }}
  >
    <ul
      aria-label={label}
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'grid',
        gap: v.space['1'],
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 10rem), 1fr))',
      }}
    >
      {cells.map((c) => {
        const body = (
          <>
            <span aria-hidden="true" style={swatch(heatStep(c.value))} />
            <span style={{ display: 'flex', flexDirection: 'column', minInlineSize: 0 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.label}
              </span>{' '}
              <span
                style={{
                  fontFamily: v.font.mono,
                  fontSize: v.fontSize['2xs'],
                  color: v.color.textMuted,
                }}
              >
                {c.text}
              </span>
            </span>
          </>
        );
        const box: React.CSSProperties = {
          display: 'flex',
          alignItems: 'center',
          gap: v.space['2'],
          inlineSize: '100%',
          boxSizing: 'border-box',
          textAlign: 'start',
          padding: v.space['2'],
          border,
          borderRadius: v.radius.md,
          background: v.color.surface,
          color: v.color.text,
          font: 'inherit',
          fontSize: v.fontSize.xs,
        };
        const name = c.accessibleLabel ?? `${c.label}, ${c.text}`;
        return (
          <li key={c.id}>
            {onSelect ? (
              <button
                type="button"
                aria-label={name}
                title={name}
                onClick={() => onSelect(c)}
                style={{ ...box, cursor: 'pointer' }}
              >
                {body}
              </button>
            ) : (
              <div aria-label={name} role="group" style={box}>
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: v.space['1'],
        fontSize: v.fontSize['2xs'],
        color: v.color.textMuted,
      }}
    >
      <span style={{ marginInlineEnd: v.space['1'] }}>{legend.label}</span>
      <span>{legend.low}</span>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} aria-hidden="true" style={swatch(n)} />
      ))}
      <span>{legend.high}</span>
    </div>
  </div>
);
