### Behaviour changes

- **`pxsig <command> --help` prints that command's page.** It printed the full command list; now
  it shows the command's usage, flags (with defaults and the setting or variable each overrides),
  exit codes, what it changes and examples (`pxsig check --help`, `pxsig approve apply --help`).
  `pxsig --help` and `pxsig help` alone print the command list as before.
- **`pxsig help <name>` prints one page** for a command, a subcommand, a topic (`approvals`,
  `exit-codes`, `platforms`, `dashboard`, `ci`), a setting (`pxsig help gate.threshold`) or
  `global`. Any name used to print the full list; an unknown one now exits 2 and names the
  nearest.

### Added

- **One help source** in the package, `src/help/` (commands, every config key, topics), read by
  `pxsig help`, `--help` and the MCP's new read-only `pxsig_help` tool. A test keeps it in step
  with the code, `docs/cli.md`, `docs/configuration.md` and the dashboard's Help page.

### Documentation

- `docs/cli.md` gains `pxsig help`, a `pxsig doctor` flag table, and `check --full`'s
  `--no-server` and `--timeout-s`.
