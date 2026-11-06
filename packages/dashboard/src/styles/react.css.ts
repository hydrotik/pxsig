/** Diagnostics › React (views/react/): the progress row of a run going on, as the review session's bar. */
import { style } from '@vanilla-extract/css';
import { tokens as v } from '../ui/tokens';

/** A run's bar: the bar takes the room, its count and its button (Skip, Cancel) after it. */
export const runBar = style({
  display: 'flex',
  alignItems: 'center',
  gap: v.space['3'],
  fontSize: v.fontSize.sm,
});
