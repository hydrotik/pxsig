### Added

- **The dashboard names the application under review: `pxsig • <scope>`**, in the top bar and the
  browser tab, so one workspace's dashboard is never taken for another's. A new `label` in
  `pxsig.workspace.json` names the whole workspace (`"label": "hydrotik ds"` reads
  `pxsig • hydrotik ds`); without it the project's `label`, else its name, as before. The dashboard
  data gains `scope` (additive); `pxsig config` prints the title. See
  [the dashboard title](docs/configuration.md#the-dashboard-title).

### Changed

- **The title's separator is `•`** (`pxsig • demo`, was `pxsig · demo`). A project's `label` still
  names it in the project switcher.
