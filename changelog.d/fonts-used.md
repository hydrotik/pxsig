### Behaviour changes

- **A font swap is an environment mismatch.** A Chromium render now records the faces its text was
  drawn in (`<id>.fonts.json`; a baseline keeps them in its `.psig` header as `fonts`). A face is
  named only when the page's own CSS lists it or it is a web font; any other face, the operating
  system's fallback, is kept as a digest and shown as "a system fallback font". When a render drew
  a face its baseline's did not, or not one it did, the row is a `mismatch` with `fonts.used` in
  `envDiff` and the faces in `envFontsUsed`: the `env` line, `summary.md`, `pxsig doctor`, the
  dashboard's coverage banner, `pxsig entry` (an Environment line) and MCP `pxsig_entry`
  (`envFontsUsed`, `envLine`) name them, e.g. `fonts.used: +Arial, −a system fallback font`. The
  row's text is not compared (`textDiff.state` `env-differs`), so a swap is never labelled a copy
  change, and `--strict-env` fails the run after rendering (exit 2). Before, such a render read as
  a pixel change in the same environment. One exception: when the text record shows a copy change
  and the only difference is system fallbacks added (new text in a character the page's fonts
  lack), the row stays a copy change, the `env` line notes `+ a system fallback font for new text`,
  and `--strict-env` does not fail it; a face removed, or a named face added, is still a swap.
  Firefox and WebKit renders record no fonts. `env.ignore:
  ["fonts.used"]` leaves the comparison out.
  To update: nothing to change; baselines record fonts on their next approval, and until then they
  compare as unknown and nothing is said.
