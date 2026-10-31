### Behaviour changes

- **The dashboard shows no path.** The read-only note and the Read only badge's hint named the
  workspace by its full path (`cd "/Users/<name>/…" && …`), which puts the user's name on screen
  and in every screenshot. They now name the folder by its own name ("in the uat-example folder,
  where pxsig serve runs") and show the command alone; the copy button copies the command.
  `GET /__pxsig/status`'s `approving` answers `folder` instead of `cwd`. When pxsig is not installed
  in the workspace, the command is `pxsig serve --link` (a global install) instead of `node` and
  the path to pxsig's own file.
  To update: a client that read `approving.cwd` reads `approving.folder` (the folder's name only).

### Security

- **No absolute path in what the dashboard reads.** A test fetches every answer the dashboard reads
  (status, projects, data, integrity, the event stream, the page) after a check and fails on the
  workspace's path or the home folder.
