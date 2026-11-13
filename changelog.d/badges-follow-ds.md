### Behaviour changes

- **UI contract 1.6.0: a badge may show its tone as its design system draws it.** Region rule R4
  now allows either, for `Badge` only: a tone colours the badge's text, or its wash, border and
  dot, in that tone's own colour. `pxsig dashboard check`'s `tone` rule lets a badge pass whose
  wash, border, background or shadow is in the tone it was given, still fails one drawn in another
  tone's colour, and now also fails a badge whose text is under WCAG AA (4.5:1) on its background.
  To know a badge's tone in any adapter, the dashboard adds `pxsig-ui-tone-<tone>` to its
  `className`. Stat cards, status badges and top-bar counts keep R4 as it was. The plain adapter
  is unchanged (the tone colours the text).
  To update: nothing to do for an adapter that keeps the tone in the badge's text. An adapter that
  wants its design system's tinted badges may now use them: keep `className` on the badge's root,
  use the tone's own colour for the wash, border and dot, keep the text at 4.5:1 on the wash, and
  set `"contract": "1.6.0"` in its conformance.json. Run `pxsig dashboard check` on its build.

### Changed

- **The bundled dashboard's badges follow its design system.** The reference adapter draws a
  `success`, `warning` or `danger` badge as the design system's own tinted variant (a wash, a
  border and a dot in the tone's colour, the text in the tone's colour); `emphasis` does not change
  those. `neutral` and `info` badges are drawn as before.
