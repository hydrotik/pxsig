### Behaviour changes

- **`pxsig check --since <ref>` and `--changed` compare with the ref when the pxsig server holds
  the store.** The check was handed to the server with only the entries it selected, so the React
  Compiler analysis never ran against the ref: no `[check] react:` lines, no `react` in
  `check.json`, no `react` counts on the history line and an empty `--react-sarif` file. The ref
  (or the files) now goes with the check (`POST /__pxsig/check {since}` or `{changed}`), and the
  server writes `affected`, `react` and the history counts as the check without a server does;
  `pxsig check --since` (quick) and `pxsig_check` read the server's `react` back. The server checks
  a request's ref as the CLI checks `--since` (a commit here, never starting with `-`, no spaces or
  control characters) and its files as paths inside the workspace, and answers 400 with nothing
  queued otherwise. Checks queued with different refs (or files) run one batch per ref, each
  compared with its own. A full re-check in the server without a ref now clears `affected` and `react`,
  as a full check without `--since` writes none.
  To update: nothing to do; the server and the CLI must be the same version, as before.
