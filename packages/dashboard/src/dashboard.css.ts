/**
 * Dashboard-only layout. Everything visual that a contract component already owns (buttons,
 * badges, cards, sliders…) comes from the UI adapter (`@ui`); this file lays those out and styles
 * the parts no component covers: the image stage, story thumbnails, the pixel readout. It reads the
 * neutral `--pxsig-*` tokens (./ui/tokens.ts) only, never a design system's variables.
 */
import { globalStyle, style } from '@vanilla-extract/css';
import { tokens as v } from './ui/tokens';

const checker = `repeating-conic-gradient(${v.color.surfaceRaised} 0 25%, ${v.color.background} 0 50%) 0 0 / 1rem 1rem`;

globalStyle('html, body, #root', { blockSize: '100%', margin: 0 });
globalStyle('body', { backgroundColor: v.color.background, color: v.color.text, fontFamily: v.font.sans });
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
export const brand = style({ margin: 0, fontSize: v.fontSize.sm, fontWeight: v.fontWeight.semibold, whiteSpace: 'nowrap' });
export const brandTag = style({ '@container': { '(inline-size < 64rem)': { display: 'none' } } });
// The overflow menu holds the section links as menu items; they read as items, not underlined links.
globalStyle('[role="menuitem"]:is(a)', { textDecoration: 'none', color: 'inherit' });
globalStyle('[role="menuitem"]:is(a)[aria-current="page"]', { fontWeight: v.fontWeight.semibold, color: v.color.accent });
export const navEnd = style({ display: 'flex', flexShrink: 0, alignItems: 'center', gap: v.space['2'] });
/** The review status, when the review button beside it already says what is waiting. */
export const statusBeside = style({ '@container': { '(inline-size < 48rem)': { display: 'none' } } });
export const lastCheck = style({ whiteSpace: 'nowrap', '@container': { '(inline-size < 80rem)': { display: 'none' } } });

export const stack = style({ display: 'flex', flexDirection: 'column', gap: v.space['4'], minInlineSize: 0 });
export const row = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: v.space['2'] });
export const spacer = style({ flex: 1 });
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

export const muted = style({ color: v.color.textMuted });
export const mono = style({ fontFamily: v.font.mono, fontVariantNumeric: 'tabular-nums' });
export const micro = style({
  fontFamily: v.font.mono,
  fontSize: v.fontSize['3xs'],
  letterSpacing: v.letterSpacing.caps,
  textTransform: 'uppercase',
  color: v.color.textMuted,
});
export const lede = style({ margin: 0, maxInlineSize: '70ch', color: v.color.textMuted, fontSize: v.fontSize.sm, lineHeight: v.lineHeight.relaxed });
export const h2 = style({ margin: 0, fontSize: v.fontSize.lg, fontWeight: v.fontWeight.semibold });

