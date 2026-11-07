### Fixed

- **The "Review complete" summary keeps a long `pxsig check …` command inside its dialog.** With
  several rejected entries with long ids, a design system whose dialog lays its content out in a
  grid (the hydrotik adapter) let the summary grow as wide as the command: the dialog scrolled
  sideways to the focused Copy button, so the title and the labels went out of view and the Copy
  tooltip appeared outside the dialog. The summary now shrinks to the dialog's width; the command
  is shortened with an ellipsis (or wraps, on adapters that wrap it) and Copy still copies all of
  it.
