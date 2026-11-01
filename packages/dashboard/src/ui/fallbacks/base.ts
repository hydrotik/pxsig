/** What every fallback shares (fallbacks.tsx): the component type, a cell, a border, a control. */
import type React from 'react';
import type { ComponentProps } from '../contract';
import { tokens as v } from '../tokens';

export type F<K extends keyof ComponentProps> = (
  props: ComponentProps[K]
) => React.ReactElement | null;
/** A table or chart cell: the primitive a column's field or a series' key names. */
export type Cell = string | number | boolean | null | undefined;

export const border = `1px solid ${v.color.border}`;
/** A field or button: the sm control height every dashboard toolbar uses. */
export const control: React.CSSProperties = {
  boxSizing: 'border-box',
  blockSize: '1.75rem',
  font: 'inherit',
  fontSize: v.fontSize.sm,
  color: v.color.text,
  background: v.color.surface,
  border,
  borderRadius: v.radius.md,
  paddingBlock: v.space['1'],
  paddingInline: v.space['2'],
};
