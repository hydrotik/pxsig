### Fixed

- **The inspector no longer breaks React's rules of hooks.** A hook ran after an early return, so a
  render without an entry followed by one with an entry could fail with "Rendered more hooks than
  during the previous render". Found by the new linter.

### Changed

- **Contributors: oxlint, sherif, clippy and commitlint run in CI** (`Clean repository` and the
  Linux `Rust` job; no job names changed). oxlint errors fail; oxlint warnings may only go down
  against `scripts/lint-warnings-baseline.json`. The release checks each packed tarball with
  publint. `pnpm install` sets up git hooks that lint staged files and check commit subjects
  (CONTRIBUTING.md). Apart from the inspector fix, nothing in the published packages changes.
