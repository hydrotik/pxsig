### Behaviour changes

- **`pxsig dashboard check` measures only an open modal dialog.** While a modal `<dialog>` is open,
  the layout findings leave out the page behind it, which is inert. The plain adapter's review
  session reported a button behind its dialog as covered by one inside it.
  To update: nothing to do; a check of an adapter whose dialog is a native modal can list fewer
  findings.

### Changed

- **The inspector's sliders sit on one line.** On the reference dashboard, Tolerance and the swipe,
  opacity and cell sliders show their label, track and value on one line at the toolbar's control
  height, instead of the label over the track, so the inspector toolbar is one even row.
- **The plain adapter and the fallbacks share one control height.** Buttons are 2rem, and 1.75rem
  in a `sm` toolbar; selects, search fields, segmented choices and the fallback slider are 1.75rem.
  The fallback `Toolbar` sets `data-size` on its root, for a stylesheet that sizes an adapter's own
  controls from it.

### Fixed

- **Two accessibility findings on the plain adapter.** The chart table's corner is a cell, not an
  empty column header (axe `empty-table-header`), and the Coverage tab's figures are a region named
  "Coverage summary", apart from the Coverage banner (axe `landmark-unique`).
- **A switch and its text are one control.** In the inspector toolbar each switch's label carries
  `data-control`, so `pxsig dashboard check` measures it at the toolbar's height rather than the
  switch alone.

### Documentation

- **docs/ui/build-adapter.md:** a slider in a toolbar is one line with `data-control`; a control
  made of parts is measured as its outermost `data-control`; the page behind a modal dialog is not
  measured.
