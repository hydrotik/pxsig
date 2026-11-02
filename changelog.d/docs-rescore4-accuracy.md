### Documentation

- **Quick starts and the first check.** The npm README and QUICKSTART say `manifest` reads
  Storybook's index.json (a running Storybook or the static build in `storybook.staticDir`), not
  only "the running Storybook". README, QUICKSTART and the npm README now say what the first
  `check --full` does: the report records every entry as new, while the check's summary line
  counts them as `changed` and prints them as `CHANGED <id>  new: no baseline yet`.
- **Architecture: the public surface.** `docs/architecture.md` lists the package's subpath exports,
  what runs for each and where its types come from, including the hand-written declarations in
  `src/public/`.
- **Releasing: tag after CI.** `docs/releasing.md` says to tag only once `main`'s `ci.yml` run on
  the release merge commit has finished green: the release's first job refuses a commit whose
  required checks have not all passed, and does not wait for running ones.
