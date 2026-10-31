### Fixed

- **`pxsig check` says when it could not report integrity.** Its last line is the project's
  integrity from `pxsig doctor`; when the doctor failed (a report it could not read, a ledger it
  could not write) the line was left out without a word. It now reads
  `integrity: unavailable (<reason>)`, and `--json` adds `integrityUnavailable: "<reason>"` next to
  `integrity: null`. The exit code is unchanged.
