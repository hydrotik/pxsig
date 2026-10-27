# Platforms

pxsig runs on macOS, Linux and Windows, and CI tests every pull request on all three
(`.github/workflows/ci.yml`). This page lists what differs between them.

## Programs pxsig starts

This is the whole list. pxsig starts programs through one module (`packages/pxsig/src/lib/spawn.mjs`),
which refuses any program not listed here; a test fails if code anywhere else starts a process.

| Program                                                                         | OS                                       | When                                                                                                      | Why                                                                                                                                  | To avoid it                                           |
| ------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `node` (the one running pxsig)                                                  | all                                      | `pxsig serve`, `check`, `mcp`, `report`, repairs                                                          | pxsig runs its own parts as child processes                                                                                          | —                                                     |
| `pxsig` (the engine binary from `@pxsig/cli-<platform>-<arch>`, or `PXSIG_BIN`) | all                                      | checks, baselines, `affected`, `cat`, the server's engine                                                 | signatures and comparisons are computed in Rust                                                                                      | —                                                     |
| `git`                                                                           | all                                      | `approve` (the commit an approval was made on, the log's history), repairs, `doctor` (`.psig` attributes) | reading the repository's history and attributes                                                                                      | —                                                     |
| `ps`                                                                            | macOS, Linux                             | taking over a store lock                                                                                  | the lock holder's start time, so a reused process id is not mistaken for the holder                                                  | —                                                     |
| `osascript`, then `open`                                                        | macOS                                    | `pxsig serve`, once at start                                                                              | reuse an open Chrome tab on the dashboard, else open it in the default browser (macOS asks once whether Terminal may control Chrome) | `--no-open`                                           |
| `xdg-open`                                                                      | Linux                                    | `pxsig serve`, once at start                                                                              | open the dashboard in the default browser                                                                                            | `--no-open`                                           |
| `fc-list : family style`                                                        | Linux, only when fontconfig is installed | once per browser launch in a check or `pxsig serve`                                                       | a sha256 of the installed font list for the render environment (`fonts.system`, informational); the list itself is not kept          | — (absent: the field is `null`)                       |
| `docker`                                                                        | all                                      | only `pxsig browser start`, `stop` and `status`                                                           | run, stop and inspect the browser container ([container.md](container.md))                                                           | do not run those commands; nothing else starts Docker |
| Chromium, from Playwright                                                       | all                                      | rendering stories                                                                                         | Playwright starts its own browser; pxsig asks it to                                                                                  | —                                                     |

pxsig never starts a shell (`cmd.exe`, PowerShell, `sh`) or a system tool (`icacls`, `whoami`,
`rundll32`, `reg`, `schtasks`), and on Windows it starts nothing besides `node`, the engine, `git`
and Playwright's browser (and `docker`, only when someone runs `pxsig browser`): `pxsig serve`
prints the dashboard link, which the terminal makes clickable.

- **See every start:** `pxsig serve --debug` (or `PXSIG_DEBUG=spawn` for any command) prints each
  program and its arguments on stderr, as it starts it.
- **When a policy blocks one** (AppLocker, WDAC, a sandbox), the error names the program and points
  here.

## The container image

The same renders on every OS come from the pxsig container image: Docker Engine on Linux, Docker
Desktop, Colima or OrbStack on macOS, Docker Desktop (WSL 2) on Windows. It is optional; on a
machine without Docker, checks launch the local browser as before. See
[container.md](container.md#on-each-os).

## What pxsig keeps on this machine

Outside every repository, in one folder that belongs to the user, never the roaming profile:

| OS      | Folder                                                 |
| ------- | ------------------------------------------------------ |
| macOS   | `~/Library/Application Support/pxsig/`                 |
| Linux   | `$XDG_CONFIG_HOME/pxsig/` (default `~/.config/pxsig/`) |
| Windows | `%LOCALAPPDATA%\pxsig\`                                |

- `settings.json`: answers that describe this machine, written by `pxsig setup` in a later
  release. Written whole (a temporary file, then a rename). When it is missing, setup has not
  run and nothing else changes.
- On Windows, `tokens\<workspace>\serve-<port>.token` and `.mcp.token`: the server's file tokens
  ([server.md](server.md#guards)). On macOS and Linux they stay in the workspace's
  `node_modules/.cache/pxsig/` with mode 0600. On Windows a file mode protects nothing, and the
  user's profile folder is readable only by the user, SYSTEM and administrators, so pxsig changes
  no permission and runs no tool.

`pxsig doctor` prints both paths.

## Paths and line endings

- Every path pxsig prints or writes into a record uses `/`, on Windows too.
- The repository's `.gitattributes` keeps text LF and images binary. `pxsig init` gives a new
  store `*.psig binary diff=psig`, `*.json text eol=lf` and `*.ndjson text eol=lf`, so a Windows
  checkout reads the records as they were written.
- `pxsig doctor` warns about store problems that show only on another OS: `line-endings` (a CRLF
  record, or `.psig` files git would convert) and `path-portability` (a baseline path Windows
  cannot hold, or two that differ only in case). See [integrity.md](integrity.md#setup-problems).

## Stopping the server

Ctrl+C (and Ctrl+Break in a Windows console) stops `pxsig serve` and releases the store lock. A
forced stop (a closed terminal, Task Manager, `kill -9`) leaves the lock behind, naming a process
that is gone; the next `pxsig serve` or check takes it over. Every record pxsig writes is written
whole (a temporary file, then a rename) and every log line in one write, so a forced stop leaves
the old file or the new one, never half of either; a log line cut short is reported as `log-torn`.
