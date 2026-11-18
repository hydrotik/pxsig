### Changed

- **The served dashboard loads less code first.** `pxsig serve` now serves the dashboard as
  ES-module chunks: the page with Overview, the shell and the charts first, and the inspector with
  the diff viewer and the Review, Accessibility, Runs and Help sections each in a chunk of its own,
  fetched before it is needed: the ones the address opens on before the first render, the others
  once the page is idle. There is no loading state: the section on screen stays until the next one
  is in. `pxsig report` still writes one classic script, so a static report opens from
  disk as before. Every chunk ships unminified; the npm SBOM names the file each bundled package is
  in (`pxsig:bundled-in`).
