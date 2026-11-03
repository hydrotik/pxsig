### Behaviour changes

- **No absolute paths in setup output.** `pxsig init`'s heading names the folder (its path under
  the current folder, else its name) and its list of written files, and `--json`'s `wrote`, are
  relative to the current folder. The error before any config ("no pxsig.workspace.json or
  pxsig.config.json in this folder or above it") names no folder. `pxsig doctor` before a manifest
  (and `pxsig_doctor`) shows the engine, Playwright and Chromium relative to the workspace, or by a
  label outside it (`bundled (@pxsig/cli-<os>-<arch>)`, `PXSIG_BIN (pxsig)`, `Playwright's
  Chromium`), in `--json` too; "no readable manifest at" names the manifest relative to the
  workspace, for `doctor` and `check`. An absolute path names the user, and this output is pasted
  into issues and read by assistants.
  To update: a script that read `preflight.engine.path` or `preflight.chromium.path` as a file path
  runs `pxsig config --json` for the engine's path, or Playwright's `chromium.executablePath()`; one
  that read `init --json`'s `wrote` resolves each entry against the folder it ran in.
