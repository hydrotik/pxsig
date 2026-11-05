### Behaviour changes

- **No absolute path in "the pxsig binary is missing" from `pxsig check`, or in the server's "the
  dashboard is not built".** `pxsig check` names the missing engine binary relative to the current
  folder (`./…`, `../…`, or `~/…` when the current folder is outside the home folder). The
  server's 404 for `/report/` without a dashboard build names the folder relative to the workspace,
  else `~/…` under the home folder, else relative to the workspace (`../…`), as `pxsig doctor
  --json` does. Before, both printed absolute paths, which name the user.
  To update: a script that matched the absolute path in one of these messages matches the relative
  path instead.
