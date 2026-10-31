### Changed

- **`pxsig doctor` prints machine paths relative to the home folder.** The Settings and approval
  guard rows show `~/…` (on Windows `%LOCALAPPDATA%\…` or `%USERPROFILE%\…`), so pasted output
  carries no user name; `--json` keeps the absolute paths. The `Token files` row is now
  `Approval guard files`, and a missing `settings.json` reads `(not used in this version)`, since
  no command writes it yet.
- **"No report" names the next step for each surface.** The CLI names `pxsig check --full`; the MCP
  tools name `pxsig_check` with `all: true`. Without a manifest both name
  `pxsig manifest` first.
- **A missing peer dependency names the package manager's command.** `cannot find "playwright"`
  now gives `pnpm add -D`, `yarn add -D`, `bun add -d` or `npm install -D`, by the lockfile in
  the project or the workspace root (a file check; npm when there is none), and names the package
  rather than the file asked for.
- **A program pxsig may not start, or that a policy blocked, points at `pxsig help platforms`**,
  which ships in the package, instead of `docs/platforms.md`, which does not.
- **The instruction for the assistant mentions the dashboard adapter only when one is set.**
  `pxsig setup` adds "To build pxsig's dashboard on our design system, …" only when a project's
  `pxsig.config.json` sets `dashboard.ui`; otherwise the instruction is the approval rule alone.

### Documentation

- The npm README names the platform packages as installed with pxsig, adds the first-run note
  (the first `check --full` exits 1; how to approve), lists the offline `pxsig help` topics and
  links the docs by absolute URL, so the links work inside `node_modules`. README: "no sign-in"
  in place of "no token".
