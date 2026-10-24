/**
 * The reference adapter's heatmap: tiles on the design system's tokens. One sequential scale, the
 * warning hue mixed into the surface in five steps; the ink switches to the surface colour on the
 * steps where the text colour would fall under 4.5:1 (which steps depends on the theme: see
 * `INK_FROM` in index.tsx).
 */
import { globalStyle, style, styleVariants } from '@vanilla-extract/css';
import { focusOutline } from '@hydrotik/design-system/styles';
import { vars } from '@hydrotik/tokens';

/** Percent of the warning hue in each step's fill (step 0 is the plain surface). */
export const HEAT_MIX = [0, 14, 29, 44, 66, 86] as const;
const fill = (step: number) => (step ? `color-mix(in srgb, ${vars.color.warning} ${HEAT_MIX[step]}%, ${vars.color.surface})` : vars.color.surface);

export const root = style({ display: 'flex', flexDirection: 'column', gap: vars.space['3'], minInlineSize: 0 });

export const grid = style({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: vars.space['0_5'],
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 9rem), 1fr))',
});

export const tile = style({
  all: 'unset',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  gap: vars.space['1'],
  inlineSize: '100%',
  minBlockSize: '3.5rem',
  paddingBlock: vars.density.inset['1_5'],
  paddingInline: vars.density.inset['2'],
  borderRadius: vars.radii.sm,
  color: vars.color.text,
  // A hairline in the ink colour, so the plain-surface step still reads as a tile.
  boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${vars.color.text} 8%, transparent)`,
  selectors: {
    '&:is(button)': { cursor: 'pointer' },
    '&:is(button):hover': { boxShadow: `inset 0 0 0 1px currentColor` },
    '&:focus-visible': focusOutline,
  },
});
export const step = styleVariants({ 0: {}, 1: {}, 2: {}, 3: {}, 4: {}, 5: {} }, (_, k) => ({ backgroundColor: fill(Number(k)) }));
/** The surface colour as ink, on the dark end of the scale. */
export const inverse = style({ color: vars.color.surface });

export const name = style({
  fontSize: vars.font.size.xs,
  fontWeight: vars.font.weight.semibold,
  lineHeight: vars.font.lineHeight.tight,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const figure = style({ fontFamily: vars.font.family.mono, fontSize: vars.font.size['2xs'], fontVariantNumeric: 'tabular-nums' });

export const legend = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: vars.space['1_5'],
  fontSize: vars.font.size['2xs'],
  color: vars.color.textMuted,
});
export const legendLabel = style({
  fontFamily: vars.font.family.mono,
  fontSize: vars.font.size['3xs'],
  letterSpacing: vars.font.letterSpacing.caps,
  textTransform: 'uppercase',
  marginInlineEnd: vars.space['1'],
});
export const ramp = style({ display: 'inline-flex', gap: vars.space['0_5'] });
export const swatch = style({ inlineSize: '1.5rem', blockSize: '0.5rem', borderRadius: vars.radii.sm });
globalStyle(`${legend} > span`, { whiteSpace: 'nowrap' });
