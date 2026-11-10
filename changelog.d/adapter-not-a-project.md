### Documentation

- **The adapter guide says an adapter is not a project.** `docs/ui/build-adapter.md` gains "An
  adapter is not a project": no `pxsig.config.json` in the adapter's folder and no `projects` entry
  in `pxsig.workspace.json`, where the adapter lives, its one registration (`dashboard.ui` in the
  project's `pxsig.config.json`), and how `pxsig dashboard build` and `pxsig serve` find and load
  it, with a worked file tree for a monorepo. A short "What a faithful adapter keeps" list
  summarises what the contract rules and component sections already require.
