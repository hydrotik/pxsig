### Behaviour changes

- **No absolute paths in doctor's machine rows, the server's integrity log or setup errors.**
  `pxsig doctor`'s "Approval guard files" row shows the folder relative to the workspace, else under
  the home folder as `~/…` (on every OS), else relative to the workspace (`../…`); before, a folder
  outside the home folder (the approval guard folder of a workspace outside it, on macOS and Linux)
  printed absolute. "no readable manifest at" names the manifest relative to the workspace wherever
  it is printed, the server's "integrity failed" log line too. The setup errors about
  `pxsig.workspace.json` or `pxsig.config.json` (missing, not valid JSON, UTF-16, a bad `projects`,
  `requires` or `label`, a missing project config, a project name already taken), the log line for
  a `storybook.staticDir` with no Storybook build, "the pxsig binary is missing" from `pxsig
  affected`, the static report's "the dashboard is not built", `pxsig dashboard check`'s reference
  and engine messages and `pxsig migrate`'s errors name each file relative to the workspace or the
  current folder, else by its name. An absolute path names the user, and this output is pasted into
  issues and read by assistants.
  To update: a script that matched an absolute path in one of these messages matches the relative
  path or the name instead.
- **`pxsig doctor --json` and `pxsig_doctor` give machine paths relative, never absolute.**
  `machine.settings` and `machine.tokens` are relative to the workspace inside it, else `~/…` under
  the home folder, else relative to the workspace (`../…`). The setup preflight before a manifest
  exists (`preflight.engine.path`, `playwright.path`, `chromium.path`, `storybook.staticDir`) shows
  a path under the home folder as `~/…` where it showed a label (`Playwright's Chromium`, `outside
  the workspace`); a path outside both still shows the label. `pxsig config --json` still has the
  engine's absolute path.
  To update: a script that read `machine.settings` or `machine.tokens` as an absolute path resolves
  it against the workspace root, or expands a leading `~/` to the home folder.
- **The paths a person pastes or opens are relative to the current folder.** `pxsig dashboard
  build` prints `built ./…` and `serve it: PXSIG_DASHBOARD_DIR=./… pxsig serve` (single-quoted when
  the path has a space), `pxsig report` prints the page it wrote as `./…/index.html`, and `pxsig
  entry`'s image paths (`--plain`, `--json`, and the links in a terminal) are `./…`. A path outside
  the current folder is `../…`, or `~/…` when the current folder is outside the home folder. Each
  still works pasted or opened from the folder the command ran in. Before, the first two printed
  absolute paths, which name the user, and the entry's images were relative to the workspace, not
  to the folder the command ran in. `pxsig dashboard build --json` keeps `outDir` absolute.
  To update: run the pasted line, or open the path, from the folder the command ran in.
