### Behaviour changes

- **`playwright` is an optional peer dependency.** npm 7 and later installed it automatically
  with pxsig; now it is installed only when the project asks for it, as the README's install step
  already does (`npm install -D pxsig playwright`). Supply-chain scanners no longer count the
  newest Playwright, and the Windows installer scripts it carries, as part of pxsig. A missing
  Playwright still stops a render with a setup error that names the install command.
  To update: if the project has no `playwright` (or `@playwright/test`) of its own, add it:
  `npm install -D playwright`.

### Fixed

- **The package no longer ships the dashboard's locked screen files.** 0.7.2 published
  `dashboard/fixtures/locked/` (34 files), which only pxsig's own CI reads.

### Documentation

- **README (npm): a Network section** lists every address pxsig listens on or connects to:
  loopback, your Storybook, the server named in `PXSIG_URL`, and the container image that
  `pxsig browser start` pulls. No telemetry, no update checks.
