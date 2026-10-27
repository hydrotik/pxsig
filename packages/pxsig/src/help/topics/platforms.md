# Platforms

pxsig runs on macOS, Linux and Windows; CI tests every pull request on all three.

**Programs pxsig starts:** `node`, the engine binary, `git` on every OS; `ps` on macOS and Linux;
`osascript` and `open` on macOS and `xdg-open` on Linux, to open the dashboard; `fc-list` on Linux
when fontconfig is installed (a digest of the installed fonts); `docker` on every OS, only for
`pxsig browser start`, `stop` and `status`; and Playwright's browser. Nothing else, and never a
shell: on Windows `pxsig serve` prints the dashboard link
instead of opening it. `pxsig serve --debug` (or `PXSIG_DEBUG=spawn`) prints every program as it
starts it.

**What pxsig keeps on this machine**, outside every repository: macOS
`~/Library/Application Support/pxsig/`, Linux `$XDG_CONFIG_HOME/pxsig/`, Windows
`%LOCALAPPDATA%\pxsig\`. On Windows the server's token files are there too; on macOS and Linux
they stay in the workspace's `node_modules/.cache/pxsig/` with mode 0600. `pxsig doctor` prints
both paths.

**Paths and line endings:** every path pxsig prints or records uses `/`. New stores get
`.gitattributes` that keep records LF and baselines binary; `pxsig doctor` warns about
`line-endings` and `path-portability`.

See docs/platforms.md.
