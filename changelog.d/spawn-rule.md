### Behaviour changes

- **On Windows, `pxsig serve` no longer opens a browser.** It printed the dashboard link and also
  ran `start` through `cmd.exe`; it now only prints the link (VS Code's terminal and Windows
  Terminal make it clickable). macOS keeps reusing an open Chrome tab, else `open`; Linux keeps
  `xdg-open`.

### Added

- **The programs pxsig starts are listed, and nothing else is started.** `docs/platforms.md`
  lists each program, when and why: `node`, the engine, `git`, `ps` (macOS, Linux), `osascript`
  and `open` (macOS), `xdg-open` (Linux), and Playwright's browser. One module starts them and
  refuses anything else, including any shell; a test fails if code elsewhere starts a process.
- **`pxsig serve --debug`** (or `PXSIG_DEBUG=spawn`) prints every program pxsig starts, with its
  arguments. A start blocked by a policy (AppLocker, WDAC) names the program and points to the
  list.
