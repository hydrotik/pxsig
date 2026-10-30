### Added

- **The prebuilt dashboard records how it was built.** `dist/dashboard/BUILD.json` in the `pxsig`
  package names the UI adapter, the design-system commit (and whether its checkout had changes),
  the lockfile hashes, the Node version, the build time and the third-party packages compiled
  into the bundle with their versions and licences. The release's `pxsig-npm.cdx.json` now lists
  those packages too. Nothing to do; nothing reads the file at run time.
