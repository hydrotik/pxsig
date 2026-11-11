### Breaking changes

- **Masks over half a capture, or on the story root, fail the entry, and no approval passes it.**
  All of an entry's masks together over 50% of the capture, or a mask the capture found on the
  story root (or one over 95% of the capture), fail the entry with `masks cover 62% of the capture,
  over 50%` or `a mask covers the story root: …` and `masksBlocked` on the row. That depends on the
  render alone, and no baseline is written from such a render (nor from one whose capture reports
  a mask it may not apply as asked, `problems` in the masks record): not by the dashboard's approval,
  `check --update`, `pxsig baseline` or `--allow-masks`. The 25% warning now weighs all of an
  entry's masks together (`masksCoverage`). summary.md has a line for each; `check --sarif` reports
  them as `pxsig/mask-limit` (error), `pxsig/masks-changed` and `pxsig/large-mask` (warnings, one
  per entry instead of one per mask).
  To update: make each such mask smaller (mask the value, not the component), or give the story
  fixed data instead (`pxsig help volatile`).
- **`check --update` and `pxsig baseline` refuse a masks change without `--allow-masks`.** An entry
  whose masks differ from the baseline it replaces is not written and is named with what changed
  (`masks changed (1 added: …)`); `--allow-masks` alone writes every such entry, with ids those, and
  names each one written. The engine's `baseline --json` answers `failedIds` and `masksChanged`.
  `check --update` no longer logs an approval for an entry it did not write.
  To update: review the masks, then add `--allow-masks` (or `--allow-masks <ids>`) to the
  `check --update` or `pxsig baseline` command.

### Behaviour changes

- **Every baseline records its masks.** A `.psig` written from a render with no masks has
  `masks: { "v": 1, "masks": [] }` in its header, so a mask added later is always "masks changed".
  Every writer records them, `pxsig capture` included; a `.pxsig.json` baseline cannot, so writing
  one from a render with masks is refused. Each mask also keeps its `count`, its boxes (`rects`)
  and its pixels (`px`), and the header the masks' share together (`coverage`). Against a baseline
  written by 0.7.6 or earlier (no `masks`), a story's `ignore` is left out only where the
  baseline image shows it painted; anywhere else it is "masks changed: added".
  To update: nothing to do for most stores. Entries whose story masks a 0.7.6 baseline does not
  show painted read "masks changed" once: review and approve them.
- **A masks change is any change.** "masks changed" now also covers a mask that grew by any pixel
  (was: over 0.1% of the capture), one whose boxes moved by more than a pixel (`moved`), and one
  that matches another number of elements (`count`); `masksChanged` gains `moved` and `count`.
  The dashboard's Masks section names them (Moved, Count changed) and says when no approval passes
  the entry.
  To update: nothing to do; an entry that reads "masks changed" for one of these is approved once.
- **Trim keeps masks.** The mask colour (`#FF00FF`) is content when a render is trimmed, so a mask
  in the bottom-right corner is no longer cropped away, and a component that grows under it
  changes the trimmed size. A mask over the whole capture no longer trims it to 16 × 16.
  To update: entries whose story mask reaches the capture's bottom-right corner change size once:
  review and approve them.
