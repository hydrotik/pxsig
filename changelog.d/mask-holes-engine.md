### Breaking changes

- **Masks over half a capture, or on the story root, fail the entry, and no approval passes it.**
  All of an entry's masks together over 50% of the capture, or a mask the capture found on the
  story root that covers 95% of the capture or more (a smaller one is weighed by its share), fail
  the entry with `masks cover 62% of the capture, over 50%` or `a mask covers the story root: …`
  and `masksBlocked` on the row. That depends on the
  render alone, and no baseline is written from such a render (nor from one whose capture reports
  a mask it may not apply as asked, `problems` in the masks record): not by the dashboard's approval,
  `check --update`, `pxsig baseline` or `--allow-masks`. The 25% warning now weighs all of an
  entry's masks together (`masksCoverage`), and so do the dashboard's Large mask badge (its title
  names the masks and their share together), the Open items row and the Review Stories filter
  "Masks over 25% of the capture" (were: one mask over 25%). summary.md has a line for each;
  `check --sarif` reports them as `pxsig/mask-limit` (error), `pxsig/masks-changed` and
  `pxsig/large-mask` (warnings, one per entry instead of one per mask), and its `[check] wrote …`
  line counts them that way: entries over the mask limits, with masks changed and with large
  masks (was: each mask over 25% on its own, the other masks results counted as a11y violations).
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
- **A blocked entry says what to do, and the dashboard does not offer Approve.** Every refusal and
  every line about masks no approval passes names the fix for its cause: `make the masks smaller`
  (over 50%), `mask the value, not the story root`, `give data-volatile a reason, e.g.
  data-volatile="relative time"`, `put data-volatile on the element that shows the value (a
  leaf)` (was: `reduce the masks` or `until the masks are smaller` for every cause), in the
  engine's refusal, `[check] mask:`, SARIF and the tools. In the inspector, Approve is disabled on
  such an entry with that line as its title, the A key sends nothing, Approve story leaves it out,
  and the Masks section shows the line also when no mask was painted (a `data-volatile` with no
  reason or on a container).
  To update: nothing to do.
- **A refused request leaves the dashboard usable.** A refused decision or re-check in the
  inspector is said under its header; a card's re-check, and the React analysis' Skip, Cancel,
  Measure and Analyse, say it beside their button. None is a browser alert any more, which held
  the page with the button reading "Approving…" until it was closed.
  To update: nothing to do.
- **The engine's result cache names the engine build.** A cached verdict is reused only by the
  build that wrote it (the hash of its executable), so two builds of one version, a pull
  request's and main's, never reuse each other's verdicts.
  To update: nothing to do; the first check after an upgrade runs uncached.
