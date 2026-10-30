### Changed

- **The top-level help lists every command and topic, and names no internal files.** `pxsig help`
  and `pxsig --help` are built from the same source as `pxsig help <command>`: every command and
  subcommand with its summary and usage (`dashboard check`, `init --label`, `serve --link` and
  `doctor --repair --only log-torn` included), `pxsig version`, the commands that need a person
  at a terminal, and the topics. Terminal, Markdown and `--json` output follow the
  chosen format like any other help page. `pxsig help topics` lists the topics with their titles.
- **One list of the commands that need a person.** `pxsig help exit-codes` now names `doctor
  --repair --only log-torn --apply`, and `pxsig help serve` lists exit 3 for `--link`, like the
  other pages.
