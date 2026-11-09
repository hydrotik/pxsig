### Changed

- **Package metadata for registry scanners.** `pxsig`, `@pxsig/storybook-addon` and the
  `@pxsig/cli-<platform>-<arch>` packages name their website (`homepage`) and bug tracker
  (`bugs`); the platform packages also name their author. Each platform package now has an entry,
  `require('@pxsig/cli-<platform>-<arch>')`, which gives its binary's path, and a self-test,
  `node --test` in its folder, which runs the binary once (`--version`). pxsig still finds the
  binary by its path, so installs work as before. Scanners such as Socket no longer report these
  packages as empty or as having no author, website, bug tracker or tests.
