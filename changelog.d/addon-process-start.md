### Documentation

- **SECURITY.md lists the Storybook addon's process start.** The "What package scanners report"
  table gains the addon's one start: on `storybook build`, `node` runs the workspace's own
  `pxsig snapshot`, with no shell. `docs/platforms.md` names it as the one start outside
  `spawn.mjs`, and the test that holds every start to `spawn.mjs` now covers the addon too and
  allows that one file by name.
