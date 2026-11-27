/** The page frame and shared text styles of the dashboard (dashboard.css.ts re-exports them). */
import { globalStyle, style } from '@vanilla-extract/css';
import { tokens as v } from '../ui/tokens';

export const checker = `repeating-conic-gradient(${v.color.surfaceRaised} 0 25%, ${v.color.background} 0 50%) 0 0 / 1rem 1rem`;

// The focus indicator of the dashboard's own controls: a 1px line in the focus colour, the weight of
// a border, as the adapter's components draw theirs. An outline (not a box-shadow halo) keeps 3:1
// against the surface (WCAG 1.4.11) and is painted in forced-colors mode. `insetFocusOutline` is for
// an element its parent clips or that touches its neighbours (a list row in a scrolling panel).
export const focusOutline = {
  outline: `1px solid ${v.color.focus}`,
  outlineOffset: v.space['0_5'],
};
export const insetFocusOutline = { outline: `1px solid ${v.color.focus}`, outlineOffset: '-1px' };
// Over an image (the inspector's stage and its swipe handle), whose pixels can be any colour: no
// single line keeps 3:1 against all of them, and the focus colour, mid-way in lightness, fails
// against colours near its own. So images get a dark and a light line instead: 1px of the text
// colour with 1px of the page background inside it, one of which holds at least 3:1 against any
// colour (about 4:1 at worst, in both themes). Every other focus line is the focus colour.
export const twoToneFocus = {
  outline: `1px solid ${v.color.text}`,
  outlineOffset: '-1px',
  boxShadow: `inset 0 0 0 2px ${v.color.background}`,
};

globalStyle('html, body, #root', { blockSize: '100%', margin: 0 });
globalStyle('body', {
  backgroundColor: v.color.background,
  color: v.color.text,
  fontFamily: v.font.sans,
});

export const page = style({
  display: 'flex',
  flexDirection: 'column',
  gap: v.space['5'],
  maxInlineSize: '96rem',
  marginInline: 'auto',
  paddingBlock: `${v.space['5']} ${v.space['12']}`,
  paddingInline: v.space['4'],
  boxSizing: 'border-box',
  inlineSize: '100%',
  // The page's own layers (card affordances) stay under menus and popovers, which portal to <body>.
  isolation: 'isolate',
});

export const stack = style({
  display: 'flex',
  flexDirection: 'column',
  gap: v.space['4'],
  minInlineSize: 0,
});
export const row = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: v.space['2'],
});
export const spacer = style({ flex: 1 });
// Two badges read as one status (the connection, and whether this page can approve): no wrap.
export const pair = style({ display: 'inline-flex', alignItems: 'center', gap: v.space['1'] });
/** Read by assistive technology, not drawn. */
export const srOnly = style({
  position: 'absolute',
  inlineSize: '1px',
  blockSize: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
});

export const twoCol = style({
  display: 'grid',
  gap: v.space['4'],
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 26rem), 1fr))',
  alignItems: 'start',
});

// The Overview below its counts: two equal columns when its own box is wide enough, else one
// column in source order (left, then right). A size container, so it follows its box, not the window.
export const overviewCols = style({ containerType: 'inline-size' });
export const overviewGrid = style({
  display: 'grid',
  gap: v.space['4'],
  gridTemplateColumns: 'minmax(0, 1fr)',
  alignItems: 'start',
  '@container': { '(inline-size >= 56rem)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } },
});

/** A table cell's main text with a quieter line under it. */
export const cellLines = style({
  display: 'flex',
  flexDirection: 'column',
  gap: v.space['0_5'],
  minInlineSize: 0,
});

/** Running text inside a card at the size of a banner's body (the Overview's errors card). */
export const small = style({ fontSize: v.fontSize.sm });

export const muted = style({ color: v.color.textMuted });
export const mono = style({ fontFamily: v.font.mono, fontVariantNumeric: 'tabular-nums' });
export const micro = style({
  fontFamily: v.font.mono,
  fontSize: v.fontSize['3xs'],
  // A whole-pixel line: an inherited 1.5 makes a 13.5px label, and what follows a half pixel.
  lineHeight: '0.875rem',
  letterSpacing: v.letterSpacing.caps,
  textTransform: 'uppercase',
  color: v.color.textMuted,
});
export const lede = style({
  margin: 0,
  maxInlineSize: '70ch',
  color: v.color.textMuted,
  fontSize: v.fontSize.sm,
  // 22px: the relaxed 1.6 of 14px is 22.4px a line, and what follows two lines is off whole pixels.
  lineHeight: '1.375rem',
});
