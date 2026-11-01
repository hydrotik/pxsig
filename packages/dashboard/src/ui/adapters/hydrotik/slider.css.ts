/**
 * The reference adapter's Slider on one line: label, track and value at the toolbar's sm control
 * height, so it lines up with the buttons beside it (the design system's slider field stacks the
 * label over the track). The value is the field's own: mono, tabular, in the primary colour.
 */
import { style } from '@vanilla-extract/css';
import { vars } from '@hydrotik/tokens';

export const root = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: vars.space['2'],
  blockSize: vars.density.control.sm,
  fontSize: vars.font.size.xs,
  color: vars.color.text,
  whiteSpace: 'nowrap',
});

export const track = style({ flex: 1, minInlineSize: 0 });

export const value = style({
  fontFamily: vars.font.family.mono,
  fontVariantNumeric: 'tabular-nums',
  color: vars.color.primary,
});
