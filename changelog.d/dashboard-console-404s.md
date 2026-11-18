### Fixed

- **The dashboard no longer logs 404 errors on load.** Its page declares an empty icon, so the
  browser no longer asks the server for a `/favicon.ico` it does not have. `pxsig dashboard
  check`'s sample server now answers the sample entry's diff page as the engine writes one, so the
  inspector's Files section shows its size instead of `missing`.
- **`pxsig dashboard check` shows real signature images.** Its sample server served the sample
  diff for the inspector's baseline and current signatures and cell heatmap, drawn square from a
  wide image. The check now has the engine make them from the sample images once, as a check
  writes them (square), in a temporary folder; without the engine the diff stands in as before.
  The check's inspector screens show the new thumbnails.
