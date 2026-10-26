### Changed

- **On Windows, the server's token files live in the user's profile.** `serve-<port>.token` and
  `serve-<port>.mcp.token` move from the workspace's `node_modules/.cache/pxsig/` to
  `%LOCALAPPDATA%\pxsig\tokens\<workspace>\`, which only the user (and SYSTEM and administrators)
  can read; a file mode set there protected nothing. pxsig changes no permission and runs no tool
  for it. macOS and Linux keep the files where they were, with mode 0600.

### Added

- **One folder per machine for pxsig's own files** (`docs/platforms.md`): macOS
  `~/Library/Application Support/pxsig/`, Linux `$XDG_CONFIG_HOME/pxsig/`, Windows
  `%LOCALAPPDATA%\pxsig\` (never the roaming profile). It holds `settings.json` for `pxsig setup`
  (a later release) and, on Windows, the token files. `pxsig doctor` prints the settings path
  (marked "not set up" until then) and the token folder.
