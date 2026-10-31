### Fixed

- **The READMEs on npm link to the documents of the version installed.** pxsig's README linked to
  the docs on `main`, which can describe features a published version does not have, and the
  Storybook addon's README and the dashboard README pxsig ships linked to `../../docs/…`, which
  leads nowhere outside the repository. The release now rewrites both kinds to
  `github.com/hydrotik/pxsig/blob/v<version>/…` when it packs, and fails a tarball that still has
  one. The repository's files are unchanged.
