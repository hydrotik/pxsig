### Changed

- **pxsig and the Storybook addon ship a self-test.** Each tarball now holds
  `test/installed/package.test.mjs` (Node built-ins only: no network, browser or engine), as the
  platform packages hold `test/binary.test.js`. In pxsig it checks that `pxsig --version` reports
  the installed version and the shipped UI contract, that every `bin` and `exports` target is in
  the package, and that `pxsig/workspace`, `pxsig/psig`, `pxsig/dashboard` and the UI catalog
  resolve by name; in the addon, that the preset gives Storybook its `managerEntries`,
  `managerHead` and `staticDirs`, that `manager.mjs` parses and every helper it imports is shipped,
  and that the helpers load without Storybook. Run it from a project with
  `node --test "node_modules/pxsig/test/installed/*.test.mjs"` (or the addon's folder). The
  install smoke test now packs and installs the addon too and runs all three self-tests.
