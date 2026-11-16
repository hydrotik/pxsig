### Behaviour changes

- **A `data-volatile` element's box must hold all of its content.** A mask paints its element's
  box, never more, so anything the value paints outside the box is compared: the check passed or
  failed by which value rendered. Found in pxsig's own examples on Linux: a fixed `width: 4ch`
  under `letter-spacing: 1px` let the last digit paint 3px past the box. The capture now checks the
  pixels after its screenshot, which it leaves as it was: it renders the frame with each
  `data-volatile` element's content hidden, then shown again, and counts any pixel outside the
  painted boxes that differs.
  Such an element is a problem (`overflow` in `<id>.masks.json`): the entry fails as
  `mask content outside its box: <element>: <n> px outside, up to <d> px past its box`, and no
  approval passes it (the fix: let the data-volatile element's box hold all of its content). The
  mask is never widened: what is painted, recorded and compared is still the element's box.
  Selector masks (`ignore`, `capture.ignore`) are not checked. Their elements may be containers
  whose overflow is not the value.
  To update: where an entry fails this way, change the element's CSS so its box holds its content
  (drop a fixed `width`, or allow for the `letter-spacing`, shadow or transform), then check the
  entry again. No baselines change.
