### Added

- **`pxsig serve --link --open`.** Opens the new dashboard link in the default browser as well as
  printing it, so a person at a terminal does not copy it by hand: on macOS an open Chrome tab on
  the dashboard is reused, else `open`; on Linux `xdg-open`; on Windows nothing is started and the
  link is only printed. Refused like `--link` outside a person's terminal (exit 3). `pxsig serve
  --open` without `--link` is a usage error (exit 2): `pxsig serve` already opens a tab unless
  `--no-open`.

### Changed

- **`pxsig serve` says when it could not open a browser.** A missing or failing `xdg-open` or
  `open` at start printed nothing; it now prints one line saying to open the link above.
