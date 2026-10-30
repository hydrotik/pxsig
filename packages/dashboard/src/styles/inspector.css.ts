/** The inspector: its dialog, stage, side panel, help and the Storybook panel embed. */
import { globalStyle, style } from '@vanilla-extract/css';
import { tokens as v } from '../ui/tokens';
import { checker } from './base.css';

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
// One height and one place for the actions from entry to entry: Approve moves on to the next
// entry, so a bar that reflowed with each entry's id, badge or counter moved the button out from
// under the pointer. Whatever varies sits in the first column, one line each, cut with an
// ellipsis; the actions column holds only controls whose width does not change.
export const insHead = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  columnGap: v.space['4'],
  paddingBlock: v.space['3'],
  paddingInline: v.space['4'],
  borderBlockEnd: `1px solid ${v.color.border}`,
});
// Focused (tabIndex -1) only as the dialog's starting point; it is not a control, so no focus ring.
export const insTitle = style({
  margin: 0,
  fontFamily: v.font.mono,
  fontSize: v.fontSize.sm,
  outline: 'none',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const insInfo = style({
  display: 'flex',
  flexDirection: 'column',
  gap: v.space['0_5'],
  minInlineSize: 0,
});
export const insContext = style({
  display: 'flex',
  alignItems: 'center',
  gap: v.space['2'],
  minInlineSize: 0,
});
export const insActions = style({ display: 'flex', alignItems: 'center', gap: v.space['2'] });
// "9 / 16" and "10 / 16" take the same room, so the arrows either side stay put.
export const counter = style({ fontVariantNumeric: 'tabular-nums', textAlign: 'center' });
// Undo keeps its slot while there is nothing to undo, so Approve does not move when it appears.
export const slot = style({ display: 'inline-flex' });
export const reserved = style({ display: 'inline-flex', visibility: 'hidden' });
// One line, cut with an ellipsis, at the size of whatever it is combined with.
export const clip = style({
  minInlineSize: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
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
export const summary = style({
  display: 'flex',
  flexDirection: 'column',
  gap: v.space['4'],
  padding: v.space['6'],
});
// --- help: term rows beside a drawing of the screen -----------------------------------------
export const helpSection = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  gap: v.space['5'],
});
export const helpRows = style({
  display: 'grid',
  columnGap: v.space['4'],
  margin: 0,
  flex: '2 1 26rem',
  minInlineSize: 0,
});
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
    '&:focus-visible': {
      boxShadow: `0 0 0 ${v.line.emphasis} color-mix(in srgb, ${v.color.focus} 50%, transparent)`,
    },
  },
});
globalStyle(`${helpRow} dt`, { color: v.color.textMuted });
globalStyle(`${helpRow} dd`, { margin: 0 });
export const helpDrawing = style({
  flex: '1 1 18rem',
  maxInlineSize: '28rem',
  position: 'sticky',
  insetBlockStart: v.space['4'],
});
export const schematic = style({ display: 'block', inlineSize: '100%', blockSize: 'auto' });
export const insToolbar = style({
  paddingBlock: v.space['2'],
  paddingInline: v.space['4'],
  borderBlockEnd: `1px solid ${v.color.border}`,
  backgroundColor: v.color.background,
});
export const insMain = style({ flex: 1, minBlockSize: 0, display: 'flex', flexWrap: 'wrap' });
export const insStageWrap = style({
  flex: '999 1 30rem',
  minInlineSize: 0,
  minBlockSize: '20rem',
  display: 'flex',
  flexDirection: 'column',
});
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
export const vp = style({
  position: 'relative',
  overflow: 'hidden',
  minBlockSize: 0,
  background: checker,
});
export const layer = style({
  position: 'absolute',
  insetBlockStart: 0,
  insetInlineStart: 0,
  transformOrigin: '0 0',
  boxShadow: `0 0 0 1px ${v.color.border}`,
});
globalStyle(`${layer} > *`, { position: 'absolute', inset: 0, display: 'block' });
globalStyle(`${insStage}[data-pixelated] canvas, ${insStage}[data-pixelated] img`, {
  imageRendering: 'pixelated',
});
export const boxes = style({ overflow: 'visible', pointerEvents: 'none' });
// The frame is scaled with a CSS transform, which non-scaling-stroke ignores: divide by the zoom.
globalStyle(`${boxes} rect`, {
  fill: 'none',
  stroke: v.color.warning,
  strokeWidth: 'calc(1.5px / var(--dv-zoom, 1))',
  strokeDasharray: 'calc(4px / var(--dv-zoom, 1)) calc(3px / var(--dv-zoom, 1))',
});
globalStyle(`${boxes} rect[data-active]`, {
  stroke: v.color.accent,
  strokeWidth: 'calc(2.5px / var(--dv-zoom, 1))',
  strokeDasharray: 'none',
});
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
export const sectionHead = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: v.space['2'],
});
export const sectionTitle = style({
  margin: 0,
  fontSize: v.fontSize.sm,
  fontWeight: v.fontWeight.semibold,
});
export const readout = style({
  display: 'flex',
  flexDirection: 'column',
  gap: v.space['1_5'],
  minBlockSize: '6.5rem',
});
// Every row is as tall as its tallest content (the Δ badge), with or without a value.
export const pxRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: v.space['2'],
  minBlockSize: '1.5rem',
  minInlineSize: 0,
});
// The coordinates keep their width; the cell / tile text beside them truncates instead of wrapping the row.
export const pxCoords = style({ whiteSpace: 'nowrap', flexShrink: 0 });
export const oneLine = style({
  minInlineSize: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: v.fontSize.sm,
});
export const swatch = style({
  inlineSize: v.space['4'],
  blockSize: v.space['4'],
  borderRadius: v.radius.sm,
  boxShadow: `inset 0 0 0 1px ${v.color.border}`,
  background: checker,
  flexShrink: 0,
});
export const regions = style({
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
});
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
    '&[aria-pressed="true"]': {
      borderColor: v.color.accent,
      backgroundColor: `color-mix(in srgb, ${v.color.accent} 10%, transparent)`,
    },
    '&:focus-visible': {
      boxShadow: `0 0 0 3px color-mix(in srgb, ${v.color.focus} 50%, transparent)`,
    },
  },
});
export const sigs = style({
  display: 'grid',
  gap: v.space['2'],
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
});
globalStyle(`${sigs} figure`, {
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: v.space['1'],
});
globalStyle(`${sigs} img`, {
  inlineSize: '100%',
  aspectRatio: '1',
  imageRendering: 'pixelated',
  border: `1px solid ${v.color.border}`,
  borderRadius: v.radius.sm,
  backgroundColor: v.color.surfaceRaised,
});
export const resources = style({
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: v.space['1'],
});
globalStyle(`${resources} li`, {
  display: 'flex',
  alignItems: 'center',
  gap: v.space['2'],
  fontSize: v.fontSize.xs,
  minInlineSize: 0,
});
// A violation: impact and rule on the first line; its tag and action wrap below when narrow.
export const a11yItem = style({ flexWrap: 'wrap', rowGap: v.space['1'] });
export const a11yRule = style({ flex: '1 1 9rem', minInlineSize: 0, overflowWrap: 'anywhere' });
export const grow = style({
  flex: 1,
  minInlineSize: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const sliderCtl = style({ inlineSize: '9rem' });
// Same height as the toolbar's sm buttons so a switch + label lines up with them.
export const ctl = style({
  display: 'inline-flex',
  alignItems: 'center',
  alignSelf: 'center',
  blockSize: '1.75rem',
  gap: v.space['2'],
  fontSize: v.fontSize.xs,
  lineHeight: 1,
});
export const empty = style({
  padding: v.space['8'],
  textAlign: 'center',
  color: v.color.textMuted,
  border: `1px dashed ${v.color.border}`,
  borderRadius: v.radius.lg,
});
export const chartBox = style({ inlineSize: '100%', blockSize: '16rem' });
// Storybook panel: exactly the iframe's height, the stage takes whatever the toolbar leaves.
export const embed = style({
  blockSize: '100vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});
// Toolbar groups centre their items, so status badges, toggle groups, buttons and
// switches share one midline.
globalStyle(`${insToolbar} > *`, { alignItems: 'center' });
