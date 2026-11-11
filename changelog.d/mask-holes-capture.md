### Breaking changes

- **`data-volatile` marks a leaf, with a reason.** The attribute may mark only an element with
  text and inline formatting inside (`span`, `b`, `i`, `em`, `strong`, `code`, `time`, `abbr`,
  `sub`, `sup`, `small`, `mark`, `br`, `wbr`), and its value, the reason, is required. Otherwise the
  element is not painted, and the capture records the problem (`problems` in `<id>.masks.json`):
  the entry fails as `mask on a container: …` or `mask needs a reason: …`, naming the element,
  and no approval passes it.
  To update: move `data-volatile` onto the element that shows the value, and give it a reason
  (`data-volatile="relative time"`).

### Behaviour changes

- **A mask paints only the masked element.** Its box is painted at the element's own place in the
  page, so an open popover or tooltip above a masked element is captured and compared instead of
  painted over. Where that cannot be exact (an image or form control, a faded or filtered parent, a
  static element with offsets or absolutely positioned children), it is painted over everything,
  as before. Only the elements measured just before the screenshot are painted: an element a mask
  matches only at the screenshot, or a mask on more than 500 elements, is a problem
  (`mask not measured: …`) instead of a mask that was never weighed. A mask on the story root (the
  root, or an element that is all of its content) is recorded as `root`.
  To update: nothing to do; entries with a popover over a masked element read as changed once
  (the popover is now in the capture): review and approve them.
- **Text is left out of the text record only where a mask is painted.** An element a mask selector
  matches but does not paint (nothing of it in the frame, a container `data-volatile`) keeps its
  text in the record.
  To update: nothing to do.
