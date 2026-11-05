### Changed

- **An approval no longer waits behind an integrity pass.** `pxsig serve` runs a second engine
  process for tracing edited files, so a capture, comparison or decision is answered while a pass
  traces; before, it queued behind every file the pass traced (seconds on a large store). The
  server now has two `pxsig` engine child processes instead of one; both stop with the server.
