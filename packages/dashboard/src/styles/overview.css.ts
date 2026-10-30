/** The Overview: story cards, their groups and thumbnails, and the scenario list. */
import { globalStyle, style } from '@vanilla-extract/css';
import { tokens as v } from '../ui/tokens';
import { checker } from './base.css';

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
// A card that is not itself a control (it holds one: the re-check of a render error).
export const storyCardStatic = style({
  cursor: 'default',
  selectors: { '&:hover': { borderColor: v.color.border } },
});
// A status edge on each card, so problems stand out while scrolling.
const edge = (color: string) => ({
  borderInlineStartColor: color,
  borderInlineStartWidth: v.line.emphasis,
});
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
globalStyle(
  `button:hover ${affordance}, a:hover ${affordance}, button:focus-visible ${affordance}`,
  { color: v.color.accent }
);
// StatPanel's clickable cards are not a positioning context yet (until the pattern moves into the
// design system); its filter and link cards render as button and a.
export const statCards = style({});
globalStyle(`${statCards} button, ${statCards} a`, { position: 'relative' });
// The icon slot beside the label would take room the label needs; the affordance sits in the corner.
globalStyle(`${statCards} span:has(> ${affordance})`, { display: 'contents' });
globalStyle(`${statCards} :is(button, a) > span:has(${affordance})`, {
  paddingInlineEnd: v.space['5'],
});

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
    '&:nth-of-type(odd)': {
      backgroundColor: `color-mix(in srgb, ${v.color.text} 4%, transparent)`,
    },
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
globalStyle(`${thumb} img`, {
  position: 'absolute',
  inset: 0,
  inlineSize: '100%',
  blockSize: '100%',
  objectFit: 'contain',
});
export const thumbMask = style({ mixBlendMode: 'normal', opacity: 0.85 });
export const cardBody = style({
  display: 'flex',
  flexDirection: 'column',
  gap: v.space['1_5'],
  padding: v.space['2_5'],
});
export const cardId = style({
  fontFamily: v.font.mono,
  fontSize: v.fontSize.xs,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const cardStats = style({
  display: 'flex',
  gap: v.space['3'],
  fontFamily: v.font.mono,
  fontSize: v.fontSize['2xs'],
  color: v.color.textMuted,
});

// --- scenario list ----------------------------------------------------------
export const scenarioLayout = style({
  display: 'grid',
  gap: v.space['4'],
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 20rem), 1fr))',
  alignItems: 'start',
});
export const scenarioList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: v.space['1'],
  maxInlineSize: '24rem',
});
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
    '&[aria-pressed="true"]': {
      borderColor: v.color.accent,
      backgroundColor: `color-mix(in srgb, ${v.color.accent} 8%, transparent)`,
    },
    '&:focus-visible': {
      boxShadow: `0 0 0 3px color-mix(in srgb, ${v.color.focus} 50%, transparent)`,
    },
  },
});
