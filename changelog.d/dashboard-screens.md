### Added

- **A manifest can say its entries are the dashboard's own screens.** `"source":
  "dashboard-screens"` at the top of a store's manifest (docs/spec.md, section 6) marks the pxsig
  dashboard's own screens, which the pxsig repository checks with `scripts/screens-check.mjs`
  against baselines in `packages/dashboard/.pxsig/`. For such a project nothing fetches a Storybook,
  its components are the dashboard's sections, the dashboard shows no Storybook link and no
  Re-check, and `pxsig check` refuses it with the command to run instead. A manifest without
  `source` is a story project, as before.

### Documentation

- **docs/releasing.md, "pxsig's own baselines":** how the dashboard's screens are checked,
  reviewed and approved.
