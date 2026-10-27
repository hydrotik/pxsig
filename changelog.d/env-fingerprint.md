### Added

- **Every render records its environment, and every baseline keeps it.** A check collects, once per
  browser, which browser and version, Playwright, OS, a font-measurement digest, screen scale, GPU
  class, colour gamut, timezone, locale, capture pipeline and pxsig versions produced the renders
  (docs/configuration.md#env). A baseline written from a render keeps that render's environment in
  its `.psig` header (`env`; an approval in the dashboard writes the environment of the render being
  approved, never of the approving machine). Nothing in it names the machine or a person: no host
  name, user name, GPU model or font list.
- **Renders compared with their baseline's environment.** Each `check.json` row gets `env`,
  `baselineEnv`, `envMatch` (`same`, `compatible`, `mismatch`, `unknown`) and `envDiff`; the report
  gets `envs` and `summary.envMismatch`. A mismatch in a major field (the browser's major version,
  the fonts, the GPU class, timezone, locale) adds one `[check] env:` line, a line in `summary.md`,
  and an `env-mismatch` setup warning in `pxsig doctor` and the dashboard's coverage banner. MCP
  `pxsig_status` gains `env`, `pxsig_entry` the row's env fields.
- **`check --strict-env`** (config `env.strict`, `PXSIG_STRICT_ENV=1`) refuses before rendering,
  exit 2, when a selected baseline was approved in a different environment. Off by default.
- **Config `env.ignore` and `env.fontProbe`**: fields left out of the comparison, and font families
  measured besides the generic ones.
- **`pxsig baseline --env @file`** writes each entry's environment into its header; `pxsig attach`
  keeps every header key it does not own.
- **`engine-old`** setup warning: an engine binary older than the CLI writes baselines without `env`.

### Changed

- **The first check after upgrading reads no cached results.** Cached check results now carry the
  baseline's environment id, so the cache key changed and the first run re-compares every entry
  (the renders are the same; it only takes the engine's full time once).
- **On Linux, pxsig starts `fc-list`** (when fontconfig is installed) once per browser launch, for
  a digest of the installed fonts (`fonts.system`, informational). It is listed in
  docs/platforms.md, "Programs pxsig starts". Never on macOS or Windows.

### Behaviour changes

- None with the default settings. Baselines written before this version record no environment and
  compare as `unknown`, which never warns or refuses; the new line, `summary.md` line and setup
  warning appear only once baselines record an environment and a render's differs.
