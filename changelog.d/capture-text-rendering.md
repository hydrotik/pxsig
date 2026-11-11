### Behaviour changes

- **Captures draw text in grayscale, with unhinted glyph advances.** Every Chromium pxsig launches
  (checks, `pxsig serve`, `pxsig manifest`, `pxsig dashboard check`) now runs with
  `--disable-lcd-text --font-render-hinting=none`. On Linux, and so in the container and on most CI
  runners, text was drawn with LCD subpixel antialiasing (coloured fringes) and advances rounded to
  whole pixels (narrower text than macOS draws), so a render did not look like the Storybook story
  it came from. pxsig's container image now sets the same in fontconfig (`rgba=none`,
  `hintstyle=hintnone`, `antialias=true`, `lcdfilter=none`) from its next build, which also covers
  a browser server started from it. Each render records the arguments in its environment
  (`browser.launchArgs`), and the new `capture.launchArgs` adds a project's own after pxsig's, so a
  later value of the same switch wins (docs/configuration.md, "Text rendering").
  To update: baselines rendered on Linux shift once, where they show text, and every baseline
  reports `env-mismatch` (`browser.launchArgs`) until it is re-rendered. Re-render them and approve
  them in one pull request (with `env.strict` or `--strict-env`, run that check without it).
  Baselines rendered on macOS change little or not at all; re-render them there too to clear the
  mismatch.
