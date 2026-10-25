### Documentation

- **Changelog fragments.** A pull request adds a file to `changelog.d/` instead of editing
  `CHANGELOG.md`, so open pull requests no longer collide on one file; a release merges them
  (`node scripts/changelog.mjs release <version>`). See `changelog.d/README.md`.
