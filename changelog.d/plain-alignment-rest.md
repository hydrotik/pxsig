### Fixed

- **The plain build's top bar, tables, heatmap legend and dialogs sit on whole pixels.** The section
  links (22px lines) and More (18px, a flex item) centre on whole pixels in the bar, and so does the
  More menu under it; the fallback table's header row is a whole pixel tall (separate borders, an
  18px line); the fallback heatmap's legend has a 16px line, so its swatches centre on whole pixels
  and on the capitals; a modal dialog is centred on a whole pixel, not by the browser's auto margins.
  The hydrotik build is unchanged.
