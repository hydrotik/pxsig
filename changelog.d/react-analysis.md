### Behaviour changes

- **`pxsig check --since` / `--changed` analyses the changed React files with the project's React
  Compiler** when `babel-plugin-react-compiler` and `@babel/core` are installed in the project,
  while the entries render (two worker threads). One more line after the summary line (the
  counts, then each alert, at most ten), a `react` block in `check.json`, `react` counts on the
  `history.ndjson` line, and a "React (alerts, not blocking)" section in `summary.md` only when
  something is newly skipped or newly found. A project that depends on React (its own or the
  workspace root's `package.json`) but lacks the two packages gets one line saying so; a project
  without React gets none (`pxsig doctor` names it either way). With
  `react.renders`, a `[check] renders:` line counts the entries React was still committing at
  capture. None of it changes the exit code, a gate, `junit.xml` or the `--sarif` file.
  To update: nothing to do. To turn it off: `"react": { "compiler": false }` in
  `pxsig.config.json` (the analysis), or `--no-react` / `PXSIG_REACT=off` (everything React).

- **`pxsig doctor` has a React line.** It names the `babel-plugin-react-compiler` and
  `@babel/core` versions the project has (or that they are not installed, or that React features
  are off and where), each bad `react` value and what it turns off (`react-config`, a warning)
  and the Flow files the last analysis skipped (`react-flow`). `--json` adds `react` (`code`,
  `severity`, `text`). None of them changes doctor's exit.
  To update: nothing to do.

### Added

- **`pxsig react [--since <ref> | --files a,b | --all]`.** The React Compiler's verdict on the
  changed files, compared with the merge base: a component or hook it compiled before and skips
  now, a new function it skips, a new reason it skips one, and (with `react.lint`) a new
  Rules-of-React finding on a function that still compiles. Alerts only: exit 0 whatever it
  finds. No Storybook and no browser. It runs the project's own compiler and Babel in worker
  threads for the files its cache does not have, never loads the project's Babel config, and
  writes `<store>/reports/react.json`; while the server holds the store it reads the cache and
  writes nothing. `--all` is the inventory: every module that reaches an entry, compiled or not.
- **React render counting, off by default (`react.renders`).** With `"react": { "renders": true }`
  in `pxsig.config.json`, each render page gets an init script that defines React's DevTools hook
  (or chains onto one that is there) and counts React commits and the components that rendered,
  without React DevTools or any dependency, sending nothing anywhere. Each `check.json` row gets
  `renders` (commits, rendered and mounted components, the top five components with whether the
  React Compiler compiled them, React's build and version, render time on development builds,
  and whether React was still committing at capture); `summary.renderAlerts` counts the entries
  React was still committing. An alert only: it changes no exit code, gate, JUnit result or
  baseline. Format: `docs/spec.md`, "Render counts".
- **The `react` config key** (`compiler`, `lint`, `compilationMode`, `target`, `environment`,
  `exclude`, `renders`), also under the workspace file's `defaults`. Off switches for every React
  feature: `"react": false` (or `"off"`), the config flag `--no-react`, and `PXSIG_REACT=off`. A
  bad value is one warning line, a doctor finding, and the part it belongs to off for the run (a
  bad `renders`: render counting; any other bad key: the compiler analysis), never a failed check
  (`docs/configuration.md`, "`react`").
- **`check --react-sarif <file>` and `pxsig react --sarif <file>`.** The React alerts as SARIF
  2.1.0, in a file of their own: rules `react-compiler/<rule>` (at the function's file and line;
  `warning` when the compiler skips it, `note` for a finding; React's docs page for the rule as the
  help link) and `react-renders/still-rendering` (`note`, at the story file). Never `error`. The
  existing `--sarif` file stays accessibility only, byte for byte.
- **The dashboard's React view (Diagnostics › React).** Compiler: the alerts first, every
  function analysed on demand, and a function's diagnostics, base and entries in a side panel;
  Analyse runs the analysis again. Renders: the entries React was still committing at capture
  first, every entry measured on demand, and an entry's counts in a side panel; Measure renders
  runs a visual check of the entries in scope with counting on, and Cancel stops it. A progress
  strip at the top of every section while either runs (with Skip and Cancel), then how it ended; a
  React card on the Overview; a Still rendering badge in the inspector header, and a React section
  in its side panel (the entry's render counts and the compiler alerts that reach it, each opening
  Diagnostics › React on the function); a React Analysis
  section in Help. Analyse, Skip, Measure renders and Cancel need the dashboard link (disabled
  while the page is read only). Alerts only: nothing here decides anything. Old `#react` and
  `#react-renders` links open the view.
- **The server runs the React analysis** after its startup integrity pass and, with `--watch`,
  after a code edit (compared with `main`; no browser; only the store lock's holder saves
  `reports/react.json`). `/__pxsig/data` has `react` (where the analysis stands, its last results
  and who wrote them), and `/__pxsig/events` sends `react` (running with its file count, done,
  skipped, error) and `check` `progress` and `cancelled`. New routes, each needing the dashboard
  link: `react/analyse`, `react/skip`, `check/cancel` (the entries rendered by then keep their new
  results, the others their last ones) and `check` with `renders: true` (Measure renders: counts
  React renders in that run, also with `react.renders` off). Render counts carry `at` and `prev`
  (the counts of the row they replaced). See docs/server.md.
- **MCP: `pxsig_react`, and React fields in `pxsig_check` and `pxsig_entry`.** `pxsig_react` reads
  the last `reports/react.json` (summary, each alert with its sentence, the functions analysed,
  alerts first) or, with `run: true`, runs the analysis first, as `pxsig react --since` does.
  `pxsig_check` with `since` or `changed_files` adds `react`: the alerts for those files.
  `pxsig_entry` adds the row's `renders`. No tool accepts, approves or silences an alert.
- **The engine's `check --history-extra json|@file`** adds an object's keys to the history line.
- **The engine's `react-plan` and `react-diff`** (and the same two `pxsig serve` methods), and
  `entries` per `graph` file in `affected --json`.
- **Optional peer dependencies `babel-plugin-react-compiler >=1.0.0` and `@babel/core >=7.24`.**
  Installing pxsig installs neither; a project that uses the compiler already has both. To use
  the analysis in a project without them: `npm install -D babel-plugin-react-compiler @babel/core`.
