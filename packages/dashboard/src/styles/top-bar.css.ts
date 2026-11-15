/**
 * The top bar (parts/TopBar.tsx): the report's mark, the section links, then the controls pinned
 * at the end. It sits above the scrolling <main>, so it needs no sticky positioning. What shows at
 * a width is measured, not set by breakpoints (parts/top-bar-fit.ts): the bar's root carries
 * `data-collapse` (the end details shed, the label capped) and `data-compact` (the end controls
 * drawn compact), and `--pxsig-scope-max` (the workspace label's width).
 *
 * An element that is not shown is drawn nowhere (`visibility: hidden`, out of flow, so it is out
 * of the tab order and the accessibility tree) but keeps its natural width, which the fit measures
 * to know when it would fit again. It sits at the end group's inline end, so it never widens the page.
 */
import { globalStyle, style } from '@vanilla-extract/css';
import { tokens as v } from '../ui/tokens';

export const navbar = style({ flexShrink: 0 });

const away = {
  position: 'absolute',
  insetInlineEnd: 0,
  insetBlockStart: 0,
  visibility: 'hidden',
  pointerEvents: 'none',
} as const;

// The mark: `pxsig` never truncates; the workspace label after it does, with an ellipsis, its
// full text in its title.
export const brand = style({
  position: 'relative',
  flexShrink: 0,
  margin: 0,
  fontSize: v.fontSize.sm,
  fontWeight: v.fontWeight.semibold,
  whiteSpace: 'nowrap',
});
export const scope = style({
  // An inline block on the heading's line, its top on the line's top: one line box, read as one
  // name ("pxsig • Demo"). `pre`: its leading space (" • Demo") survives the start of its box.
  display: 'inline-block',
  verticalAlign: 'top',
  whiteSpace: 'pre',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxInlineSize: 'var(--pxsig-scope-max, none)',
});
/** The widths the label may take, measured in its own font: its cap and its shortest. */
export const scopeCap = style({ ...away, inlineSize: '24ch' });
export const scopeMin = style({ ...away, inlineSize: '4ch' });
/** The end group's gap, and its tight gap: measured, since a tight bar shows only the latter. */
export const gap = style({ ...away, inlineSize: v.space['2'] });
export const gapTight = style({ ...away, inlineSize: v.space['1'] });

export const navEnd = style({
  position: 'relative',
  // Once every link is in More, the room the list does not need (top-bar-fit.ts, `spare`).
  marginInlineStart: 'var(--pxsig-bar-spare, 0px)',
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  gap: v.space['2'],
  whiteSpace: 'nowrap',
});
/** One end item: a flex box, so its line box does not make it taller than what it holds. */
export const item = style({ display: 'inline-flex', alignItems: 'center', flexShrink: 0 });

// The end details, shed in order (top-bar-fit.ts, DETAILS).
for (const d of ['last-check', 'modes', 'status-beside'])
  globalStyle(`[data-collapse~="${d}"] [data-top-bar="${d}"]`, away);

// The compact controls: each drawn once, full or compact (top-bar-fit.ts, COMPACT).
for (const c of ['review', 'connection', 'status']) {
  globalStyle(`[data-top-bar="${c}-compact"]`, away);
  globalStyle(`[data-compact~="${c}"] [data-top-bar="${c}-compact"]`, {
    position: 'static',
    visibility: 'visible',
    pointerEvents: 'auto',
  });
  globalStyle(`[data-compact~="${c}"] [data-top-bar="${c}-full"]`, away);
}
/** The connection or the review status drawn compact: a glyph in its tone's colour (R4). */
export const glyph = style({
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
  color: v.color.textMuted,
});
globalStyle(`${glyph}[data-tone="success"]`, { color: v.color.success });
globalStyle(`${glyph}[data-tone="warning"]`, { color: v.color.warning });
// The review button's labels sit in the button; the compact one only by itself.
export const label = style({ whiteSpace: 'nowrap' });
// The end group's gaps, tight on the narrowest bars.
globalStyle(`[data-compact~="tight"] ${navEnd}`, { gap: v.space['1'] });
