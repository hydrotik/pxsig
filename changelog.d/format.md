### Changed

- **Contributors: one format for the repository.** oxfmt with the hydrotik monorepo's settings, and
  `cargo fmt`, checked in `Clean repository` and the Linux `Rust` job and applied to staged files
  by the pre-commit hook. The one-time reformat is listed in `.git-blame-ignore-revs`
  (`git config blame.ignoreRevsFile .git-blame-ignore-revs`). Nothing in the published packages
  behaves differently.
