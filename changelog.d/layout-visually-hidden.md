### Fixed

- **`pxsig dashboard check`'s layout rules skip visually hidden elements.** An element clipped to
  nothing (`clip-path: inset(50%)`, or `clip: rect(0 0 0 0)`) draws none of itself, but its
  overflow counted as clipped content, so a slider's range input (Base UI hides it in the thumb at
  the thumb's size) read as "cuts off its content" once the thumb was narrower than a range input's
  minimum width. Such elements no longer count for any layout rule; one clipped only in part still
  does.
