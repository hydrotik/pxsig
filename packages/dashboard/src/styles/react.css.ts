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

/** The narrowest the Compiler table's File column gets: about 14 characters of a path. */
const FILE_MIN = '14ch';

/** A file path in its table cell: one line, cut at the end; the full path is its title. */
export const fileCell = style({
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontFamily: v.font.mono,
});

/** Measures FILE_MIN in the cell's font (file-column.tsx); takes no room and is never seen. */
export const fileProbe = style([
  fileCell,
  { position: 'absolute', inlineSize: FILE_MIN, visibility: 'hidden', pointerEvents: 'none' },
]);

/** Holds the table and the probe. */
export const fileTable = style({ position: 'relative' });
