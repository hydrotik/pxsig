### Behaviour changes

- **`pxsig doctor` has a React line.** It names the `babel-plugin-react-compiler` and
  `@babel/core` versions the project has (or that they are not installed, or that React analysis
  is off and where), a bad `react` value (`react-config`, a warning) and the Flow files the last
  analysis skipped (`react-flow`). `--json` adds `react` (`code`, `severity`, `text`). None of them
  changes doctor's exit.
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
- **The `react` config key** (`compiler`, `lint`, `compilationMode`, `target`, `environment`,
  `exclude`, `renders`), also under the workspace file's `defaults`. `"react": false` or
  `PXSIG_REACT=off` turns React analysis off. A bad value is one warning line and a doctor
  finding, never exit 2.
- **The engine's `react-plan` and `react-diff`** (and the same two `pxsig serve` methods), and
  `entries` per `graph` file in `affected --json`.
- **Optional peer dependencies `babel-plugin-react-compiler >=1.0.0` and `@babel/core >=7.24`.**
  Installing pxsig installs neither; a project that uses the compiler already has both. To use
  the analysis in a project without them: `npm install -D babel-plugin-react-compiler @babel/core`.
