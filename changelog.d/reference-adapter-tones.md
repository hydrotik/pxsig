### Changed

- **The bundled dashboard shows a tone one way.** pxsig's own dashboard (the reference adapter)
  now keeps region rule R4: a badge draws its text in the tone's colour over a neutral wash and
  border (it was a tinted wash and border), a stat card colours its value (it was a coloured start
  edge with the value in the text colour), and a top-bar count that asks for action draws its
  digits in the accent on a neutral pill (it was an accent fill). Every tone meets WCAG AA as text
  on its background in both themes. `pxsig dashboard check` on it now reports no region-rule
  finding.
- **The plain adapter's top-bar counts take their tone.** A count that asks for action ("Review
  Stories 2") draws its digits in the accent, a plain total in the text colour, as R4 says; the
  plain adapter drew every count the same. The same change is in `examples/custom-ui`.

### Documentation

- **Badges may be micro caps.** Region rule R3 now has a second exception, set by the contract: a
  `Badge` or `StatusBadge` may be drawn in tracked micro caps (`text-transform: uppercase`), like a
  stat label; the text passed stays as it is. `pxsig dashboard check`'s `casing` rule lets an
  uppercase badge pass and still fails any other re-casing, of a badge or anything else. R4 now
  names a `NavLink`'s count: `countTone` colours its digits.
