### Behaviour changes

- **`pxsig doctor` before a manifest exists prints a setup preflight.** It used to print
  `no readable manifest at …` twice and stop. It now lists the engine binary and its version, the
  Playwright package that resolves and its version, whether Playwright's Chromium is present (a
  file check; no browser starts), the configured Storybook URL and `staticDir` (nothing is
  fetched), and the assistant marker; then the error once and `pxsig manifest` as the next step.
  The exit stays 2. `--json` gives `{ error, preflight, next }`, and the MCP tool `pxsig_doctor`
  adds the same `{ preflight, next }` after its error.
  To update: a script that matched the error on stderr reads it from stdout now, or uses
  `--json` (`error`).
