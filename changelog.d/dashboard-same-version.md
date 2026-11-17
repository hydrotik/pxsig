### Behaviour changes

- **A dashboard build is served only by the pxsig version that built it.** `pxsig serve` already
  passed over a project's `dashboard.ui` build from another version; it now does the same for a
  build in `PXSIG_DASHBOARD_DIR` (by its `pxsig-build.json` stamp, or the `BUILD.json` of a
  reference build) and for a build that records no version. It serves the prebuilt dashboard and
  prints one line with the command that rebuilds it. `pxsig doctor` reports such a build as the
  setup problem `dashboard-stale`, with the same command. The reference build's `BUILD.json`
  records the pxsig version (`pxsig`).
  To update: after upgrading pxsig, run `pxsig dashboard build` again (only if you build a custom dashboard or set PXSIG_DASHBOARD_DIR).
