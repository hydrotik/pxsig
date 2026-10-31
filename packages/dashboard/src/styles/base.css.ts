/** The page frame and shared text styles of the dashboard (dashboard.css.ts re-exports them). */
import { globalStyle, style } from '@vanilla-extract/css';
import { tokens as v } from '../ui/tokens';

export const checker = `repeating-conic-gradient(${v.color.surfaceRaised} 0 25%, ${v.color.background} 0 50%) 0 0 / 1rem 1rem`;

globalStyle('html, body, #root', { blockSize: '100%', margin: 0 });
globalStyle('body', {
  backgroundColor: v.color.background,
  color: v.color.text,
  fontFamily: v.font.sans,
});
// A control's height includes its border (CONTROLS.md); ToggleGroup's root relies on a page-wide
// border-box reset this page does not have, and grows by its 2px border without one.
globalStyle('[data-control]', { boxSizing: 'border-box' });

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

// The top bar: the report's mark, the section links, then the controls pinned at the end. It sits
// above the scrolling <main>, so it needs no sticky positioning. The bar is a size container: at
// narrow widths the modes tag, the last-check time and a repeated review status give their room to
// the section links, and the links that still do not fit move into the bar's More menu.
export const navbar = style({ flexShrink: 0, containerType: 'inline-size' });
export const brand = style({
  margin: 0,
  fontSize: v.fontSize.sm,
  fontWeight: v.fontWeight.semibold,
  whiteSpace: 'nowrap',
});
export const modesTag = style({
  whiteSpace: 'nowrap',
  '@container': { '(inline-size < 64rem)': { display: 'none' } },
});
// The overflow menu holds the section links as menu items; they read as items, not underlined links.
globalStyle('[role="menuitem"]:is(a)', { textDecoration: 'none', color: 'inherit' });
globalStyle('[role="menuitem"]:is(a)[aria-current="page"]', {
  fontWeight: v.fontWeight.semibold,
  color: v.color.accent,
});
export const navEnd = style({
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  gap: v.space['2'],
});
/** The review status, when the review button beside it already says what is waiting. */
export const statusBeside = style({
  '@container': { '(inline-size < 48rem)': { display: 'none' } },
});
export const lastCheck = style({
  whiteSpace: 'nowrap',
  '@container': { '(inline-size < 80rem)': { display: 'none' } },
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
  letterSpacing: v.letterSpacing.caps,
  textTransform: 'uppercase',
  color: v.color.textMuted,
});
export const lede = style({
  margin: 0,
  maxInlineSize: '70ch',
  color: v.color.textMuted,
  fontSize: v.fontSize.sm,
  lineHeight: v.lineHeight.relaxed,
});
export const h2 = style({ margin: 0, fontSize: v.fontSize.lg, fontWeight: v.fontWeight.semibold });
