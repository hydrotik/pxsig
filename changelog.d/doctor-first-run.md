### Behaviour changes

- **`pxsig doctor` after a first check.** With nothing answering at `storybook.url`, doctor reads
  the index of the build in `storybook.staticDir` (the one `check` serves) instead of a static scan
  of the story files: the header says `index: Storybook build (<folder>)`, and `--json`'s
  `sources.storyIndex` has `source: "storybook"`, `reachable: false` and `build`. The `register`
  repair still needs a running Storybook. When every finding is a new entry (`unbaselined`), Next
  is `pxsig serve`, to review and approve them, not `pxsig doctor --repair`. The Settings row is
  gone (no command writes `settings.json` in this version; `--json` keeps `machine.settings`). The
  verdict line agrees with the exit: when warnings fail `--fail-on` (the default `warn`), it reads
  "2 findings at or above --fail-on warn, 0 errors" instead of "No errors; …". The exit codes are
  unchanged.
  To update: a script that matched "No errors" in doctor's output while it exits 1 reads the exit
  code (or `--json`'s `summary`); one that relied on `storybook-unreachable` with a build present
  reads `sources.storyIndex.build`.
