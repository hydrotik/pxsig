### Breaking changes

- **`pxsig dashboard build` with no adapter configured now builds the plain adapter.** It used to
  pick the `hydrotik` reference adapter, which needs a checkout of a design system that is not
  public, so the build failed everywhere but on the maintainer's machine. The order is now `--ui`,
  `PXSIG_UI_ADAPTER`, `dashboard.ui` in `pxsig.config.json`, `hydrotik` when `PXSIG_DS_SOURCE` is
  set, then `plain`; the build prints which rule picked the adapter. The prebuilt dashboard in the
  npm package is unaffected.
  To update: for the reference look, pass `--ui hydrotik` or set `PXSIG_DS_SOURCE`.

### Added

- **A built-in `plain` UI adapter** (`dashboard/src/ui/adapters/plain/`): the dashboard on semantic
  HTML and one stylesheet, by name with `--ui plain`. It is the same adapter as
  `examples/custom-ui/pxsig-ui`, which stays as the example of a project's own adapter.
