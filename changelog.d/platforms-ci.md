### Added

- **Tested on macOS, Linux and Windows.** CI runs the Rust tests, the package tests and the
  examples on all three on every pull request; each release build checks that its binary starts.
- **`doctor` warns about cross-platform store problems.** `line-endings`: a store record checked
  out with CRLF, or `.psig` files git would convert. `path-portability`: a baseline path Windows
  cannot hold (reserved names like `CON`, a trailing dot or space, `<>:"|?*`, over 240 characters)
  or two paths that differ only in case. Both are warnings: `doctor`'s exit code is unchanged.

### Changed

- **New stores keep their records LF.** `pxsig init` writes `*.json text eol=lf` and
  `*.ndjson text eol=lf` into a new store's `.gitattributes`, beside `*.psig binary`. Existing
  stores are not changed; `doctor` names the lines to add.

### Fixed

- **Windows paths.** `pxsig affected --json` and the diff artifacts print `/` paths on Windows
  (they printed `\`). Absolute `--changed` paths are made repository-relative (they selected
  nothing), comparing a Windows path without regard to case.
- **`pxsig serve` stops on Ctrl+Break** in a Windows console as it does on Ctrl+C, releasing the
  store lock.