// --- story cards ------------------------------------------------------------
export const cards = style({
  display: 'grid',
  gap: v.space['3'],
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 15rem), 1fr))',
});
export const storyCard = style({
  all: 'unset',
  position: 'relative',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  minInlineSize: 0,
  border: `1px solid ${v.color.border}`,
  borderRadius: v.radius.lg,
  backgroundColor: v.color.surface,
  overflow: 'hidden',
  cursor: 'pointer',
  selectors: {
    '&:hover': { borderColor: v.color.accent },
    '&:focus-visible': {
      borderColor: v.color.focus,
      boxShadow: `0 0 0 3px color-mix(in srgb, ${v.color.focus} 50%, transparent)`,
    },
  },
});
// A status edge on each card, so problems stand out while scrolling.
const edge = (color: string) => ({ borderInlineStartColor: color, borderInlineStartWidth: v.line.emphasis });
globalStyle(`${storyCard}[data-status="changed"]`, edge(v.color.warning));
globalStyle(`${storyCard}[data-status="flaky"]`, edge(v.color.warning));
globalStyle(`${storyCard}[data-status="new"]`, edge(v.color.accent));
globalStyle(`${storyCard}[data-status="error"]`, edge(v.color.danger));
globalStyle(`${storyCard}[data-status="rejected"]`, edge(v.color.danger));
globalStyle(`${storyCard}[data-status="approved"]`, edge(v.color.success));
// --- affordance: what a clickable card does, top-right ---------------------------------------
export const affordance = style({
  position: 'absolute',
  // Close to the corner, with the glyph centred on the card's first text row (the label).
  insetBlockStart: v.space['1_5'],
  insetInlineEnd: v.space['1'],
  display: 'flex',
  padding: v.space['1'],
  borderRadius: v.radius.md,
  // A backing so the icon reads over a thumbnail as well as on a plain card.
  backgroundColor: `color-mix(in srgb, ${v.color.surface} 85%, transparent)`,
  color: v.color.textMuted,
  pointerEvents: 'none',
  zIndex: 1,
  transition: `color ${v.motion.fast}`,
});
globalStyle(`${affordance} svg`, { inlineSize: '0.75rem', blockSize: '0.75rem' });
globalStyle(`button:hover ${affordance}, a:hover ${affordance}, button:focus-visible ${affordance}`, { color: v.color.accent });
// StatPanel's clickable cards are not a positioning context yet (until the pattern moves into the
// design system); its filter and link cards render as button and a.
export const statCards = style({});
globalStyle(`${statCards} button, ${statCards} a`, { position: 'relative' });
// The icon slot beside the label would take room the label needs; the affordance sits in the corner.
globalStyle(`${statCards} span:has(> ${affordance})`, { display: 'contents' });
globalStyle(`${statCards} :is(button, a) > span:has(${affordance})`, { paddingInlineEnd: v.space['5'] });

export const inlineIcon = style({ inlineSize: '0.75rem', blockSize: '0.75rem', flexShrink: 0 });

// Grouped grid: each component's cards sit on a band, alternating, so a group reads as one row.
export const groups = style({ display: 'flex', flexDirection: 'column' });
export const groupBand = style({
  display: 'flex',
  flexDirection: 'column',
  gap: v.space['3'],
  padding: v.space['3'],
  borderRadius: v.radius.lg,
  selectors: {
    '&:nth-of-type(odd)': { backgroundColor: `color-mix(in srgb, ${v.color.text} 4%, transparent)` },
  },
});
export const groupHead = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: v.space['2'],
  margin: 0,
  fontSize: v.fontSize.sm,
  fontWeight: v.fontWeight.semibold,
});
export const thumb = style({
  position: 'relative',
  blockSize: '9rem',
  background: checker,
  borderBlockEnd: `1px solid ${v.color.border}`,
  overflow: 'hidden',
});
globalStyle(`${thumb} img`, { position: 'absolute', inset: 0, inlineSize: '100%', blockSize: '100%', objectFit: 'contain' });
export const thumbMask = style({ mixBlendMode: 'normal', opacity: 0.85 });
export const cardBody = style({ display: 'flex', flexDirection: 'column', gap: v.space['1_5'], padding: v.space['2_5'] });
export const cardId = style({
  fontFamily: v.font.mono,
  fontSize: v.fontSize.xs,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const cardStats = style({ display: 'flex', gap: v.space['3'], fontFamily: v.font.mono, fontSize: v.fontSize['2xs'], color: v.color.textMuted });

// --- scenario list ----------------------------------------------------------
export const scenarioLayout = style({
  display: 'grid',
  gap: v.space['4'],
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 20rem), 1fr))',
  alignItems: 'start',
});
export const scenarioList = style({ display: 'flex', flexDirection: 'column', gap: v.space['1'], maxInlineSize: '24rem' });
export const scenarioItem = style({
  all: 'unset',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: v.space['1_5'],
  padding: v.space['2_5'],
  borderRadius: v.radius.md,
  border: `1px solid transparent`,
  cursor: 'pointer',
  selectors: {
    '&:hover': { backgroundColor: v.color.hover },
    '&[aria-pressed="true"]': { borderColor: v.color.accent, backgroundColor: `color-mix(in srgb, ${v.color.accent} 8%, transparent)` },
    '&:focus-visible': { boxShadow: `0 0 0 3px color-mix(in srgb, ${v.color.focus} 50%, transparent)` },
  },
});

