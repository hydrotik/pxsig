### Behaviour changes

- **A mask covers every whole pixel its box touches.** A box with a fractional edge (common with
  unhinted text and `letter-spacing`) was recorded with its edges rounded, and painted on the same
  rounded pixels, so the pixel its edge only partly covered was neither painted nor flagged as
  content outside the box: up to half a pixel of the masked value was compared, and a check could
  pass or fail by which value rendered. Now the record, the paint and the overflow check use one
  definition: on the captured image's pixel grid, the left and top edges are floored and the right
  and bottom edges ceiled, then clipped to the capture. An element painted over everything gets a
  box of pxsig's own at those pixels too. The grid is the image's own: an element screenshot
  starts at the whole pixel left of and above the element, not at its fractional position. A mask
  never covers a pixel its box does not touch, and is never widened to cover content outside it.
  The record keeps whole CSS pixels; a mask with whole-pixel edges is unchanged.
  To update: part of the one re-approval under "Captures draw text in grayscale": approve the
  entries marked "masks changed: grew" with `--allow-masks`.
