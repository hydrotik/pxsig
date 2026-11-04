### Added

- **React render counting, off by default (`react.renders`).** With `"react": { "renders": true }`
  in `pxsig.config.json`, each render page gets an init script that defines React's DevTools hook
  (or chains onto one that is there) and counts React commits and the components that rendered,
  without React DevTools or any dependency, sending nothing anywhere. Each `check.json` row gets
  `renders` (commits, rendered and mounted components, the top five components with whether the
  React Compiler compiled them, React's build and version, render time on development builds,
  and whether React was still committing at capture); `summary.renderAlerts` counts the entries
  React was still committing. An alert only: it changes no exit code, gate, JUnit result or
  baseline. Format in [docs/spec.md](docs/spec.md#render-counts).
- **Off switches for React features:** `"react": false` (or `"off"`), the config flag
  `--no-react`, and `PXSIG_REACT=off`. A bad `react` value is one warning line and the feature off
  for the run, never a failed check ([docs/configuration.md](docs/configuration.md#react)).
