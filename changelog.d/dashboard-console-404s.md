### Fixed

- **The dashboard no longer logs 404 errors on load.** Its page declares an empty icon, so the
  browser no longer asks the server for a `/favicon.ico` it does not have. `pxsig dashboard
  check`'s sample server now answers the sample entry's diff page as the engine writes one, so the
  inspector's Files section shows its size instead of `missing`.
