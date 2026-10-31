### Added

- **The top bar says whether this page can approve.** Beside the connection badge: `Live · Read
  only` (the page holds no dashboard link), `Live · Can approve` (it opened one), or `Static report
  · Read only`; Offline is unchanged. The hint on `Read only` names the command for a new link, in
  the folder the server serves (`pnpm exec pxsig serve --link`, `yarn pxsig …`, `npx pxsig …`, or
  this pxsig by its path).
- **The inspector says Read only before any click.** Without the dashboard link, a note under the
  header gives the command with a copy button, and Reject, Approve and Undo stay in place,
  disabled, with the reason as their title. `GET /__pxsig/status` answers `approving`: `allowed`
  (whether the request carries the link's session; never the session itself), `cwd` and `command`.

### Changed

- **The dashboard link's timing is said in full everywhere.** The two minutes are only to open the
  link, which works once; once open, that browser can approve with no time limit until `pxsig
  serve` stops or the browser closes. Reworded in `pxsig serve`'s start-up line, `pxsig serve
  --link`, the refusal of a used or late link, the dashboard's notes, `pxsig help serve`, and
  docs/cli.md, server.md and troubleshooting.md. The limit itself is unchanged.
