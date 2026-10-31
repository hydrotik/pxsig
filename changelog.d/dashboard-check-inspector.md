### Behaviour changes

- **`pxsig dashboard check` records a screen whose layout never held still.** Such a screen gets
  `"settled": false` in `report.json` and is listed under "Still moving" in `summary.md`. The
  field is absent for every other screen, so existing readers see no change. A screen listed there
  has an animation or a resize that runs longer than 2 s.
  To update: nothing to do; a reader of `report.json` may treat a missing `settled` as `true`.

### Fixed

- **`pxsig dashboard check` screenshots of the inspector are taken after its diff is drawn.** The
  screenshot used to be taken as soon as the screen's landmark appeared, while the inspector was
  still loading, analysing and fitting its images, so two runs on the same build could differ on
  the 7 inspector and embed screens. The inspector now marks its stage `aria-busy` until it has
  settled, and `dashboard check` waits for that (up to its usual 10 s), then for every image to
  decode. Nothing visible changes; a screen reader also learns that the stage is still loading.
- **`pxsig dashboard check` waits for the layout to hold still before each screenshot.** A chart
  that resizes a moment after it first draws (a debounced resize observer, as in Recharts) was
  captured at its first size. The screenshot now waits until no element has moved for 6 frames
  (about 100 ms), for at most 2 s. The whole check takes about the same time.
