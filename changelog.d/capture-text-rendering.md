### Behaviour changes

- **Captures draw text in grayscale, with unhinted glyph advances, and raster every tile in full.**
  Every Chromium pxsig launches (checks, `pxsig serve`, `pxsig manifest`, `pxsig dashboard check`)
  now runs with `--disable-lcd-text --font-render-hinting=none --disable-partial-raster`. On Linux,
  and so in the container and on most CI runners, text was drawn with LCD subpixel antialiasing
  (coloured fringes) and advances rounded to whole pixels (narrower text than macOS draws), so a
  render did not look like the Storybook story it came from. pxsig's container image now sets the
  same text settings in fontconfig (`rgba=none`, `hintstyle=hintnone`, `antialias=true`,
  `lcdfilter=none`) from its next build, which also covers a browser server started from it.
  Renders also differed between runs at antialiased edges: a change after the first raster (a web
  font swapping in, a canvas drawn, a click or scroll) re-rastered only part of a tile, which
  draws a rounded corner at a fractional position slightly differently, and whether it landed
  before or after the first raster was timing. Each render records the arguments in its
  environment (`browser.launchArgs`), and the new `capture.launchArgs` adds a project's own after
  pxsig's, so a later value of the same switch wins (docs/configuration.md, "Text rendering").
  To update: baselines shift once, where they show text (on Linux) and at some rounded edges, and
  every baseline reports `env-mismatch` (`browser.launchArgs`) until it is re-rendered. Re-render
  them all and approve them in one pull request (with `env.strict` or `--strict-env`, run that
  check without it). Baselines rendered on macOS change little or not at all; re-render them there
  too to clear the mismatch.
