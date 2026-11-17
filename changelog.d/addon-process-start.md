### Behaviour changes

- **The Storybook addon starts `pxsig snapshot` through pxsig, and needs pxsig 0.7.7 for it.** The
  addon no longer imports Node's process module: on `storybook build` it loads the workspace
  pxsig's new `pxsig/spawn` export and starts `node … pxsig.mjs snapshot` through it (the same list
  of programs as pxsig's own starts, never a shell, the same 2 minute timeout). With a pxsig older
  than 0.7.7 the build has no snapshot and prints one line,
  `pxsig: no snapshot in this build (the snapshot needs pxsig 0.7.7 or later; this workspace has
  pxsig <version>)`; it starts nothing. SECURITY.md and `docs/platforms.md` say so, and the test
  that holds every start to `spawn.mjs` covers the addon with no exception, and both packages'
  published self-tests (`test/installed/`), which now start node through `pxsig/spawn` too (the
  addon's skips that one check when pxsig is not installed beside it).
  To update: upgrade pxsig and `@pxsig/storybook-addon` together, to 0.7.7 or later; nothing to do
  when the deployed Storybook does not use the snapshot.

### Added

- **`pxsig/spawn`.** `spawnSync`, pxsig's guarded program start, as a public export with
  TypeScript types (`docs/package.md`). It starts only the programs pxsig starts, never through a
  shell, and throws for anything else.
