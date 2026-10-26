### Behaviour changes

- **`check --since/--changed` no longer misses a change.** When the selection is unsure, it now
  checks every entry and says why, where it used to select nothing silently. Each changed path
  gets one class (docs/ci.md, "How selection decides"). This applies to `check --since/--changed`,
  `pxsig affected`, and the MCP tools `pxsig_affected` and `pxsig_check`.
  - A changed `.psig` selects its entry. An approval-only pull request is now checked against
    renders from the job, where it checked nothing.
  - A changed `a11y.json`, manifest, `approvals.ndjson` or `a11y-decisions.ndjson` selects the
    entries whose records changed. A rewritten log, or a file that does not parse, selects every
    entry.
  - A path outside `srcRoot`, or a file under `srcRoot` that is not a module (an unimported
    `.json` or `.md`), selects every entry, unless `affects.ignore` lists it. **With no ignore
    list, most pull requests in a monorepo now check every entry.** After upgrading, run
    `pxsig affected --since origin/main` on a few recent pull requests: every `outside` line is a
    candidate for `affects.ignore`.
  - With no merge base (a shallow clone), every entry is selected, with a warning, where it
    diffed against the ref itself.
  - The workspace file and `storybook.configDir` now select every entry, like the project config.
- **Paths.** A rename counts both its old and its new path. Non-ASCII file names match. In a
  workspace nested inside the repository, committed changes now match (they never did); a path
  outside the workspace is `$repo/<path>`. A path through a symlinked folder is resolved.
- **Output.** `affected --json` gains `files` (each path's status, class, what it selects and
  why), `traced`, `mergeBase`, `warnings`, `baselines`, `records`, `removed`, `failSafe`,
  `ignored` and `otherSuites`. Its `reason` names the first path that selected everything.
  `pxsig affected` and the `check` line list those paths. `summary.md` gains one line, only then:
  "All N entries selected: `<path>` (`<class>`)".
- **Watch and staleness are not gates.** `serve --watch` now re-checks after any edit under
  `srcRoot` (not only code files), using the traced selection, and prints what it could not
  trace. Staleness also uses the traced selection, so it reports no more `stale` entries than
  before.
- A module under `srcRoot` that no story reaches (a test, a script, a docs-only `.mdx`) still
  selects nothing; `.mts`, `.cts`, `.cjs` and `.mdx` files are now read as modules.

### Added

- `affects.ignore` (default `[]`): globs for changed paths that select nothing when nothing
  traced claims them. Anchored like `affects.extra`, plus `$repo/` for paths outside the
  workspace; `*`, `**`, `?`, `{a,b}`. It never hides a baseline, a store file, an "affects every
  entry" path or a module a story imports.
- The run manifest carries `store` (the store's record files) and `affectsIgnore`; an older
  engine ignores both.
