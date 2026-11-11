### Fixed

- **The plain adapter colours every badge tone.** Its `Badge` drew `warning` and `info` in the
  ordinary text colour; each tone now colours the badge's text in that tone's colour (`info`: the
  accent), as region rule R4 says, with the wash, border and fill left neutral (`solid` still draws
  as `subtle`). Each tone colour meets WCAG AA as text on the page, card and badge backgrounds in
  both themes. The same change is in `examples/custom-ui`.
