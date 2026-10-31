### Security

- **A release fails on a known advisory in anything it ships.** The release scans its SBOMs (the
  npm install tree, the packages the dashboard bundle inlines, and the engine's crates) with a
  pinned osv-scanner, so a package that only the dashboard bundle contains, which no `npm audit`
  sees, is checked too. A dashboard attached to the GitHub release must now carry the `BUILD.json`
  its build writes, naming its adapter and design-system commit; one without it fails the release
  instead of shipping with a warning.
