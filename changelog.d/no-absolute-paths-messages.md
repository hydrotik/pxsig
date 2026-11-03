### Behaviour changes

- **No absolute paths in doctor's machine rows, the server's integrity log or setup errors.**
  `pxsig doctor`'s "Settings" and "Approval guard files" rows show a folder relative to the
  workspace, else under the home folder (`~`, `%USERPROFILE%`, `%LOCALAPPDATA%`), else by its name;
  before, a folder outside the home folder (the approval guard folder of a workspace outside it, on
  macOS and Linux) printed absolute. "no readable manifest at" names the manifest relative to the
  workspace wherever it is printed, the server's "integrity failed" log line too. The setup errors
  about `pxsig.workspace.json` or `pxsig.config.json` (missing, not valid JSON, UTF-16, a bad
  `projects`, `requires` or `label`, a missing project config, a project name already taken), the
  log line for a `storybook.staticDir` with no Storybook build, "the pxsig binary is missing" from
  `pxsig affected`, the static report's "the dashboard is not built", `pxsig dashboard check`'s
  reference and engine messages and `pxsig migrate`'s errors name each file relative to the
  workspace or the current folder, else by its name. An absolute path names the user, and this
  output is pasted into issues and read by assistants.
  To update: nothing to do for a script that reads `--json`: `doctor --json`'s `machine` paths stay
  absolute. A script that matched an absolute path in one of these messages matches the relative
  path or the name instead.
