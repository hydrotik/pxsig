### Added

- **Masks in the dashboard.** The inspector has a Masks section listing each mask on the render:
  its selector, where it came from (`data-volatile`, the story, the project, the workspace), its
  reason and its share of the capture; when the masks changed since the baseline, each is marked
  Added, Removed or Grew with its share in the baseline and in the render. The header and the
  entry's card show Masks changed and Large mask (a mask over 25% of the capture). Overview's Open
  items lists the entries with a large mask while there are any, and Review Stories filters them
  ("Masks over 25% of the capture").
- **A masks-only change is not an empty view.** When the masks alone failed an entry and no pixel
  differs by more than the tolerance, the change stepper reads "Masks changed", Pixel Changes says
  "No pixel differs by more than 16. Only the masks changed.", and the Masks section comes first
  in the side panel with the masks before and after.
- **Help: "Values that vary".** `pxsig help volatile` and the dashboard's Help ("Values That
  Vary"): fixed data first (a fixed clock, fixed ids, a fixed hash), then `data-volatile`,
  `capture.ignore` / `capture.addIgnore`, how masks are recorded and reviewed, the 25% warning
  and the one-time "masks changed" approvals on adoption.