// --- inspector ---------------------------------------------------------------
export const inspector = style({
  // Full-screen dialog: overrides DialogContent's centred card size.
  inlineSize: 'calc(100% - 1rem) !important',
  maxInlineSize: 'none !important',
  blockSize: 'calc(100% - 1rem) !important',
  maxBlockSize: 'none !important',
  padding: '0 !important',
  display: 'flex !important',
  flexDirection: 'column',
  gap: '0 !important',
  overflow: 'hidden',
});
export const insHead = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: `${v.space['2']} ${v.space['4']}`,
  paddingBlock: v.space['3'],
  paddingInline: v.space['4'],
  borderBlockEnd: `1px solid ${v.color.border}`,
});
// Focused (tabIndex -1) only as the dialog's starting point; it is not a control, so no focus ring.
export const insTitle = style({ margin: 0, fontFamily: v.font.mono, fontSize: v.fontSize.sm, wordBreak: 'break-all', outline: 'none' });
// Review session: progress above the inspector, a summary when every entry is decided.
export const sessionBar = style({
  display: 'flex',
  alignItems: 'center',
  gap: v.space['3'],
  paddingInline: v.space['4'],
  paddingBlock: v.space['2'],
  borderBlockEnd: `1px solid ${v.color.border}`,
  fontSize: v.fontSize.sm,
});
export const note = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: v.space['2'],
  paddingInline: v.space['4'],
  paddingBlock: v.space['2'],
  borderBlockEnd: `1px solid ${v.color.border}`,
  backgroundColor: `color-mix(in srgb, ${v.color.danger} 8%, transparent)`,
  fontSize: v.fontSize.sm,
});
export const summaryDialog = style({ inlineSize: 'min(100%, 40rem)', padding: 0, gap: 0 });
export const summary = style({ display: 'flex', flexDirection: 'column', gap: v.space['4'], padding: v.space['6'] });
// --- help: term rows beside a drawing of the screen -----------------------------------------
export const helpSection = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: v.space['5'] });
export const helpRows = style({ display: 'grid', columnGap: v.space['4'], margin: 0, flex: '2 1 26rem', minInlineSize: 0 });
export const helpRow = style({
  display: 'grid',
  gridColumn: '1 / -1',
  gridTemplateColumns: 'subgrid',
  paddingBlock: v.space['1_5'],
  paddingInline: v.space['2'],
  borderRadius: v.radius.md,
  fontSize: v.fontSize.sm,
  outline: 'none',
  selectors: {
    '&[data-active]': { backgroundColor: `color-mix(in srgb, ${v.color.accent} 10%, transparent)` },
    '&:focus-visible': { boxShadow: `0 0 0 ${v.line.emphasis} color-mix(in srgb, ${v.color.focus} 50%, transparent)` },
  },
});
globalStyle(`${helpRow} dt`, { color: v.color.textMuted });
globalStyle(`${helpRow} dd`, { margin: 0 });
export const helpDrawing = style({ flex: '1 1 18rem', maxInlineSize: '28rem', position: 'sticky', insetBlockStart: v.space['4'] });
export const schematic = style({ display: 'block', inlineSize: '100%', blockSize: 'auto' });
export const insToolbar = style({
  paddingBlock: v.space['2'],
  paddingInline: v.space['4'],
  borderBlockEnd: `1px solid ${v.color.border}`,
  backgroundColor: v.color.background,
});
export const insMain = style({ flex: 1, minBlockSize: 0, display: 'flex', flexWrap: 'wrap' });
export const insStageWrap = style({ flex: '999 1 30rem', minInlineSize: 0, minBlockSize: '20rem', display: 'flex', flexDirection: 'column' });
export const insStage = style({
  flex: 1,
  minBlockSize: 0,
  display: 'grid',
  gridAutoFlow: 'column',
  gridAutoColumns: 'minmax(0, 1fr)',
  gap: '2px',
  backgroundColor: v.color.border,
  cursor: 'grab',
  touchAction: 'none',
  userSelect: 'none',
  outline: 'none',
  selectors: {
    '&[data-grabbing]': { cursor: 'grabbing' },
    '&:focus-visible': { boxShadow: `inset 0 0 0 2px ${v.color.focus}` },
  },
});
export const vp = style({ position: 'relative', overflow: 'hidden', minBlockSize: 0, background: checker });
export const layer = style({
  position: 'absolute',
  insetBlockStart: 0,
  insetInlineStart: 0,
  transformOrigin: '0 0',
  boxShadow: `0 0 0 1px ${v.color.border}`,
});
globalStyle(`${layer} > *`, { position: 'absolute', inset: 0, display: 'block' });
globalStyle(`${insStage}[data-pixelated] canvas, ${insStage}[data-pixelated] img`, { imageRendering: 'pixelated' });
export const boxes = style({ overflow: 'visible', pointerEvents: 'none' });
// The frame is scaled with a CSS transform, which non-scaling-stroke ignores: divide by the zoom.
globalStyle(`${boxes} rect`, {
  fill: 'none',
  stroke: v.color.warning,
  strokeWidth: 'calc(1.5px / var(--dv-zoom, 1))',
  strokeDasharray: 'calc(4px / var(--dv-zoom, 1)) calc(3px / var(--dv-zoom, 1))',
});
globalStyle(`${boxes} rect[data-active]`, { stroke: v.color.accent, strokeWidth: 'calc(2.5px / var(--dv-zoom, 1))', strokeDasharray: 'none' });
globalStyle(`${boxes} rect[data-tile]`, {
  stroke: v.color.danger,
  fill: `color-mix(in srgb, ${v.color.danger} 18%, transparent)`,
  strokeDasharray: 'none',
  strokeWidth: 'calc(1px / var(--dv-zoom, 1))',
});
export const vpLabel = style({
  position: 'absolute',
  insetBlockStart: v.space['2'],
  insetInlineStart: v.space['2'],
  paddingBlock: v.space['0_5'],
  paddingInline: v.space['1_5'],
  borderRadius: v.radius.sm,
  backgroundColor: `color-mix(in srgb, ${v.color.background} 85%, transparent)`,
  pointerEvents: 'none',
});
export const marker = style({
  position: 'absolute',
  minInlineSize: '6px',
  minBlockSize: '6px',
  outline: `1px solid ${v.color.accent}`,
  boxShadow: `0 0 0 2px color-mix(in srgb, ${v.color.background} 70%, transparent)`,
  pointerEvents: 'none',
});
export const swipeHandle = style({
  position: 'absolute',
  insetBlock: 0,
  inlineSize: v.space['3'],
  marginInlineStart: `calc(${v.space['3']} / -2)`,
  cursor: 'ew-resize',
  '::after': {
    content: '""',
    position: 'absolute',
    insetBlock: 0,
    insetInlineStart: 'calc(50% - 1px)',
    inlineSize: '2px',
    backgroundColor: v.color.accent,
  },
});
export const insHelp = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: `${v.space['1']} ${v.space['3']}`,
  paddingBlock: v.space['1_5'],
  paddingInline: v.space['4'],
  borderBlockStart: `1px solid ${v.color.border}`,
  fontSize: v.fontSize['2xs'],
  color: v.color.textMuted,
});
export const insSide = style({
  flex: '1 1 20rem',
  maxBlockSize: '100%',
  overflow: 'auto',
  padding: v.space['4'],
  display: 'flex',
  flexDirection: 'column',
  gap: v.space['5'],
  borderInlineStart: `1px solid ${v.color.border}`,
  boxSizing: 'border-box',
});
export const sideSection = style({ display: 'flex', flexDirection: 'column', gap: v.space['2'] });
// A side section's title, with its action (the Storybook link on Pixel) at the end of the row.
export const sectionHead = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: v.space['2'] });
export const sectionTitle = style({ margin: 0, fontSize: v.fontSize.sm, fontWeight: v.fontWeight.semibold });
export const readout = style({ display: 'flex', flexDirection: 'column', gap: v.space['1_5'], minBlockSize: '6.5rem' });
// Every row is as tall as its tallest content (the Δ badge), with or without a value.
export const pxRow = style({ display: 'flex', alignItems: 'center', gap: v.space['2'], minBlockSize: '1.5rem', minInlineSize: 0 });
// The coordinates keep their width; the cell / tile text beside them truncates instead of wrapping the row.
export const pxCoords = style({ whiteSpace: 'nowrap', flexShrink: 0 });
export const oneLine = style({ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: v.fontSize.sm });
export const swatch = style({
  inlineSize: v.space['4'],
  blockSize: v.space['4'],
  borderRadius: v.radius.sm,
  boxShadow: `inset 0 0 0 1px ${v.color.border}`,
  background: checker,
  flexShrink: 0,
});
export const regions = style({ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '2px' });
export const region = style({
  all: 'unset',
  boxSizing: 'border-box',
  inlineSize: '100%',
  display: 'flex',
  justifyContent: 'space-between',
  gap: v.space['2'],
  paddingBlock: v.space['1'],
  paddingInline: v.space['2'],
  borderRadius: v.radius.sm,
  border: '1px solid transparent',
  cursor: 'pointer',
  fontSize: v.fontSize.xs,
  selectors: {
    '&:hover': { backgroundColor: v.color.hover },
    '&[aria-pressed="true"]': { borderColor: v.color.accent, backgroundColor: `color-mix(in srgb, ${v.color.accent} 10%, transparent)` },
    '&:focus-visible': { boxShadow: `0 0 0 3px color-mix(in srgb, ${v.color.focus} 50%, transparent)` },
  },
});
export const sigs = style({ display: 'grid', gap: v.space['2'], gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' });
globalStyle(`${sigs} figure`, { margin: 0, display: 'flex', flexDirection: 'column', gap: v.space['1'] });
globalStyle(`${sigs} img`, {
  inlineSize: '100%',
  aspectRatio: '1',
  imageRendering: 'pixelated',
  border: `1px solid ${v.color.border}`,
  borderRadius: v.radius.sm,
  backgroundColor: v.color.surfaceRaised,
});
export const resources = style({ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: v.space['1'] });
globalStyle(`${resources} li`, { display: 'flex', alignItems: 'center', gap: v.space['2'], fontSize: v.fontSize.xs, minInlineSize: 0 });
// A violation: impact and rule on the first line; its tag and action wrap below when narrow.
export const a11yItem = style({ flexWrap: 'wrap', rowGap: v.space['1'] });
export const a11yRule = style({ flex: '1 1 9rem', minInlineSize: 0, overflowWrap: 'anywhere' });
export const grow = style({ flex: 1, minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
export const sliderCtl = style({ inlineSize: '9rem' });
// Same height as the toolbar's sm buttons so a switch + label lines up with them.
export const ctl = style({ display: 'inline-flex', alignItems: 'center', alignSelf: 'center', blockSize: '1.75rem', gap: v.space['2'], fontSize: v.fontSize.xs, lineHeight: 1 });
export const empty = style({
  padding: v.space['8'],
  textAlign: 'center',
  color: v.color.textMuted,
  border: `1px dashed ${v.color.border}`,
  borderRadius: v.radius.lg,
});
export const chartBox = style({ inlineSize: '100%', blockSize: '16rem' });
// Storybook panel: exactly the iframe's height, the stage takes whatever the toolbar leaves.
export const embed = style({ blockSize: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' });
// Toolbar groups centre their items, so status badges, toggle groups, buttons and
// switches share one midline.
globalStyle(`${insToolbar} > *`, { alignItems: 'center' });
