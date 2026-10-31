### Behaviour changes

- **`pxsig manifest` names the Storybook it read and warns about a project it does not match.**
  The heading reads `from <storybook.url>/index.json` (or `from <staticDir> (served at …)`), and
  `--json` adds `source: { url, staticDir }` and `warnings`. A warning is printed when `srcRoot`
  does not exist or when none of the index's stories is under the project, which is what another
  package's Storybook on the same port looks like; the exit code is unchanged. The
  "no stories in srcRoot" error now also names the index it read.
  To update: nothing to do; when a warning appears, set `storybook.url` (or
  `storybook.configDir`, `srcRoot`) in `pxsig.config.json`.
