### Documentation

- **README:** the addon needs Storybook 10 or later (it said 9; npm refuses 9 with ERESOLVE). A
  script test now holds every page that names the addon's Storybook version to its peer floor.
  The quick start says `manifest` and `check` take a running Storybook or a static build in
  `storybook.staticDir`, and that `serve` prints the dashboard's link on Windows instead of
  opening it; QUICKSTART says the same of `--open`.
- **npm README, Network:** commands reach this workspace's dashboard server at `PXSIG_URL`, else
  the address `pxsig serve` recorded, else `server.port`; a server for another workspace is not
  used.
- **docs/migrating.md:** an "Upgrading to 0.6" section. **docs/architecture.md:** the browser and
  clipboard helpers, the addon's server check, and how pxsig checks its own dashboard.
