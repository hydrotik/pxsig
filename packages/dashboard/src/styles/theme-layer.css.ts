/**
 * pxsig's theme layer: every dashboard rule that changes how a design-system element looks, and the
 * declared exceptions on the dashboard's own markup, one named export per entry. Each entry is
 * declared in theme-layer.json (what it changes, why, its decision, the crops and baselines that show
 * it), and `pnpm ui:check` holds the two together (ui-tools/theme-layer.mjs, rule L). Nothing else in
 * the dashboard changes a design-system element (ui-tools/ds-reach.mjs). A look another consumer
 * would want too is a design-system variant instead, which the adapter selects by a contract prop.
 */
import { globalStyle, style } from '@vanilla-extract/css';
import { tokens as v } from '../ui/tokens';

// L1 dialog-title-focus-target
// The inspector's and the gate report's title is the dialog's starting point, focused by script
// (tabIndex -1, initialFocus) so the dialog's keys work at once. It is not a control: no focus line.
export const dialogTitleFocusTarget = style({ outline: 'none' });

// L2 report-description-size
// The gate report's description at the size of the report body's own running text.
export const reportDescription = style({ fontSize: v.fontSize.sm });

// L3 story-card (an exception to decision 35)
// The dashboard's own card: on keyboard focus the border turns the focus colour, with a 3px halo.
// The transparent outline paints nothing, but forced-colors mode draws it (the halo and the border
// colour are dropped there).
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
      outline: '1px solid transparent',
      outlineOffset: '-1px',
    },
  },
});

// L4 more-menu-current
// The More menu's current section: semibold in the accent colour, beside the design system's marker.
export const moreMenuCurrent = '[role="menuitem"]:is(a)[aria-current="page"]';
globalStyle(moreMenuCurrent, { fontWeight: v.fontWeight.semibold, color: v.color.accent });

// L5 progress-one-line
// A progress bar in a flex row takes the free width, its label on one line cut with an ellipsis.
export const progressGrow = style({
  flex: 1,
  minInlineSize: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
