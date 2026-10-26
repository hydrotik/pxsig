### Behaviour changes

- **`check --full --update` exits 3 when refused** (piped, in CI or under an agent), as every
  other command that needs a person does; it exited 2. A wrong confirmation phrase exits 1
  ("not confirmed: nothing was written"), as in `approve apply` and `approve undo`; it exited 2.
- **An installed pxsig no longer falls back to the project's `target/release/pxsig`.** Without its
  platform package it now says that package (`@pxsig/cli-<platform>-<arch>`) is missing. Only a
  clone of pxsig itself uses its own `target/release/` build; `PXSIG_BIN` still overrides both.

### Added

- **`check --full --update --kind <word> --reason <text>`** writes the kind and reason on every
  log line. `--kind environment` re-takes baselines for a new render environment and leaves
  `a11y.json` as it is. The server accepts kinds up to 16 characters (it cut them at 10).
