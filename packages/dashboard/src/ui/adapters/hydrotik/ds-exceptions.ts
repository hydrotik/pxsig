/**
 * Alignment exceptions for design-system components, each with the design system's cause
 * (`pxsig dashboard check`'s `aligned` and `whole-pixel` rules: docs/ui/build-adapter.md). The
 * misalignment is the component's own, measured in its own Storybook story too, so pxsig does not
 * redraw it: the opt-out names the cause, and goes when the design system fixes it. Scoped to the
 * alignment rules only (`aligned, whole-pixel: …`), so every other layout rule still applies.
 */
type Allow = { 'data-layout-allow': string };
const allow = (rules: string, reason: string): Allow => ({
  'data-layout-allow': `${rules}: ${reason}`,
});

/** StatusBadge centres its icon on its 12px line box: 0.5–0.6px below the capitals. */
export const statusBadgeAllow = allow(
  'aligned',
  "the design system's StatusBadge centres its icon on the line box, not the capitals"
);
/** Select's chevron sits off its label's capitals (1px low in its story, 1.5px high at sm). */
export const selectAllow = allow(
  'aligned',
  "the design system's Select trigger places its chevron off the label's capitals"
);
/** CopyValue's value and button sit on a half pixel (its 19.5px line), the icon 1px low. */
export const copyValueAllow = allow(
  'aligned, whole-pixel',
  "the design system's CopyValue sits its value and icon on a 19.5px line box"
);
/** CardHeader is 0.5px off a whole height (CardDescription's 19.5px line), so all below it is too. */
export const cardHeaderAllow = allow(
  'whole-pixel',
  "the design system's CardDescription has a 19.5px line height, so the card's content starts on a half pixel"
);
/** DialogContent is centred by a translate(-50%), which lands on a half pixel at an odd size. */
export const dialogAllow = allow(
  'whole-pixel',
  "the design system's DialogContent is centred with translate(-50%, -50%)"
);
/**
 * DataGrid: the Columns icon on its 21px line box (0.9px high), its rows' 1px separator inside the
 * row's height (content centred in an odd space), its footer after a fractional sibling.
 */
export const dataGridAllow = allow(
  'aligned, whole-pixel',
  "the design system's DataGrid centres cell content in rows whose height includes their 1px separator, and its Columns icon on the line box"
);
/** AlertTitle is 16.25px tall (line height 1.25 at 13px), AlertDescription 22.75px: all after them is off. */
export const alertAllow = allow(
  'whole-pixel',
  "the design system's AlertTitle and AlertDescription have 16.25px and 22.75px line heights"
);
