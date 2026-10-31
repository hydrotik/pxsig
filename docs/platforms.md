# Platforms

pxsig runs on macOS, Linux and Windows, and CI tests every pull request on all three
(`.github/workflows/ci.yml`). This page lists what differs between them.

## Programs pxsig starts

This is the whole list. pxsig starts programs through one module (`packages/pxsig/src/lib/spawn.mjs`),
which refuses any program not listed here; a test fails if code anywhere else starts a process.

| Program                                                                                         | OS                                       | When                                                                                                                  | Why                                                                                                                                  | To avoid it                                           |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `node` (the one running pxsig)                                                                  | all                                      | `pxsig serve`, `check`, `mcp`, `report`, repairs; `storybook build` with the addon (`pxsig snapshot`, no shell)       | pxsig runs its own parts as child processes                                                                                          | —                                                     |
| `pxsig` (the engine binary from `@pxsig/cli-<platform>-<arch>`, or `PXSIG_BIN`)                 | all                                      | checks, baselines, `affected`, `cat`, the server's engine                                                             | signatures and comparisons are computed in Rust                                                                                      | —                                                     |
| `git`                                                                                           | all                                      | `approve` (the commit an approval was made on, the log's history), `snapshot`, repairs, `doctor` (`.psig` attributes) | reading the repository's history and attributes                                                                                      | —                                                     |
| `ps`                                                                                            | macOS, Linux                             | taking over a store lock                                                                                              | the lock holder's start time, so a reused process id is not mistaken for the holder                                                  | —                                                     |
| `osascript`, then `open`                                                                        | macOS                                    | `pxsig serve`, once at start; `pxsig serve --link --open`                                                             | reuse an open Chrome tab on the dashboard, else open it in the default browser (macOS asks once whether Terminal may control Chrome) | `--no-open`                                           |
| `xdg-open`                                                                                      | Linux                                    | `pxsig serve`, once at start; `pxsig serve --link --open`                                                             | open the dashboard in the default browser                                                                                            | `--no-open`                                           |
| `pbcopy`                                                                                        | macOS                                    | `pxsig serve --link --copy` only                                                                                      | put the new dashboard link on the clipboard (the link on stdin)                                                                      | leave out `--copy`                                    |
| `wl-copy`, else `xclip -selection clipboard`                                                    | Linux                                    | `pxsig serve --link --copy` only                                                                                      | put the new dashboard link on the clipboard (the link on stdin)                                                                      | leave out `--copy`                                    |
| `fc-list : family style`                                                                        | Linux, only when fontconfig is installed | once per browser launch in a check or `pxsig serve`                                                                   | a sha256 of the installed font list for the render environment (`fonts.system`, informational); the list itself is not kept          | — (absent: the field is `null`)                       |
| `docker`                                                                                        | all                                      | only `pxsig browser start`, `stop` and `status`                                                                       | run, stop and inspect the browser container ([container.md](container.md))                                                           | do not run those commands; nothing else starts Docker |
| Chromium, from Playwright; when it is missing, the installed Google Chrome, then Microsoft Edge | all                                      | rendering stories                                                                                                     | Playwright starts the browser; pxsig asks it to ([which browser](#which-browser-renders))                                            | —                                                     |

pxsig never starts a shell (`cmd.exe`, PowerShell, `sh`) or a system tool (`icacls`, `whoami`,
`rundll32`, `reg`, `schtasks`), and on Windows it starts nothing besides `node`, the engine, `git`
and the browser Playwright launches (and `docker`, only when someone runs `pxsig browser`):
`pxsig serve` prints the dashboard link, which the terminal makes clickable.

- **See every start:** `pxsig serve --debug` (or `PXSIG_DEBUG=spawn` for any command) prints each
  program and its arguments on stderr, as it starts it.
- **When a policy blocks one** (AppLocker, WDAC, a sandbox), the error names the program and points
  here.
- **The Windows engine needs nothing installed besides Windows** (from 0.5.1): it links the C
  runtime statically, so no Visual C++ Redistributable (`VCRUNTIME140.dll`). CI and the release
  check every built `pxsig.exe` for it (`scripts/check-win-runtime.mjs`).

## Which browser renders

Stories render in Chromium, launched by the project's Playwright. pxsig tries, in this order, and
uses the first that starts:

| Order | Browser                                          | Playwright channel |
| ----- | ------------------------------------------------ | ------------------ |
| 1     | Playwright's own Chromium (`playwright install`) | none               |
| 2     | Google Chrome, installed on the machine          | `chrome`           |
| 3     | Microsoft Edge, installed on the machine         | `msedge`           |

- The fallback applies to the `chromium` engine only; a mode with `browser: "firefox"` or
  `"webkit"` launches that engine and nothing else.
- The channel a render used is part of its render environment (`browser.channel`, a major field;
  [configuration.md](configuration.md#env)): a render from Chrome or Edge, checked against a
  baseline that recorded Playwright's Chromium, reports `env-mismatch`.
- When none of the three starts, the error is the last one Playwright gave, which names Edge
  ([troubleshooting.md](troubleshooting.md#no-chromium)).
- With a browser endpoint (`pxsig browser start`, `--browser <ws>`, `PXSIG_BROWSER_WS`,
  `capture.browserEndpoint`), nothing is launched on this machine; the container's browser renders.
- These browsers are started by Playwright, not through `spawn.mjs`, so `PXSIG_DEBUG=spawn` does
  not print them.

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
