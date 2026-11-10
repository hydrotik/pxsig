### Documentation

- **The platform packages and the Storybook addon have full READMEs on npm.** Each
  `@pxsig/cli-<platform>-<arch>` README says what the package is, that `pxsig` installs it as an
  optional dependency, how pxsig finds the binary (`PXSIG_BIN` first), which hosts have no package,
  and how to verify the binary (`npm audit signatures`, `gh attestation verify`), with links pinned
  to the release. `@pxsig/storybook-addon`'s README covers its options, how it finds the server,
  the panel and sidebar, the deployed read-only snapshot, and the `pxsig snapshot` it runs on
  `storybook build` (`snapshot: false` turns that off).
