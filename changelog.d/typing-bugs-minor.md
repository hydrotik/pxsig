### Behaviour changes

- **`pxsig manifest` checks each story's `parameters.pxsig`.** A key with a value of the wrong
  type (`grid: '96'`, `ignore: '.live'`, `addModes: 7`, a state with no `name`) is a setup error
  (exit 2) that names the story and the key, as a bad value in `pxsig.config.json` is. Before, it
  crashed the command with a TypeError or went into the manifest as written. A repair that
  registers the story reports the same error. Fix the parameter the message names.

### Fixed

- **The workspace schema describes `defaults` paths correctly.** Its description said a path in
  `defaults` resolves against each project's folder; pxsig resolves it against the workspace root,
  as `docs/configuration.md` says. Editors that show the schema now say the workspace root.
