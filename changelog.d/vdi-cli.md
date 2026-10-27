### Behaviour changes

- **An unknown or misspelled flag prints a warning** on stderr, with the closest known flag and,
  when it took the next word as its value, that word: `pxsig: unknown flag --nmae, ignored (did you
  mean --name?); it took "foo" as its value`. The command runs as before and the exit code is
  unchanged; 0.6.0 is planned to make it an error. `pxsig cat` passes its flags to the engine and
  is not checked.
- **`pxsig --version` prints the versions** (`pxsig 0.5.1 (engine 0.5.1, UI contract 1.1.0)`;
  `--json` as data) and exits 0. It used to run `status`.

### Added

- **`pxsig setup <assistant>`**, for example `pxsig setup vscode`, the same as `--assistant
  vscode`. Before, the word after `setup` could only be the step name and `setup vscode` exited 2.
  `pxsig version` is the same as `--version`.

### Fixed

- **The Windows engine runs without the Visual C++ Redistributable.** 0.5.0's `pxsig.exe` imported
  `VCRUNTIME140.dll`, which is not part of Windows, so on a machine without it the engine did not
  start. It is now built with the C runtime linked in (`crt-static`), and CI and the release fail
  when a built `pxsig.exe` imports a Visual C++ runtime DLL.
- **"run pxsig_check first"** (an MCP tool's name) in the CLI's messages now reads "run a check
  first (pxsig check, or the pxsig_check tool)".
- **`pxsig help platforms`** lists every program pxsig starts, `fc-list` and `docker` included.
- The docs said the published package runs on Node 20; it needs 22 (`engines`, since 0.5.1's
  scanner changes). `docs/cli.md` lists the `catalog` help topic.
- **CI:** the browser is installed before the `pxsig` suite, so its 4 browser tests (render
  environment, server flows) run on every OS instead of skipping. Cargo runs with `--locked`
  everywhere.
