### Breaking changes

- **`GET /__pxsig/projects` no longer sends the workspace's absolute path.** Its `workspace` field
  (the path, which contains the user's name) is replaced by `workspaceId`, the same hash of the path
  `GET /__pxsig/status` answers. Each project's `root` stays relative to the workspace; a project on
  another drive (Windows) is named by its folder alone.
  To update: a script that read `workspace` from this answer runs `pxsig projects --json` instead,
  which computes the path in its own process.

### Security

- **No absolute path in the server's project list.** Any program on the machine can read
  `GET /__pxsig/projects`; it now carries no part of the user's home folder.
