/**
 * The side panel's plain layout (side-panel.tsx): the panel beside the main area while both fit
 * (the main area keeps 40rem, the panel 20rem), overlaid on the main area from the end edge below
 * that, the main area keeping its full width underneath. Overlaid, the panel is as tall as the main
 * area and its body scrolls under its heading, so it never makes the page scroll. A container query on the layout, not the
 * viewport, so the panel follows the room the page gives it.
 */
import { style } from '@vanilla-extract/css';
import { tokens as v } from '../tokens';

/** Below this the main area and the panel no longer fit side by side. */
const NARROW = '(inline-size < 60rem)';

export const layout = style({
  containerType: 'inline-size',
  position: 'relative',
  display: 'flex',
  alignItems: 'flex-start',
  gap: v.space['4'],
});

export const main = style({ flex: '1 1 0', minInlineSize: 0 });

export const panel = style({
  flex: '0 0 20rem',
  minInlineSize: 0,
  '@container': {
    [NARROW]: {
      position: 'absolute',
      insetBlock: 0,
      insetInlineEnd: 0,
      zIndex: 4,
      inlineSize: 'min(20rem, 100%)',
      boxShadow: `0 ${v.space['2']} ${v.space['6']} color-mix(in srgb, ${v.color.text} 18%, transparent)`,
    },
  },
});

/** The panel's content under its heading: it scrolls when the overlaid panel is shorter. */
export const body = style({
  display: 'flex',
  flexDirection: 'column',
  gap: v.space['3'],
  flex: 1,
  minBlockSize: 0,
  overflowY: 'auto',
});
