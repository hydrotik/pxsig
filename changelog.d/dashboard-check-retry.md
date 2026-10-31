### Behaviour changes

- **`pxsig dashboard check` records a page load it retried.** Such a screen gets
  `"retried": "ERR_NO_BUFFER_SPACE"` in `report.json` and is listed under "Retried" in
  `summary.md`. The field is absent for every other screen, so existing readers see no change. A
  screen listed there loaded on the second try.
  To update: nothing to do.

### Fixed

- **`pxsig dashboard check` no longer fails a screen when Windows runs out of socket buffers.**
  With several screens loading at once, Windows could refuse a page load with
  `net::ERR_NO_BUFFER_SPACE`, and the screen failed although nothing was wrong with it. That
  load is now retried once, after 500 ms. Any other error, or the same error twice, still fails
  the screen.
