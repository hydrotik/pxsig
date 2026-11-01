# Changelog

All notable changes are listed here. The format follows Keep a Changelog, and versions follow
semantic versioning.

## Unreleased

## 0.7.2 - 2026-11-01

The locked-behaviour release. What the owner has signed off on in pxsig's own dashboard now fails
CI when it changes by accident: each screen's look (approved baselines), its structure (the
accessibility tree), the position of its anchored controls, no accessibility or layout finding,
and the Storybook addon's panel in a browser. `pxsig dashboard check` renders in UTC and `en-US`,
so a time on a screen reads the same on every machine. The README has a new introduction and a
comparison with Chromatic. Nothing to do when upgrading.

### Upgrading from 0.7.1

- **Nothing to do:** `pxsig dashboard check` renders every screen in UTC and `en-US`.

### Behaviour changes

- **`pxsig dashboard check` renders every screen in UTC and `en-US`.** Its clock was already fixed;
  the time zone and locale were the machine's, so a screen showing a time read differently on a
  laptop and in CI. Now a time reads the same everywhere.
  To update: nothing to do; on a machine outside UTC, screenshots that show a time differ once
  from an earlier `--compare` run.

### Documentation

- **README:** a new introduction. pxsig is for design systems, component libraries and the
  applications built on them, each with its own baselines; a self-hosted alternative to hosted
  visual-testing services; the key features of the dashboard, the addon and the CLI. The engine
  moves to "How it works".
- **docs/comparison.md:** how pxsig compares with Chromatic, and `pxsig affected` with TurboSnap,
  as of November 2026.

## 0.7.1 - 2026-11-01

The consistent-dashboard release. `pxsig dashboard check` finds nothing on either build: the
inspector toolbar is one even row, with its sliders on one line; the plain adapter and the
fallbacks share one control height; and the plain adapter's two axe findings are fixed. A manifest
can now mark its entries as the dashboard's own screens (`source: dashboard-screens`), which the
pxsig repository checks against its own approved baselines on every pull request and before every
release. Nothing to do when upgrading.

### Upgrading from 0.7.0

- **Nothing to do:** `pxsig dashboard check` measures only an open modal dialog.

### Behaviour changes

- **`pxsig dashboard check` measures only an open modal dialog.** While a modal `<dialog>` is open,
  the layout findings leave out the page behind it, which is inert. The plain adapter's review
  session reported a button behind its dialog as covered by one inside it.
  To update: nothing to do; a check of an adapter whose dialog is a native modal can list fewer
  findings.

### Added

- **A manifest can say its entries are the dashboard's own screens.** `"source":
  "dashboard-screens"` at the top of a store's manifest (docs/spec.md, section 6) marks the pxsig
  dashboard's own screens, which the pxsig repository checks with `scripts/screens-check.mjs`
  against baselines in `packages/dashboard/.pxsig/`. For such a project nothing fetches a Storybook,
  its components are the dashboard's sections, the dashboard shows no Storybook link and no
  Re-check, and `pxsig check` refuses it with the command to run instead. A manifest without
  `source` is a story project, as before.

### Changed

- **The inspector's sliders sit on one line.** On the reference dashboard, Tolerance and the swipe,
  opacity and cell sliders show their label, track and value on one line at the toolbar's control
  height, instead of the label over the track, so the inspector toolbar is one even row.
- **The plain adapter and the fallbacks share one control height.** Buttons are 2rem, and 1.75rem
  in a `sm` toolbar; selects, search fields, segmented choices and the fallback slider are 1.75rem.
  The fallback `Toolbar` sets `data-size` on its root, for a stylesheet that sizes an adapter's own
  controls from it.

### Fixed

- **Two accessibility findings on the plain adapter.** The chart table's corner is a cell, not an
  empty column header (axe `empty-table-header`), and the Coverage tab's figures are a region named
  "Coverage summary", apart from the Coverage banner (axe `landmark-unique`).
- **A switch and its text are one control.** In the inspector toolbar each switch's label carries
  `data-control`, so `pxsig dashboard check` measures it at the toolbar's height rather than the
  switch alone.
- **The inspector's pixel hint keeps its full text.** "Hover over the image to read pixel values."
  and the cell and tile under the pointer stay on one line so the row keeps its height; where a
  narrow panel or a wider font cuts them, a `title` holds the whole line.

### Documentation

- **docs/ui/build-adapter.md:** a slider in a toolbar is one line with `data-control`; a control
  made of parts is measured as its outermost `data-control`; the page behind a modal dialog is not
  measured.
- **docs/releasing.md, "pxsig's own baselines":** how the dashboard's screens are checked,
  reviewed and approved.

## 0.7.0 - 2026-10-31

The trust-the-approval release. The dashboard decides one entry at a time: Approve story is off
by default, Reject and Approve keep their place, and the top bar says whether the page can approve
(`Live · Read only` or `Live · Can approve`), with the dashboard link's timing said in full and 5
minutes to access it. A client uses only its own workspace's server, so a check is never queued on
another checkout's. Nothing the server answers carries an absolute path. `pxsig dashboard check`
measures each screen's layout and compares screens between builds, and the dashboard names the
application under review (`pxsig • <scope>`). Read **Upgrading from 0.6.0** first: an unknown
flag and a bad number are now errors, the peer ranges start at Playwright 1.58 and Storybook 10,
two HTTP fields change, and `pxsig/workspace` exports only the documented resolver
([migrating.md](docs/migrating.md#upgrading-to-07) groups the steps by who acts).

### Upgrading from 0.6.0

- **`pxsig/workspace` exports only the documented resolver.** Code that imported one of the 27 reads what it needs from the project `openProject()` returns (its resolved config and store paths) or from `pxsig config --json`, or opens an issue naming what it needs.
- **`pxsig/dashboard` is types only at run time.** Import it with `import type` only.
- **The dashboard shows no path.** A client that read `approving.cwd` reads `approving.folder` (the folder's name only).
- **A number flag with a bad value is an error: `pxsig` exits 2 and runs nothing.** A script that passes such a value now fails; pass a number in the range, or leave the flag out.
- **The peer ranges start at the versions CI tests: `playwright >=1.58` (was `>=1.40`) and, for `@pxsig/storybook-addon`, `storybook >=10` (was `>=9`).** Move to Playwright 1.58 or later and Storybook 10, or keep the older version and accept the warning (`--legacy-peer-deps` on npm); older versions are untested.
- **`pxsig dashboard build` with no adapter configured now builds the plain adapter.** For the reference look, pass `--ui hydrotik` or set `PXSIG_DS_SOURCE`.
- **`GET /__pxsig/projects` no longer sends the workspace's absolute path.** A script that read `workspace` from this answer runs `pxsig projects --json` instead, which computes the path in its own process.
- **One entry, one decision: Approve story is off by default.** Approve each entry on its own; a client of `POST /__pxsig/approve-story` handles the 403, or the project sets `approvals.byStory: true` in `pxsig.config.json` to bring it back.
- **The CLI, the MCP server and the Storybook addon use only their own workspace's server.** Start `pxsig serve` in each workspace that uses one (and restart a server from 0.6.0 so it names its workspace), or set `PXSIG_URL` to the server meant.
- **An unknown flag is an error: `pxsig` exits 2 and runs nothing.** A script or CI step that passes a misspelled or retired flag now fails; correct the flag the message names, or remove it.
- **The a11y pass uses pxsig's own axe-core, not the project's.** Nothing to do; to choose the axe version, pin pxsig.
- **The render environment records the axe-core version.** Nothing to do; to leave the field out of comparisons, set `env.ignore: ["axe"]`.
- **`pxsig doctor` before a manifest exists prints a setup preflight.** A script that matched the error on stderr reads it from stdout now, or uses `--json` (`error`).
- **React is declared as an optional peer (`react >=19`).** Use React 19 with `pxsig/diff-viewer` and `pxsig dashboard build`, or accept the warning.
- **`pxsig init` records the package's Storybook folders.** Check the config `init` writes; to keep a key out, remove it there, or pass the flag with the path you want.
- **`pxsig manifest` names the Storybook it read and warns about a project it does not match.** Nothing to do; when a warning appears, set `storybook.url` (or `storybook.configDir`, `srcRoot`) in `pxsig.config.json`.
- **Nothing to do:** `check` no longer retries an entry with no baseline yet; `pxsig dashboard check` records a screen whose layout never held still; `pxsig dashboard check` records a page load it retried; The dashboard link has 5 minutes to be accessed, up from 2.

### Breaking changes

- **`pxsig/workspace` exports only the documented resolver.** The export is now
  `src/public/workspace.mjs` with five names: `openProject`, `findWorkspace`, `pickProject`,
  `loadProject` and `SetupError`, the functions the README describes as the resolver. The other 27
  names it used to carry (`DEFAULTS`, `CONFIG_FILE`, `WORKSPACE_FILE`, `PXSIG_VERSION`, `expand`,
  `flagLayer`, `setFlagLayer`, `merge`, `provenance`, `resolveModes`, `missingProjects`,
  `satisfies`, `unlistedConfigs`, `workspaceProblems`, `engineProblems`, `engineVersion`,
  `imageProblems`, `parseImageTag`, `componentOfImport`, `entryConfig`, `runManifest`,
  `writeRunManifest`, `browserFile`, `resolvePeer`, `rustBinary`, `serverFile`, `serverUrlFor`) were
  never documented and were pxsig's own internals; nothing in the Storybook addon or the examples
  imported them through the package.
  To update: code that imported one of the 27 reads what it needs from the project
  `openProject()` returns (its resolved config and store paths) or from `pxsig config --json`, or
  opens an issue naming what it needs.
- **`pxsig/dashboard` is types only at run time.** Its `types` condition still points at the UI
  contract, so `import type * as C from 'pxsig/dashboard'` is unchanged. Loading it in Node used to
  fail with a syntax error from the `.ts` source; it now throws `pxsig/dashboard is types only`.
  To update: import it with `import type` only.
- **The dashboard shows no path.** The read-only note and the Read only badge's hint named the
  workspace by its full path (`cd "/Users/<name>/…" && …`), which puts the user's name on screen
  and in every screenshot. They now name the folder by its own name ("in the uat-example folder,
  where pxsig serve runs") and show the command alone; the copy button copies the command.
  `GET /__pxsig/status`'s `approving` answers `folder` instead of `cwd`. When pxsig is not installed
  in the workspace, the command is `pxsig serve --link` (a global install) instead of `node` and
  the path to pxsig's own file.
  To update: a client that read `approving.cwd` reads `approving.folder` (the folder's name only).
- **A number flag with a bad value is an error: `pxsig` exits 2 and runs nothing.** A value that
  was not a number was read as the default, so `pxsig serve --port notaport` served on 6070 and
  `pxsig list --limit 0` showed 30 rows, without a word. Now every `<n>` flag takes a whole number
  (`--retries`, `--settle-ms` and `--min-cell-px` from 0, the others from 1; a port up to 65535)
  and a bad one is named: `pxsig: --port takes a whole number from 1 to 65535 (got "notaport")`.
  To update: a script that passes such a value now fails; pass a number in the range, or leave the
  flag out.
- **The peer ranges start at the versions CI tests: `playwright >=1.58` (was `>=1.40`) and, for
  `@pxsig/storybook-addon`, `storybook >=10` (was `>=9`).** Playwright 1.58.2 is the oldest
  version CI runs pxsig with (the container image), and the examples test Storybook 10 only.
  Nothing changes at run time: pxsig does not check either version. A project that pins an older
  version sees the install report a peer conflict: pnpm and Yarn warn; npm 7 and later stops with
  `ERESOLVE` unless run with `--legacy-peer-deps`.
  To update: move to Playwright 1.58 or later and Storybook 10, or keep the older version and
  accept the warning (`--legacy-peer-deps` on npm); older versions are untested.
- **`pxsig dashboard build` with no adapter configured now builds the plain adapter.** It used to
  pick the `hydrotik` reference adapter, which needs a checkout of a design system that is not
  public, so the build failed everywhere but on the maintainer's machine. The order is now `--ui`,
  `PXSIG_UI_ADAPTER`, `dashboard.ui` in `pxsig.config.json`, `hydrotik` when `PXSIG_DS_SOURCE` is
  set, then `plain`; the build prints which rule picked the adapter. The prebuilt dashboard in the
  npm package is unaffected.
  To update: for the reference look, pass `--ui hydrotik` or set `PXSIG_DS_SOURCE`.
- **`GET /__pxsig/projects` no longer sends the workspace's absolute path.** Its `workspace` field
  (the path, which contains the user's name) is replaced by `workspaceId`, the same hash of the path
  `GET /__pxsig/status` answers. Each project's `root` stays relative to the workspace; a project on
  another drive (Windows) is named by its folder alone.
  To update: a script that read `workspace` from this answer runs `pxsig projects --json` instead,
  which computes the path in its own process.
- **One entry, one decision: Approve story is off by default.** The inspector no longer offers
  **Approve story** (every waiting mode and state of a story in one click), and the server refuses
  `POST /__pxsig/approve-story` with 403, so each entry is approved after a person has looked at it.
  To update: approve each entry on its own; a client of `POST /__pxsig/approve-story` handles the
  403, or the project sets `approvals.byStory: true` in `pxsig.config.json` to bring it back.
- **The CLI, the MCP server and the Storybook addon use only their own workspace's server.** Every
  `pxsig serve` tries port 6070 first, so with no server running for a workspace, its commands
  reached whichever workspace's server held the port (another checkout or worktree with the same
  project name got its checks queued there). `GET /__pxsig/status` now names the workspace it serves
  (`workspaceId`, a hash of its path, not the path), and a client uses a server only when the id is
  its own. Another workspace's server counts as not running: `pxsig check` runs in this workspace
  instead and says why, `pxsig status` shows the server as down with the reason, `pxsig serve
  --link` and `pxsig approve apply` stop. A server from pxsig 0.6 or earlier names no workspace and
  is used only at the address this workspace's `server.json` (or the addon's `server` option)
  records. `PXSIG_URL` still picks a server: a mismatch there is one warning line.
  To update: start `pxsig serve` in each workspace that uses one (and restart a server from 0.6.0
  so it names its workspace), or set `PXSIG_URL` to the server meant.
- **An unknown flag is an error: `pxsig` exits 2 and runs nothing.** Until now a misspelled flag
  printed a warning and the command ran without it, so `pxsig check --ful` ran the quick check and
  `pxsig init --nmae web` wrote a config with the default name. The message is the same, with the
  nearest known flag (`pxsig: unknown flag --ful (did you mean --full?)`). `pxsig cat` is
  unchanged (the engine checks its flags).
  To update: a script or CI step that passes a misspelled or retired flag now fails; correct the
  flag the message names, or remove it.

### Behaviour changes

- **The a11y pass uses pxsig's own axe-core, not the project's.** A project (or workspace root)
  with its own `axe-core` used to override the version pxsig declares, so a11y results could change
  when an unrelated tool bumped it. pxsig now resolves `axe-core` from its own install first, and
  falls back to the project's only when its own cannot be found. New axe violations after
  upgrading come from that version change, not the stories.
  To update: nothing to do; to choose the axe version, pin pxsig.
- **The render environment records the axe-core version** as `axe` (a minor field), in each
  `.psig` header and in `check.json`; `pxsig dashboard check` writes it to `report.json`. A
  baseline written before this compares as `compatible` with `envDiff: ["axe"]`, never as a
  mismatch, and its `id` does not change.
  To update: nothing to do; to leave the field out of comparisons, set `env.ignore: ["axe"]`.
- **`check` no longer retries an entry with no baseline yet.** A NEW entry has nothing to compare
  with, so a fresh render could not pass; it was re-rendered `--retries` times and the retry lines
  counted it. A first `check --full` on a new project is faster (6.6 s → 2.5 s on 12 entries).
  To update: nothing to do; the entry is still NEW and fails the check until it is approved.
- **`pxsig dashboard check` records a screen whose layout never held still.** Such a screen gets
  `"settled": false` in `report.json` and is listed under "Still moving" in `summary.md`. The
  field is absent for every other screen, so existing readers see no change. A screen listed there
  has an animation or a resize that runs longer than 2 s.
  To update: nothing to do; a reader of `report.json` may treat a missing `settled` as `true`.
- **`pxsig dashboard check` records a page load it retried.** Such a screen gets
  `"retried": "ERR_NO_BUFFER_SPACE"` in `report.json` and is listed under "Retried" in
  `summary.md`. The field is absent for every other screen, so existing readers see no change. A
  screen listed there loaded on the second try.
  To update: nothing to do.
- **`pxsig doctor` before a manifest exists prints a setup preflight.** It used to print
  `no readable manifest at …` twice and stop. It now lists the engine binary and its version, the
  Playwright package that resolves and its version, whether Playwright's Chromium is present (a
  file check; no browser starts), the configured Storybook URL and `staticDir` (nothing is
  fetched), and the assistant marker; then the error once and `pxsig manifest` as the next step.
  The exit stays 2. `--json` gives `{ error, preflight, next }`, and the MCP tool `pxsig_doctor`
  adds the same `{ preflight, next }` after its error.
  To update: a script that matched the error on stderr reads it from stdout now, or uses
  `--json` (`error`).
- **React is declared as an optional peer (`react >=19`).** `pxsig/diff-viewer` and
  `pxsig dashboard build` use the project's React; the dashboard's UI contract passes `ref` as a
  prop, which needs React 19. Package managers now warn when a project has an older React
  installed; projects without React are unaffected.
  To update: use React 19 with `pxsig/diff-viewer` and `pxsig dashboard build`, or accept the
  warning.
- **`pxsig init` records the package's Storybook folders.** A new `pxsig.config.json` gets
  `storybook.configDir: ".storybook"` when the folder has `.storybook/`, and
  `storybook.staticDir: "storybook-static"` when it has a `storybook-static/` folder; init lists
  what it recorded. A flag for the same key wins, and an existing config is never edited.
  To update: check the config `init` writes; to keep a key out, remove it there, or pass the flag
  with the path you want.
- **The dashboard link has 5 minutes to be accessed, up from 2.** The time is only to open the link;
  once opened, that browser can approve until `pxsig serve` stops or the browser closes. Every
  message now says so in those words ("5 minutes to access this link").
  To update: nothing to do; a script that matched the old wording ("within two minutes") matches
  the new one.
- **`pxsig manifest` names the Storybook it read and warns about a project it does not match.**
  The heading reads `from <storybook.url>/index.json` (or `from <staticDir> (served at …)`), and
  `--json` adds `source: { url, staticDir }` and `warnings`. A warning is printed when `srcRoot`
  does not exist or when none of the index's stories is under the project, which is what another
  package's Storybook on the same port looks like; the exit code is unchanged. The
  "no stories in srcRoot" error now also names the index it read.
  To update: nothing to do; when a warning appears, set `storybook.url` (or
  `storybook.configDir`, `srcRoot`) in `pxsig.config.json`.

### Added

- **The prebuilt dashboard records how it was built.** `dist/dashboard/BUILD.json` in the `pxsig`
  package names the UI adapter, the design-system commit (and whether its checkout had changes),
  the lockfile hashes, the Node version, the build time and the third-party packages compiled
  into the bundle with their versions and licences. The release's `pxsig-npm.cdx.json` now lists
  those packages too. Nothing to do; nothing reads the file at run time.
- **`pxsig dashboard check --compare <dir>`** compares each screen with the same screen of an
  earlier check's output (its `--out`), using the engine and the gates stories get. Changed, new
  and gone screens are listed in `summary.md` and `report.json` (`compare` per screen: status,
  SSIM, changed cells), and the gallery shows the earlier screenshot and the changed pixels beside
  each changed screen, with a "changed screens only" filter. Advisory: a change never fails the
  check. Use it to see what an adapter or design-system change moves.
- **`pxsig dashboard check` measures each screen's layout.** After a screen renders it records
  layout findings beside axe: the page scrolling sideways at 1280 or 900 px wide, content cut off
  by `overflow: hidden` (truncated text passes when a `title` or `aria-label` holds it), controls
  in one toolbar line that differ in height or bottom edge, text or controls within 2px of a drawn
  frame, and controls drawn over each other. They are in `report.json` (`layout`, and
  `summary.withLayout`), `summary.md` and the gallery. Advisory; `--strict` fails on them as it
  does on axe. An element opts out with `data-layout-allow="<reason>"`.
- **The dashboard names the application under review: `pxsig • <scope>`**, in the top bar and the
  browser tab, so one workspace's dashboard is never taken for another's. A new `label` in
  `pxsig.workspace.json` names the whole workspace (`"label": "hydrotik ds"` reads
  `pxsig • hydrotik ds`); without it the project's `label`, else its name, as before. The dashboard
  data gains `scope` (additive); `pxsig config` prints the title. See
  "The dashboard title" in `docs/configuration.md`.
- **`pxsig init --storybook-static <dir>`** writes `storybook.staticDir`: a Storybook build that
  `manifest`, `check` and the server serve themselves when nothing answers at `storybook.url`, so
  pxsig works without a running Storybook. The `pxsig init` section of `docs/cli.md` has a
  three-line quick start.
- **Every published package carries the MIT licence file.** `pxsig`, each `@pxsig/cli-*` package
  and `@pxsig/storybook-addon` now hold `LICENSE` at their root, so a licence scanner reading the
  installed packages finds it. The licence itself is unchanged. Nothing to do.
- **`pxsig serve --link --copy`** also copies the new link to the clipboard and says so (`pbcopy` on
  macOS; `wl-copy`, else `xclip`, on Linux; not on Windows, where pxsig starts no shell). Opt-in:
  any program on the computer can read the clipboard, while the printed link reaches only the person
  at the terminal. Refused, like `--link`, without a person at a terminal.
- **`pxsig serve --link --open`.** Opens the new dashboard link in the default browser as well as
  printing it, so a person at a terminal does not copy it by hand: on macOS an open Chrome tab on
  the dashboard is reused, else `open`; on Linux `xdg-open`; on Windows nothing is started and the
  link is only printed. Refused like `--link` outside a person's terminal (exit 3). `pxsig serve
  --open` without `--link` is a usage error (exit 2): `pxsig serve` already opens a tab unless
  `--no-open`.
- **A built-in `plain` UI adapter** (`dashboard/src/ui/adapters/plain/`): the dashboard on semantic
  HTML and one stylesheet, by name with `--ui plain`. It is the same adapter as
  `examples/custom-ui/pxsig-ui`, which stays as the example of a project's own adapter.
- **The top bar says whether this page can approve.** Beside the connection badge: `Live · Read
  only` (the page holds no dashboard link), `Live · Can approve` (it opened one), or `Static report
  · Read only`; Offline is unchanged. The hint on `Read only` names the command for a new link, in
  the folder the server serves (`pnpm exec pxsig serve --link`, `yarn pxsig …`, `npx pxsig …`, or
  `pxsig serve --link`).
- **The inspector says Read only before any click.** Without the dashboard link, a note under the
  header gives the command with a copy button, and Reject, Approve and Undo stay in place,
  disabled, with the reason as their title. `GET /__pxsig/status` answers `approving`: `allowed`
  (whether the request carries the link's session; never the session itself), `folder` (the
  folder's name only) and `command`.
- **`workspaceId` in `GET /__pxsig/status`** (`docs/server.md`, "Reading").

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
- **The top-level help lists every command and topic, and names no internal files.** `pxsig help`
  and `pxsig --help` are built from the same source as `pxsig help <command>`: every command and
  subcommand with its summary and usage (`dashboard check`, `init --label`, `serve --link` and
  `doctor --repair --only log-torn` included), `pxsig version`, the commands that need a person
  at a terminal, and the topics. Terminal, Markdown and `--json` output follow the
  chosen format like any other help page. `pxsig help topics` lists the topics with their titles.
- **One list of the commands that need a person.** `pxsig help exit-codes` now names `doctor
  --repair --only log-torn --apply`, and `pxsig help serve` lists exit 3 for `--link`, like the
  other pages.
- **The title's separator is `•`** (`pxsig • demo`, was `pxsig · demo`). A project's `label` still
  names it in the project switcher.
- **`pxsig serve` says when it could not open a browser.** A missing or failing `xdg-open` or
  `open` at start printed nothing; it now prints one line saying to open the link above.
- **The Linux platform packages declare `libc: ["glibc"]`.** `@pxsig/cli-linux-x64` and
  `@pxsig/cli-linux-arm64` hold glibc builds (`*-unknown-linux-gnu`), which do not run on a musl
  host such as Alpine. npm and pnpm now skip them there instead of installing a binary that fails
  to start, and pxsig reports the engine binary as missing. On a musl host, set `PXSIG_BIN` to a
  pxsig binary built for it, or run pxsig in the container image (Ubuntu, glibc).
- **The `approvals.level: "strict"` error no longer cites "decision 78"**, a number from a design
  document that is not in the repository. The message is otherwise the same.
- **The dashboard link's timing is said in full everywhere.** The time limit is only to open the
  link, which works once; once open, that browser can approve with no time limit until `pxsig
  serve` stops or the browser closes. Reworded in `pxsig serve`'s start-up line, `pxsig serve
  --link`, the refusal of a used or late link, the dashboard's notes, `pxsig help serve`, and
  docs/cli.md, server.md and troubleshooting.md.

### Fixed

- **`pxsig dashboard check` screenshots of the inspector are taken after its diff is drawn.** The
  screenshot used to be taken as soon as the screen's landmark appeared, while the inspector was
  still loading, analysing and fitting its images, so two runs on the same build could differ on
  the 7 inspector and embed screens. The inspector now marks its stage `aria-busy` until it has
  settled, and `dashboard check` waits for that (up to its usual 10 s), then for every image to
  decode. Nothing visible changes; a screen reader also learns that the stage is still loading.
- **`pxsig dashboard check` waits for the layout to hold still before each screenshot.** A chart
  that resizes a moment after it first draws (a debounced resize observer, as in Recharts) was
  captured at its first size. The screenshot now waits until no element has moved for 6 frames
  (about 100 ms), for at most 2 s. The whole check takes about the same time.
- **`pxsig dashboard check` no longer fails a screen when Windows runs out of socket buffers.**
  With several screens loading at once, Windows could refuse a page load with
  `net::ERR_NO_BUFFER_SPACE`, and the screen failed although nothing was wrong with it. That
  load is now retried once, after 500 ms. Any other error, or the same error twice, still fails
  the screen.
- **`pxsig check` says when it could not report integrity.** Its last line is the project's
  integrity from `pxsig doctor`; when the doctor failed (a report it could not read, a ledger it
  could not write) the line was left out without a word. It now reads
  `integrity: unavailable (<reason>)`, and `--json` adds `integrityUnavailable: "<reason>"` next to
  `integrity: null`. The exit code is unchanged.
- **A JSON file saved with a byte order mark is read.** Windows Notepad (and PowerShell's
  `Out-File -Encoding utf8` in Windows PowerShell 5) start a UTF-8 file with a byte order mark, and
  pxsig failed on such a `pxsig.config.json` or `pxsig.workspace.json` with "is not valid JSON".
  pxsig now skips the mark in every JSON file it reads. A file saved as UTF-16 (Notepad's
  "Unicode", Windows PowerShell's `>` redirect) is refused with a message naming the file and its
  encoding (`<path> is UTF-16 LE; save it as UTF-8`). Nothing to do.
- **The READMEs on npm link to the documents of the version installed.** pxsig's README linked to
  the docs on `main`, which can describe features a published version does not have, and the
  Storybook addon's README and the dashboard README pxsig ships linked to `../../docs/…`, which
  leads nowhere outside the repository. The release now rewrites both kinds to
  `github.com/hydrotik/pxsig/blob/v<version>/…` when it packs, and fails a tarball that still has
  one. The repository's files are unchanged.
- **The inspector's Reject and Approve keep their place.** They end the review group at its right
  edge, with labels that no longer change width: Undo, Approve story (when on), Re-check and the
  new-violations note sit to their left, and the header holds one height whether or not the story
  has other modes. "Approve · accepts N new a11y violations" becomes the note "Approving accepts N
  new a11y violations" beside an unchanged Approve; in an accessibility session, "Accept N new"
  becomes "Accept violations" beside "N new violations". The Storybook panel's Details switch moves
  left of the buttons for the same reason.
- **`pxsig approve undo` and the dashboard's undo no longer revert a later approval.** Undoing a
  batch restored its old baseline even when the entry had been approved again in a later batch,
  so the later approval was reverted without a word (the undo was logged, the later approval's
  baseline was gone). Such an entry is now refused with "approved again in batch <batch> after
  this one: undo that batch first", and nothing is written for it. A baseline written outside the
  approval trail is restored as before (`approve verify` reports those).

### Security

- **No absolute path in what the dashboard reads.** A test fetches every answer the dashboard reads
  (status, projects, data, integrity, the event stream, the page) after a check and fails on the
  workspace's path or the home folder.
- **No absolute path in the server's project list.** Any program on the machine can read
  `GET /__pxsig/projects`; it now carries no part of the user's home folder.
- **A release fails on a known advisory in anything it ships.** The release scans its SBOMs (the
  npm install tree, the packages the dashboard bundle inlines, and the engine's crates) with a
  pinned osv-scanner, so a package that only the dashboard bundle contains, which no `npm audit`
  sees, is checked too. A dashboard attached to the GitHub release must now carry the `BUILD.json`
  its build writes, naming its adapter and design-system commit; one without it fails the release
  instead of shipping with a warning.

### Documentation

- The npm README names the platform packages as installed with pxsig, adds the first-run note
  (the first `check --full` exits 1; how to approve), lists the offline `pxsig help` topics and
  links the docs by absolute URL, so the links work inside `node_modules`. README: "no sign-in"
  in place of "no token".
- **The README lists every export.** `pxsig/diff-viewer` is TypeScript source for a bundler that
  compiles TypeScript and JSX (such as the Vite build `pxsig dashboard build` runs), not for Node.
- **The dashboard's Help page opens with how approving works.** A first section, "Approving From
  the Dashboard", explains the dashboard link and its ticket (`pxsig serve`, `pxsig serve --link`,
  `--open`, the opt-in `--copy`), its timing (5 minutes to access the link; once opened, no time
  limit until the server stops or the browser closes), why decisions need it, and the top bar's
  badges: `Live`, `Static report`, `Offline`, `Can approve`, `Read only`, and the title.
- **`QUICKSTART.md`** in the repository root: install, first check, the dashboard and its link,
  reviewing one entry at a time, and CI, linked from the README.

## 0.6.0 - 2026-10-28

The deployed-Storybook and hardening release. A Storybook deployed to a shared environment shows
each story's committed baseline and history from a read-only snapshot (`pxsig snapshot`), and its
panel no longer tries to reach a server on each viewer's computer. Bad input that used to crash a
command (a story parameter of the wrong type, an approval plan that names a removed entry, a
broken lock file, a malformed engine or MCP line) is now refused with a message that names it.
The engine moves to `png` 0.18 with pixel-identical decoding, and the prebuilt dashboard is built
with Vite 8; `pxsig dashboard build` works on Vite 6, 7 and 8. Read **Behaviour changes** first:
`storybook build` writes the snapshot, `pxsig manifest` checks `parameters.pxsig`, and `pxsig stale`
fails when too many files were edited to trace. An unknown flag still prints a warning, as in
0.5.1: making it an error is not part of this release.

### Behaviour changes

- **The Storybook panel connects only on a Storybook served from this computer.** On any other
  address (a Storybook deployed to dev, UAT or pre-prod) it no longer polls `127.0.0.1:6070` on
  each viewer's computer, which could never connect there and could make the browser ask about
  local network access; it shows the read-only snapshot below, or says there is none. A
  `pxsig-server` key in `localStorage` still forces the live panel.
- **`storybook build` with the addon writes `pxsig-snapshot.json` into the build** and takes a
  few seconds longer. Option `snapshot: false` leaves it out. It never fails a build.
- **`pxsig manifest` checks each story's `parameters.pxsig`.** A key with a value of the wrong
  type (`grid: '96'`, `ignore: '.live'`, `addModes: 7`, a state with no `name`) is a setup error
  (exit 2) that names the story and the key, as a bad value in `pxsig.config.json` is. Before, it
  crashed the command with a TypeError or went into the manifest as written. A repair that
  registers the story reports the same error. Fix the parameter the message names.
- **`pxsig stale` fails when too many files were edited to trace.** Above the number of edited
  files it traces one by one, it used to print "Every result is newer than the edits that can
  change it." and exit 0. It now says how many source files were edited since the oldest verdict,
  names `pxsig check --all`, and exits 1 (`advisoryExit` on warn), as for stale verdicts.
- **`pxsig list` and `pxsig a11y` refuse a flag given without its value.** A bare `--component`,
  `--mode` or `--state` used to stop with "toLowerCase is not a function" or match nothing. It now
  exits 2 with "usage: --component needs a value" (naming the flag).

### Added

- **`pxsig snapshot`**: a read-only summary of the committed store for a deployed Storybook: each
  entry's baseline, last change (date, pull request, commit, colour or shape, reason), render
  environment and accepted axe rules, and each story's history. It reads the store and git only,
  and never carries who approved, how, file paths or images. In a shallow clone it shows no pull
  request rather than a wrong one.
- **A deployed Storybook's panel shows that snapshot** for the current story, matched to the
  commit the Storybook was built from.

### Changed

- **The engine reads and writes PNG with `png` 0.18** (was 0.17). Decoding is pixel-identical (checked
  on 1,741 images: every render, diff and heat image in a real store, and every colour type and bit
  depth), so signatures, comparisons and verdicts do not change. PNG files the engine writes from
  now on (a trimmed render, a diff image) hold the same pixels but compress to different bytes.
- **The prebuilt dashboard is built with Vite 8.** The bundle in the `pxsig` package
  (`dist/dashboard`) now comes from Vite 8 (Rolldown) instead of Vite 6. It has the same features
  and renders the same screens; it still runs as a classic script, so a static report opens from
  disk.
- **`pxsig dashboard build` works on Vite 6, 7 and 8.** It uses the project's own Vite as before.
  On Vite 8 the build no longer warns about `inlineDynamicImports`, and `PXSIG_DASHBOARD_MINIFY=1`
  uses that Vite's own minifier (Oxc on 8, esbuild before).

### Fixed

- **`pxsig serve` clears a project's load error once its manifest loads again.** The project list
  (`GET /__pxsig/projects`, the dashboard) kept showing the old error after a later reload worked.
- **`pxsig serve` skips an engine output line that is not a JSON object.** A `null` line, a number
  or text that is not JSON used to stop the server (and, in the affected-files lookup, leave the
  request waiting forever); such a line is now ignored and the next answer is read as usual.
- **The workspace schema describes `defaults` paths correctly.** Its description said a path in
  `defaults` resolves against each project's folder; pxsig resolves it against the workspace root,
  as `docs/configuration.md` says. Editors that show the schema now say the workspace root.
- **`pxsig approve apply` refuses a plan with an entry the manifest no longer has.** It used to
  stop with "Cannot read properties of undefined". It now refuses the whole plan before writing
  anything: "<n> planned entries are no longer in the manifest: <ids>: plan again" (exit 2).
- **A project folder in `pxsig.workspace.json` that is not a string** is a setup error naming the
  file and the project, instead of Node's "The "paths[1]" argument must be of type string".
- **A command whose lock file became unreadable** says "lock taken over by an unreadable lock file
  (<path>)" instead of "`pxsig undefined` (pid undefined, since undefined)".
- **`GET /__pxsig/integrity?project=<p>&story=<id>`** answers with the project asked about when
  two projects share the story, not the first of them.
- **`pxsig serve`: a check queued while the manifest became unreadable** reports "the manifest did
  not load — <why>" instead of "Storybook is not reachable".
- **A Storybook index whose `entries` is null** is reported as a broken index instead of throwing.
- **`pxsig serve`: an engine reply with neither a result nor an error** fails that request instead
  of an uncaught exception.
- **`pxsig help approvals.identity` and `pxsig help approvals.level`** print their pages instead of
  "entry.values.join is not a function".
- **`pxsig help check ''`** prints the `check` page; an empty subcommand word is ignored.
- **`pxsig entry <id>`** shows the review decision (approved, rejected) instead of always `none`.
- **`pxsig affected`** notes the remote URLs it does not follow when a changed file imports one.
- **The MCP server answers a line that is not a JSON-RPC object** (`null`, a number, a string, an
  array) with the Invalid Request error (-32600) and keeps serving; `null` used to stop it.

### Documentation

- **`docs/team.md`: how pxsig works across a team.** What is shared and what stays on each
  machine, the workflow from check to merge, where pxsig runs in each environment, and why.
- **Which browser renders.** `docs/platforms.md` and `pxsig help platforms` now say what pxsig
  has always done: when Playwright's Chromium is missing, it launches the installed Google Chrome,
  then Microsoft Edge, and the channel is part of the render environment. A test ties both pages
  to the code's list.
- **Troubleshooting.** `docs/troubleshooting.md` and a new `pxsig help troubleshooting` topic: one
  entry per error pxsig prints (Storybook not reachable, no manifest, no Chromium, a different
  Storybook on the port, a locked store, `needs-dashboard-link`, a program blocked by policy, a
  JSON file with a byte order mark), each with its cause and fix. A test checks that every quoted
  error text is in the code.
- **Architecture.** `docs/architecture.md` lists the modules added since 0.4: the render
  environment, warn mode, SARIF, the browser container, `pxsig dashboard check`, the addon's
  snapshot view and the JSDoc types.
- **Contributing.** `CONTRIBUTING.md` covers installing Playwright's Chromium (the tests that
  render skip without it), running each suite, changelog fragments and `Changelog: none`, why CI
  job names never change, and how a dependency advisory is handled. The repository pins Node.js
  in `.nvmrc` and declares `rust-version` in `Cargo.toml`; `pnpm test` at the root runs every
  suite.
- `docs/ui/build-adapter.md` names the Vite versions `pxsig dashboard build` supports, and the
  Node.js version Vite 8 needs.

## 0.5.1 - 2026-10-27

The Windows and review release. The Windows engine no longer needs the Visual C++ Redistributable,
so it starts on a managed machine that has only Windows and Node. The dashboard title can carry a
project label (`pxsig · Hydrotik`), the versions show on hover, and every dashboard screen passes
axe. `pxsig setup vscode` names the assistant directly, `pxsig --version` prints the versions, and
a misspelled flag is reported instead of silently ignored. The repository gains lint, format and
pinned-toolchain gates. Read **Behaviour changes** first: the package needs Node 22, an unknown flag
prints a warning on stderr (the exit code is unchanged), and `--version` no longer runs `status`.

### Behaviour changes

- **The report's modes moved in the dashboard's top bar.** The `dark · light` badge sits at the end
  of the bar beside the connection badge (Live, Offline or Static report) instead of beside the
  title. It still hides on a narrow window. Layout only: nothing else in the bar moves.
- **`engines.node` is `>=22`** for `pxsig` and `@pxsig/storybook-addon` (was `>=20` for `pxsig`).
  Node 20 reached end of life in April 2026 and was never tested; CI runs Node 22. npm prints an
  `EBADENGINE` warning on Node 20, and refuses the install only with `engine-strict`.
- **An unknown or misspelled flag prints a warning** on stderr, with the closest known flag and,
  when it took the next word as its value, that word: `pxsig: unknown flag --nmae, ignored (did you
  mean --name?); it took "foo" as its value`. The command runs as before and the exit code is
  unchanged; 0.6.0 is planned to make it an error. `pxsig cat` passes its flags to the engine and
  is not checked.
- **`pxsig --version` prints the versions** (`pxsig 0.5.1 (engine 0.5.1, UI contract 1.1.0)`;
  `--json` as data) and exits 0. It used to run `status`.

### Added

- **`label` in `pxsig.config.json`**: the dashboard title after "pxsig ·", for example
  `"label": "Hydrotik"`. 1 to 60 characters; without it the title is the project name, as before.
  `pxsig init --label <text>` writes it, and a person at a terminal setting up a new config is asked
  once (Enter keeps the name; CI, an assistant or piped output is never asked). `pxsig config` shows
  the title, and the project switcher lists projects by their label.
- **The versions that drew the page.** Hovering "pxsig" in the top bar shows the pxsig, engine and
  UI contract versions; the Help section ends with the same line as text. The dashboard data gains
  `label` and `versions` (additive).
- **UI contract 1.1.0: an optional `Tooltip`** (`content`, `children`). An adapter without it gets
  the element's native `title` (docs/ui/contract-changes.md). The hydrotik reference adapter maps it
  to its design system's Tooltip.
- **`pxsig setup <assistant>`**, for example `pxsig setup vscode`, the same as `--assistant
  vscode`. Before, the word after `setup` could only be the step name and `setup vscode` exited 2.
  `pxsig version` is the same as `--version`.

### Changed

- **Contributors: one format for the repository.** oxfmt with the hydrotik monorepo's settings, and
  `cargo fmt`, checked in `Clean repository` and the Linux `Rust` job and applied to staged files
  by the pre-commit hook. The one-time reformat is listed in `.git-blame-ignore-revs`
  (`git config blame.ignoreRevsFile .git-blame-ignore-revs`). Nothing in the published packages
  behaves differently.
- **Contributors: oxlint, sherif, clippy and commitlint run in CI** (`Clean repository` and the
  Linux `Rust` job; no job names changed). oxlint errors fail; oxlint warnings may only go down
  against `scripts/lint-warnings-baseline.json`. The release checks each packed tarball with
  publint. `pnpm install` sets up git hooks that lint staged files and check commit subjects
  (CONTRIBUTING.md). Apart from the inspector fix, nothing in the published packages changes.
- **The Rust toolchain is pinned to 1.99.0** (`rust-toolchain.toml` and every workflow), so
  clippy's lints and the release binaries change only when the pin is bumped on purpose. The
  release binaries were already built with 1.99, the current stable.
- **The dashboard bundle ships unminified.** `dist/dashboard/assets/app.js` in the npm package now
  reads as code, so a reviewer can audit what runs. `PXSIG_DASHBOARD_MINIFY=1` at build time (also
  for `pxsig dashboard build`) minifies it.
- **The published `package.json` files carry no `scripts` or `devDependencies`.** `pxsig`'s
  `prepack` pointed at a file outside the package; the release now runs that step itself, strips
  both keys (`scripts/pack-manifest.mjs`) and fails if a packed manifest still has them.
- **The research harness's token overrides are no longer code.** A scenario's `tokens` value is a
  literal, `{ "scale": n }` or `{ "mix": colour, "amount": pct }`; the `"fn:<body>"` form is refused
  with a message (`tools/`, not part of the npm package).

### Fixed

- **The dashboard passes axe on every screen `pxsig dashboard check` renders** (62, both themes), with
  no visible change: each screen was compared pixel for pixel before and after.
  - The loading and load-error pages, the Storybook panel and the decision window it opens have a
    main region and a level-one heading (read by assistive technology, not drawn). The panel's
    story title is a level-two heading, below it.
  - A heatmap tile's text is read as "Card 2 stale of 2", so it is inside the tile's name (WCAG
    2.5.3, label in name); it was read as "Card2 stale of 2".
  - An alert's title is not a heading: the hydrotik reference adapter removes the heading role from
    its design system's title, as the default dashboard draws it as bold text. The UI contract says
    so; no props changed, so the contract version stays 1.1.0.
- **The container image's smoke test installs the examples with the repository's pnpm.** The staged
  example sits outside the checkout, so Corepack fetched the newest pnpm (12), which fails on
  ignored build scripts; the 0.5.0 image build stopped there, before pushing anything.
- **The inspector no longer breaks React's rules of hooks.** A hook ran after an early return, so a
  render without an entry followed by one with an entry could fail with "Rendered more hooks than
  during the previous render". Found by the new linter.
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

### Security

- **pxsig evaluates no code at runtime.** axe-core is added to the rendered page with Playwright's
  `addScriptTag` instead of `new Function`, in `check` and `dashboard check`.
- **`SECURITY.md` lists what package scanners report** (programs started, network, URL strings,
  environment, filesystem, dynamic import, native binaries, the bundled page) with where each is in
  the code and what bounds it. The links in the coding-assistant marker table moved from the code
  to `docs/agents.md#sources`.

## 0.5.0 - 2026-10-27

The environment release. Every render records the environment that produced it, every baseline
keeps it, and a check says when a render and its baseline came from different machines
(`--strict-env` refuses instead). A pinned Linux image, `ghcr.io/hydrotik/pxsig`, renders the same
pixels everywhere, either for the whole check or only for the browser. Each gate can be set to
`warn` while a team adopts pxsig, and only committed config or a person at a terminal can do it.
`pxsig dashboard check` renders every dashboard screen on an organisation's own adapter beside the
reference dashboard. Read **Behaviour changes** first: new axe violations now print an ADVISORY line
(exit 0; `enforcement.gates.a11y: "off"` restores the old output).

### Behaviour changes

- None with the default settings. Baselines written before this version record no environment and
  compare as `unknown`, which never warns or refuses; the new line, `summary.md` line and setup
  warning appear only once baselines record an environment and a render's differs.
- **New axe violations are a gate on `warn` by default.** With no `enforcement` key every exit
  code and report is as before, except when a run finds a new violation (one not on an entry's
  accepted list): `check` then prints one `[pxsig] ADVISORY: would have failed (exit 1): N entries
  with new a11y violations. Not blocking.` line, `summary.md` opens with an advisory lead and
  `check.json` carries `enforcement`. The exit stays 0 and no readiness line is written.
  `enforcement.gates.a11y: "off"` removes it; `"enforce"` makes new violations fail the run
  ([migrating.md](docs/migrating.md)).

### Added

- **The container image `ghcr.io/hydrotik/pxsig:<pxsig>-pw<playwright>`** (amd64 and arm64, amd64
  canonical): pxsig and its engine, Playwright's three browsers and a fixed font set on Ubuntu
  24.04, so renders are the same on every machine. Tags never move (`-rN` for a rebuild) and there
  is no `latest`; each image has a provenance attestation. Built by `.github/workflows/image.yml`
  after each release, by hand for a new Playwright, with a weekly check for one
  ([docs/container.md](docs/container.md)).
- **Two ways to use it.** The whole check in the container (`docker run … pxsig check --full`), or
  only the browser: `pxsig browser start|stop|status` runs Playwright's browser server in the image
  on `127.0.0.1`, and `--browser <ws>` (also `PXSIG_BROWSER_WS`, `capture.browserEndpoint`) makes a
  check or `pxsig serve` render there while Storybook and the engine stay on the host. The render
  environment then reports the container's browser and image.
- **`PXSIG_PLAYWRIGHT`**: a Playwright package folder pxsig loads before the project's (the image
  sets its own). `pxsig doctor` warns (`image-mismatch`) when, inside the image, the Playwright or
  the pinned pxsig differs from the image's.
- `docker` joins "Programs pxsig starts" (docs/platforms.md): only `pxsig browser` starts it.

No behaviour change: without the image, `--browser`, `PXSIG_BROWSER_WS`, `capture.browserEndpoint`
or `PXSIG_PLAYWRIGHT`, browsers launch and Playwright resolves exactly as before.
- **`pxsig dashboard check`**: every dashboard feature's screens rendered on a project's adapter
  build (`pxsig dashboard build`), from sample data that ships with pxsig, in both themes, with
  Playwright's Chromium. It writes a gallery (`node_modules/.cache/pxsig/dashboard-check/index.html`)
  that sets each screen beside the same screen on the prebuilt reference dashboard, plus
  `report.json` and `summary.md`, and runs axe on each screen. Axe findings are advisory;
  `--strict` makes any of them fail. Exit 1 when a screen does not render (its landmark never
  appears, or the page throws); 2 with no build, no Chromium, or an adapter for an older major UI
  contract. It reads no project data, answers the dashboard's requests itself (nothing is written)
  and writes only its output folder. `--only <feature,…>` and `--themes` narrow it; `--reference
  <dir>` names another dashboard to compare against. It replaces the hand walk-through in
  docs/ui/build-adapter.md "Verify" (kept as the fallback without Chromium).
- **Screens in the feature registry.** Each feature in the dashboard's `src/ui/features.ts` lists
  the screens the check renders (a sample scenario, an address, clicks, and the landmark that shows
  it rendered); `node scripts/ui.mjs check` fails a feature without one. The sample scenarios
  (`fixtures/scenarios.mjs`) are shared with the dashboard's own browser tests.
- `examples/custom-ui` gains `pnpm dashboard:check`, and the end-to-end examples run it on every
  pull request, on macOS, Linux and Windows.

No behaviour change: a new subcommand; nothing else reads the new files.
- **Every render records its environment, and every baseline keeps it.** A check collects, once per
  browser, which browser and version, Playwright, OS, a font-measurement digest, screen scale, GPU
  class, colour gamut, timezone, locale, capture pipeline and pxsig versions produced the renders
  (docs/configuration.md#env). A baseline written from a render keeps that render's environment in
  its `.psig` header (`env`; an approval in the dashboard writes the environment of the render being
  approved, never of the approving machine). Nothing in it names the machine or a person: no host
  name, user name, GPU model or font list.
- **Renders compared with their baseline's environment.** Each `check.json` row gets `env`,
  `baselineEnv`, `envMatch` (`same`, `compatible`, `mismatch`, `unknown`) and `envDiff`; the report
  gets `envs` and `summary.envMismatch`. A mismatch in a major field (the browser's major version,
  the fonts, the GPU class, timezone, locale) adds one `[check] env:` line, a line in `summary.md`,
  and an `env-mismatch` setup warning in `pxsig doctor` and the dashboard's coverage banner. MCP
  `pxsig_status` gains `env`, `pxsig_entry` the row's env fields.
- **`check --strict-env`** (config `env.strict`, `PXSIG_STRICT_ENV=1`) refuses before rendering,
  exit 2, when a selected baseline was approved in a different environment. Off by default.
- **Config `env.ignore` and `env.fontProbe`**: fields left out of the comparison, and font families
  measured besides the generic ones.
- **`pxsig baseline --env @file`** writes each entry's environment into its header; `pxsig attach`
  keeps every header key it does not own.
- **`engine-old`** setup warning: an engine binary older than the CLI writes baselines without `env`.
- **Warn mode.** `enforcement` in `pxsig.config.json` (or the workspace file's `defaults`) sets
  each gate to `enforce` (as before) or `warn`: `visual` (`check`), `a11y`, `verify` (`approve
  verify`'s baselines with no log line), `env` (`--strict-env`'s refusal), `doctor`, `stale`. A
  warned gate runs the same checks on the same selection and exits `advisoryExit` (0, or 10 to 125)
  where only it would have failed. It says so everywhere: ADVISORY first and last lines on the
  CLI, `enforcement` and `git.head` in `check.json` (with the gates each status context carries),
  a lead block in `summary.md`, a `pxsig.enforcement` property in `junit.xml`, `enforcement` and
  `wouldFail` in `history.ndjson`, the setup codes `enforcement-warn`, `enforcement-ending` and
  `enforcement-expired` in `pxsig doctor` and the dashboard banner, an `Enforcement` row in
  `doctor`, a `Warn mode` row in `status`, the gate table in `pxsig config`, and MCP fields
  (`pxsig_status.enforcement`, `pxsig_check`'s `enforcement` and `wouldFail`, `pxsig_history`'s
  `wouldFail`). Setup errors and person-only refusals are never warned; a mismatched baseline or a
  rewritten log fails `approve verify` in every mode. Only committed config, or `--warn` from a
  person at a terminal, lowers a gate; `--enforce` and `PXSIG_ENFORCEMENT=enforce` raise one for
  anyone; `PXSIG_ENFORCEMENT=warn` is refused. `warnUntil` ends warn mode on a date, announced
  from `noticeDays` before. Each warned run adds a line to a readiness tally in the repository's
  state folder outside the repository (shared by every worktree; 90 days, 5,000 lines per project
  and gate set).
- **`--sarif <file>`** on `check --full` and `pxsig a11y`: new axe violations as SARIF 2.1.0, for
  code-scanning viewers. Changes no exit code.

### Changed

- **The first check after upgrading reads no cached results.** Cached check results now carry the
  baseline's environment id, so the cache key changed and the first run re-compares every entry
  (the renders are the same; it only takes the engine's full time once).
- **On Linux, pxsig starts `fc-list`** (when fontconfig is installed) once per browser launch, for
  a digest of the installed fonts (`fonts.system`, informational). It is listed in
  docs/platforms.md, "Programs pxsig starts". Never on macOS or Windows.

### Fixed

- **The release workflow publishes the packed tarballs.** `npm publish` was given
  `release-files/<name>.tgz`, which npm reads as a GitHub repository, so the 0.4.0 run failed
  before publishing anything. The path now starts with `./`, and a dry run tests that step: `npm
  publish --dry-run` for a new version, `npm pack --dry-run` for one already on npm (npm refuses
  even a dry-run publish over a published version).

## 0.4.0 - 2026-10-26

The trust release. Decisions that change a baseline need a person, and the log says how each one
was made, never who: approvals come from the terminal or from the dashboard through a one-time
link, assistants are recognised and refused, and `approve verify` is strict by default.
Selection no longer misses a change: every changed path is classed, imports of every kind are
followed, and an untraceable change checks everything and says why. pxsig now runs and is tested
on macOS, Linux and Windows, survives interrupted writes, prunes accepted accessibility rules that
no longer fire, ships help for every command, and publishes checksums, provenance attestations and
SBOMs with each release. Read **Behaviour changes** before upgrading: `approve verify` fails
baselines with no log line (`--adopt` covers them), and more pull requests check every entry until
`affects.ignore` lists the paths that never change a render ([docs/migrating.md](docs/migrating.md)).

### Behaviour changes

- **More coding assistants are recognised, in a real terminal too.** pxsig read five variables
  (Claude Code's and Codex's sandbox ones, and `PXSIG_AGENT`). It now reads the marker each
  assistant sets in the shell it runs commands in: `AI_AGENT` (VS Code agent mode, Claude Code,
  opencode), Copilot's, Claude Code's, Codex's, Gemini CLI's, Cursor's, Cline's, Roo Code's, Amp's
  and opencode's (docs/agents.md#markers). Under any of them the commands that need a person
  (`approve apply`, `approve undo`, `approve verify --adopt`, `check --full --update`, `doctor
  --repair --apply --prune`, `doctor --repair --only log-torn --apply`, `serve --link`) exit 3,
  and output is plain Markdown. Before, Copilot agent mode, Gemini CLI, Cursor, Cline and Roo
  Code ran them when they had a terminal. A person whose terminal sets one of these (the Claude
  Code IDE extensions' integrated terminal sets `CLAUDECODE`) runs those commands in another
  terminal. Editor variables (`TERM_PROGRAM`, `VSCODE_*`, `CURSOR_TRACE_ID`) are not markers.
- **Refusals say why.** Exit 3 is unchanged; the message now names the reason: "refused under
  copilot (AI_AGENT=github_copilot_vscode_agent)", "refused in CI (CI is set)" or "refused: output
  is piped".
- **Log lines written under a marker carry `agent`** (the assistant's name, never a person's).
  A `pxsig serve` started under a marker records it on the decisions an assistant sends (`via:
  mcp`), never on one a person made through the dashboard link or the CLI. Additive; `approve verify` reads lines with and without it.
- **An adapter written for an older major UI contract is refused.** `pxsig dashboard gaps` reports
  it as a problem (exit 1) and `pxsig dashboard build` refuses (exit 2), printing the migration
  notes; `pxsig serve` does not serve a build for another major contract and keeps the prebuilt
  dashboard. With contract 1.0.0 this cannot happen yet: every existing adapter is a 1.0.0 adapter.
  An adapter written for an older minor version builds as before, with a line naming what falls
  back.
- **An approval cut short by a crash is `interrupted`, not a mismatch.** When a baseline was
  written but its log line was not (the process died in between), `pxsig approve verify` lists it
  as interrupted, with `pxsig approve undo <batch>` as the next step, instead of "written outside
  the trail". The exit code is still 1. Only a batch that started after the entry's last log line,
  and whose snapshot holds the bytes that line logged, counts.
- **A live lock holder is never taken over for a quiet heartbeat alone.** The store lock now
  carries a heartbeat (every 5 s); a holder whose process is alive keeps the lock even when it has
  gone quiet (a laptop that slept). After 10 minutes without a heartbeat, a person running a
  writing command at a terminal may take it over by typing `TAKE OVER`; agents and CI get exit 3.
  A lock whose process is gone is still taken over at once, as before.
- **`approve verify` no longer fails on a torn approval-log line.** It used to stop with a JSON
  error; it now leaves the line out and counts it (`torn`).
- **The dashboard decides through the dashboard link, and no token is in any page.** The server
  put a token into the dashboard page whenever a request looked like a browser loading it, so a
  script sending two headers could read it and approve. Now `pxsig serve`, started by a person at a
  terminal, prints a one-time link (`…/report/#ticket=…`, two minutes, single use; macOS opens it);
  the page trades it for a cookie scripts cannot read, and approve, reject and accept carry that.
  Reading, checks, repairs and bookmarks work as before; the first decision in a tab without the
  link says how to get it. `pxsig serve --link` prints a new link. This supersedes the Unreleased
  "Security" entry's "one in the dashboard page when a browser loads it": reconcile it at release.
- **The Storybook panel decides through a small window.** Its frame is on another site, where the
  cookie is not sent: approve, reject and accept open a small window of the pxsig server for a
  moment, which records the decision and closes.
- **No personal data in new log lines.** Approval, repair and accessibility-decision lines no longer
  carry `by` (the git email, else the OS user name); the commit and the pull request say who.
  `approvals.identity: "git-email"` keeps the old field. Old lines are unchanged and still read.
- **`pxsig <command> --help` prints that command's page.** It printed the full command list; now
  it shows the command's usage, flags (with defaults and the setting or variable each overrides),
  exit codes, what it changes and examples (`pxsig check --help`, `pxsig approve apply --help`).
  `pxsig --help` and `pxsig help` alone print the command list as before.
- **`pxsig help <name>` prints one page** for a command, a subcommand, a topic (`approvals`,
  `exit-codes`, `platforms`, `dashboard`, `ci`), a setting (`pxsig help gate.threshold`) or
  `global`. Any name used to print the full list; an unknown one now exits 2 and names the
  nearest.
- **Selection follows every kind of import** (docs/ci.md, "What counts as an import"). The graph
  used by `check --since/--changed`, `pxsig affected`, `pxsig_affected` and `pxsig_check` now
  reads:
  - any imported file type (`.json`, `.svg`, `.md?raw`, fonts, images), CSS `@import`, `@use`,
    `@forward` and `url()`, `export … from`, `new URL('…', import.meta.url)`,
    `import.meta.glob`, `require.context`, `url()` in strings, and template-literal imports;
  - the TypeScript source behind a `.js` specifier, `tsconfig.json` `paths` and `baseUrl`,
    `package.json` `imports`, and the project's own and workspace packages through `exports`, a
    build output mapped back to its source;
  - imports from the Storybook config and other "affects every entry" folders: a file only
    `preview.tsx` imports (a global style sheet, the font faces) now selects every entry, where
    it selected nothing.
  More entries are selected than before, never fewer.
- **Unresolved imports are checked on every run.** An import pxsig cannot follow (a `virtual:`
  module, an unknown alias, a computed `import()`) adds the entries that reach its file to every
  run, and every entry when that file affects every entry (a fail-safe line, class
  `unresolved`). `pxsig affected` lists them. Watch and staleness leave them out.
- **`check --since/--changed` no longer misses a change.** When the selection is unsure, it now
  checks every entry and says why, where it used to select nothing silently. Each changed path
  gets one class (docs/ci.md, "How selection decides"). This applies to `check --since/--changed`,
  `pxsig affected`, and the MCP tools `pxsig_affected` and `pxsig_check`.
  - A changed `.psig` selects its entry. An approval-only pull request is now checked against
    renders from the job, where it checked nothing.
  - A changed `a11y.json`, manifest, `approvals.ndjson` or `a11y-decisions.ndjson` selects the
    entries whose records changed. A rewritten log, or a file that does not parse, selects every
    entry.
  - A path outside `srcRoot`, or a file under `srcRoot` that is not a module (an unimported
    `.json` or `.md`), selects every entry, unless `affects.ignore` lists it. **With no ignore
    list, most pull requests in a monorepo now check every entry.** After upgrading, run
    `pxsig affected --since origin/main` on a few recent pull requests: every `outside` line is a
    candidate for `affects.ignore`.
  - With no merge base (a shallow clone), every entry is selected, with a warning, where it
    diffed against the ref itself.
  - The workspace file and `storybook.configDir` now select every entry, like the project config.
- **Paths.** A rename counts both its old and its new path. Non-ASCII file names match. In a
  workspace nested inside the repository, committed changes now match (they never did); a path
  outside the workspace is `$repo/<path>`. A path through a symlinked folder is resolved.
- **Output.** `affected --json` gains `files` (each path's status, class, what it selects and
  why), `traced`, `mergeBase`, `warnings`, `baselines`, `records`, `removed`, `failSafe`,
  `ignored` and `otherSuites`. Its `reason` names the first path that selected everything.
  `pxsig affected` and the `check` line list those paths. `summary.md` gains one line, only then:
  "All N entries selected: `<path>` (`<class>`)".
- **Watch and staleness are not gates.** `serve --watch` now re-checks after any edit under
  `srcRoot` (not only code files), using the traced selection, and prints what it could not
  trace. Staleness also uses the traced selection, so it reports no more `stale` entries than
  before.
- A module under `srcRoot` that no story reaches (a test, a script, a docs-only `.mdx`) still
  selects nothing; `.mts`, `.cts`, `.cjs` and `.mdx` files are now read as modules.
- **`check --full --update` exits 3 when refused** (piped, in CI or under an agent), as every
  other command that needs a person does; it exited 2. A wrong confirmation phrase exits 1
  ("not confirmed: nothing was written"), as in `approve apply` and `approve undo`; it exited 2.
- **An installed pxsig no longer falls back to the project's `target/release/pxsig`.** Without its
  platform package it now says that package (`@pxsig/cli-<platform>-<arch>`) is missing. Only a
  clone of pxsig itself uses its own `target/release/` build; `PXSIG_BIN` still overrides both.
- **On Windows, `pxsig serve` no longer opens a browser.** It printed the dashboard link and also
  ran `start` through `cmd.exe`; it now only prints the link (VS Code's terminal and Windows
  Terminal make it clickable). macOS keeps reusing an open Chrome tab, else `open`; Linux keeps
  `xdg-open`.
- **`pxsig approve verify` is strict by default.** A baseline with no line in `approvals.ndjson`
  now fails (exit 1), where it was listed and passed. The failure names the entries and prints the
  exact `pxsig approve verify --adopt` command, which a person runs once for baselines from before
  the log existed. `--no-strict` keeps the old result. `pxsig doctor` warns first
  (`verify-unlogged`); see docs/migrating.md. An entry with no baseline yet is no longer counted
  as one "without a log entry".
- **`pxsig check` stops on a conflicted store.** A merge or rebase that left baselines or store
  files conflicted makes `check` exit 2 with the files and the steps, and `doctor` reports
  `store-conflict` (an error). docs/ci.md gains "Rebasing with baselines".
- **`summary.md` gains one line when a `check --since` range changed baselines**: "Baselines
  changed in this PR: N (… approved in the dashboard, … in the terminal, … via MCP)", naming any
  assistant marker on those lines, never a person.

### Added

- **`pxsig a11y --prune`**: accepted axe rules that no longer fire, taken off `a11y.json`. Each
  accepted rule is listed as `prunable` (a row checked after the entry's last accessibility
  decision and last approval, not stale, where axe ran and the rule did not fire), `still-fires`,
  `stale` or `not-covered`, with the command that would decide the rest. `--dry-run` writes
  nothing, is anyone's (assistants included) and exits 0. Without it, a person at a terminal types
  `PRUNE <n> RULES`; only the prunable rules are removed, each entry's removal is a line in
  `a11y-decisions.ndjson` (`action: "prune"`, `via: "cli"`, the batch, the reason and the row it
  relied on), and a decision made in between refuses the whole prune (exit 1). Through `pxsig
  serve` when it holds the store (new route `POST /__pxsig/a11y-prune`, the CLI's token only), so
  the dashboard updates; otherwise under the store lock. Refused (exit 3) when piped, in CI or
  under an assistant's marker. Filters: `--component`, `--mode`, `--only`; `--reason`.
- **`pxsig_a11y { prune_plan: true }`** (MCP): the same list, read-only. No tool removes rules.

No behaviour change: a new flag, a new server route and a new log action. After a prune the
Accessibility view's accepted counts are lower.
- **`pxsig setup`**: the coding assistant's recipe. It prints the MCP entry, which starts the
  server with the local install (`node node_modules/pxsig/bin/pxsig.mjs mcp`, no `npx`), the policy
  that can turn MCP off on a managed machine, and the instruction for the assistant not to
  approve. A person at a terminal is asked which assistant is used and may create the
  repository's MCP file and instruction file, each on a typed yes and only when it does not exist;
  an existing file is never edited. `--assistant <name>` and `--print` (writes nothing; always so
  in CI, piped and under an assistant).
- **`pxsig doctor` shows the assistant marker** this shell carries ("Running under"), and its JSON
  has `agent`.
- **`pxsig_status` has `approvals.level`**, and the MCP server's instructions tell the model
  never to approve or accept and to ask the person to review in the dashboard.
- **`pxsig help agents`**.
- **The UI contract has a version.** `CONTRACT_VERSION` (1.0.0) in the dashboard's contract,
  separate from pxsig's; `docs/ui/contract-changes.md` lists each version. A UI adapter records the
  one it was written for in its `conformance.json` (`"contract": "1.0.0"`; without it, 1.0.0).
  `pxsig dashboard gaps` shows it against this pxsig's, and the build stamps both.
- **New tokens and icons can carry a default** (`TOKEN_DEFAULTS`, `ICON_DEFAULTS`), so adding one
  no longer breaks every adapter: an adapter that does not map it gets the default.
- **The contract is locked.** `src/ui/contract-lock.json` records it; `pnpm ui:check` fails when the
  contract changes without a version bump of the right size (major for a removed component or prop,
  a new required component, or a token or icon without a default) and a `contract-changes.md`
  section. `node scripts/ui.mjs lock` records a change.
- **`log-torn`** (setup problem, `warn`): approval-log lines a crash cut short. `pxsig doctor
  --repair --only log-torn --apply` removes them after a typed `REMOVE <n> TORN LINES`, at a
  terminal only (exit 3 otherwise), never beside the server; complete lines keep their bytes.
- **Fencing.** Before each batch of store writes (the server's, `check --update`, `approve undo`,
  `verify --adopt`, `doctor --repair --apply`, `migrate --apply`) the writer checks the lock is
  still its own, and stops with "lock taken over by …: nothing more was written" if not.
- **The lock's heartbeat age** in every message that names the holder.
- **Every new log line names the pxsig that wrote it** (`pxsig: "<version>"`). `approve verify`
  marks drifted baselines last logged by an older pxsig (a teammate who has not upgraded).
- **`requires` in `pxsig.workspace.json`**: a version range; a pxsig outside it refuses to run there,
  and `doctor` warns about installs outside it (`version-required`). pxsig 0.3.x does not read it.
- **`approvals.level`**: `standard` (the default); `strict` is reserved and refused for now.
- **Dashboard pages carry a Content-Security-Policy** (scripts and data from the server only) and
  every response `X-Content-Type-Options: nosniff`.
- **CI runs the published pxsig 0.3.2 against a store this version wrote** (`scripts/compat-old.mjs`):
  it reads the new lines and the store, and ignores `requires`.
- **One help source** in the package, `src/help/` (commands, every config key, topics), read by
  `pxsig help`, `--help` and the MCP's new read-only `pxsig_help` tool. A test keeps it in step
  with the code, `docs/cli.md`, `docs/configuration.md` and the dashboard's Help page.
- **One folder per machine for pxsig's own files** (`docs/platforms.md`): macOS
  `~/Library/Application Support/pxsig/`, Linux `$XDG_CONFIG_HOME/pxsig/`, Windows
  `%LOCALAPPDATA%\pxsig\` (never the roaming profile). It holds `settings.json` for `pxsig setup`
  (a later release) and, on Windows, the token files. `pxsig doctor` prints the settings path
  (marked "not set up" until then) and the token folder.
- **Tested on macOS, Linux and Windows.** CI runs the Rust tests, the package tests and the
  examples on all three on every pull request; each release build checks that its binary starts.
- **`doctor` warns about cross-platform store problems.** `line-endings`: a store record checked
  out with CRLF, or `.psig` files git would convert. `path-portability`: a baseline path Windows
  cannot hold (reserved names like `CON`, a trailing dot or space, `<>:"|?*`, over 240 characters)
  or two paths that differ only in case. Both are warnings: `doctor`'s exit code is unchanged.
- **Releases carry checksums, provenance and SBOMs.** From 0.4.0 each GitHub release has
  `SHA256SUMS`, a provenance attestation for every file (the npm tarballs, the raw binaries and the
  dashboard), and CycloneDX SBOMs for the npm package and the Rust engine. npm publishes the exact
  tarballs that were checksummed. Verifying: `docs/releasing.md#verifying-a-release`. No change to
  what pxsig does.
- `affects.aliases` (specifier prefix → path) for aliases only a bundler knows, and
  `affects.unresolved` (globs) to accept a file's unresolved imports.
- `affected --json` gains `unresolved` and `remote`; `pxsig_affected` returns the unresolved
  imports that add entries.
- **A nightly scale benchmark.** `scripts/bench/run.mjs` generates a store the size of a large
  design system (2,742 baselines, 537 stories) and times `affected --since`, `list`, `doctor`,
  `approve plan` and the dashboard's data against fixed budgets and the last release's times
  (docs/benchmark.md). For maintainers: nothing in pxsig's behaviour changes.
- `affects.ignore` (default `[]`): globs for changed paths that select nothing when nothing
  traced claims them. Anchored like `affects.extra`, plus `$repo/` for paths outside the
  workspace; `*`, `**`, `?`, `{a,b}`. It never hides a baseline, a store file, an "affects every
  entry" path or a module a story imports.
- The run manifest carries `store` (the store's record files) and `affectsIgnore`; an older
  engine ignores both.
- **`check --full --update --kind <word> --reason <text>`** writes the kind and reason on every
  log line. `--kind environment` re-takes baselines for a new render environment and leaves
  `a11y.json` as it is. The server accepts kinds up to 16 characters (it cut them at 10).
- **The programs pxsig starts are listed, and nothing else is started.** `docs/platforms.md`
  lists each program, when and why: `node`, the engine, `git`, `ps` (macOS, Linux), `osascript`
  and `open` (macOS), `xdg-open` (Linux), and Playwright's browser. One module starts them and
  refuses anything else, including any shell; a test fails if code elsewhere starts a process.
- **`pxsig serve --debug`** (or `PXSIG_DEBUG=spawn`) prints every program pxsig starts, with its
  arguments. A start blocked by a policy (AppLocker, WDAC) names the program and points to the
  list.
- **A component catalog for mapping another design system onto the dashboard.**
  `docs/ui/catalog/hydrotik.catalog.json`, exported as `pxsig/ui/catalog/hydrotik.json`, describes
  every component family of the reference adapter's design system:
  - what it is and when to use it;
  - which ones the dashboard uses (`usedBy`, `pxsigParts`);
  - the equivalent component in eleven other design systems, with a doc link and how closely it
    matches;
  - the names that mean different components in different systems (`collisions`).

  The `systems` section marks Polaris as archived. The schema, the commit the copy came from and
  a README with the mapping steps sit beside it. `pxsig help catalog` summarises it.
  `scripts/sync-catalog.mjs --from <hydrotik checkout>` refreshes the copy, and a test fails when
  the reference adapter's imports and the catalog's `pxsigParts` disagree. No behaviour change.
- `pxsig approve verify --since <ref>`: fails when the approval log was rewritten rather than
  appended to since the merge base, or when there is no merge base. `--suite <name>` and
  `--all-suites` verify suite manifests; a suite whose manifest is not committed is listed, not
  failed. `--adopt` takes `--suite` / `--all-suites` too.
- `pxsig approve log --trace`: the commit that added each batch's lines and the pull request that
  merged it, from git. It prints no names or emails.
- Docs: the required-check recipe runs `approve verify --all-suites --since`, checks everything on
  every push to main and nightly, and keeps one `pxsig-drift` issue for failures there;
  `local-ci.md` has a cron and a launchd example; "Publishing the report", "Repository size", and
  a roles table in `codeowners.md`. SECURITY.md lists every MCP tool and what it can change.

### Changed

- **A person's decision is not marked with the server's assistant.** A `pxsig serve` started under
  an assistant marker no longer writes `agent` on decisions made through the dashboard link
  (`via: dashboard`, and the undo an un-approve writes) or sent by the CLI (`via: cli`).
  Decisions an assistant sends over MCP still carry it.
- **On Windows, the server's token files live in the user's profile.** `serve-<port>.token` and
  `serve-<port>.mcp.token` move from the workspace's `node_modules/.cache/pxsig/` to
  `%LOCALAPPDATA%\pxsig\tokens\<workspace>\`, which only the user (and SYSTEM and administrators)
  can read; a file mode set there protected nothing. pxsig changes no permission and runs no tool
  for it. macOS and Linux keep the files where they were, with mode 0600.
- **New stores keep their records LF.** `pxsig init` writes `*.json text eol=lf` and
  `*.ndjson text eol=lf` into a new store's `.gitattributes`, beside `*.psig binary`. Existing
  stores are not changed; `doctor` names the lines to add.

### Fixed

- **Records are written whole.** Every JSON record pxsig writes (reports, review, a11y baseline,
  manifests, plans, `server.json`, settings, the lock) goes to a temporary file, is flushed, then
  renamed over the old one, retried while Windows holds the file; a failed write (a full disk)
  leaves the old file. Log lines are appended in one write, and a torn tail is closed off first so
  it never swallows the next line. Baselines restored by `approve undo` are written the same way.
- **Windows paths.** `pxsig affected --json` and the diff artifacts print `/` paths on Windows
  (they printed `\`). Absolute `--changed` paths are made repository-relative (they selected
  nothing), comparing a Windows path without regard to case.
- **`pxsig serve` stops on Ctrl+Break** in a Windows console as it does on Ctrl+C, releasing the
  store lock.
- **The dashboard opens a report whose summary is incomplete.** A `check.json` with an empty or
  partial `summary` (written by hand, by an older run, or cut short) stopped the page with
  "Cannot read properties of undefined (reading 'join')". The dashboard now reads a missing count
  as 0, missing modes as none, and a missing timing as a dash, in every section.

### Security

- **The server's decision routes need a person.** `pxsig approve apply` refuses to run when output
  is piped, in CI or under an agent, but `POST /__pxsig/approve` (and `approve-story`, `reject`,
  `unreview` and the `a11y-*` decisions) accepted any local request, so an agent could approve
  baselines with `curl`. These routes now need one of the random tokens the server makes when
  it starts, sent as `x-pxsig-token`: one in the dashboard page when a browser loads it, one in
  `node_modules/.cache/pxsig/serve-<port>.token` (mode 0600) for `pxsig approve apply`. Without one
  the answer is 403, "approving needs a person: use the dashboard or `pxsig
  approve` in a terminal". A dashboard tab opened before the upgrade needs a reload once `pxsig
  serve` is restarted, and `pxsig approve apply` against an older server asks for a restart.
  This is a guard, not authentication: a process running as you can still read the token file.
- **The MCP can no longer approve.** `pxsig_review` loses `approve`, `a11y-accept` and
  `a11y-unaccept`; it keeps `reject`, `a11y-reject` and `unreview` / `a11y-unreview` of a
  rejection. It sends the server's MCP token (`serve-<port>.mcp.token`, 0600), which the server
  accepts on those four routes only, logged as `via: "mcp"`; its unreview of a person's approval or
  accept is refused.
- **`via` in the approval log is the server's.** It was taken from the request body, so any caller
  could log `via: "dashboard"`. It is now the token the decision carried (`dashboard`, `cli` or `mcp`), and
  rejections record it too.
- **Cross-site requests and foreign hosts are refused.** A write whose `Sec-Fetch-Site` is not
  `same-origin` is refused like a foreign `Origin` (a project's Storybook may still ask for checks
  and repairs, never decisions), every request whose `Host` is not loopback is refused (DNS
  rebinding), and the dashboard page may be framed only by the server and the projects'
  Storybooks.

### Documentation

- **Recipes for teams and CI.** [docs/codeowners.md](docs/codeowners.md) maps baseline folders to
  `CODEOWNERS` so a baseline change needs its team's review, with an example in
  `examples/monorepo`; [docs/required-checks.md](docs/required-checks.md) makes the check a
  required status, with branch protection and a `merge_group` workflow that always runs and
  selects inside the job; [docs/local-ci.md](docs/local-ci.md) runs the same steps on a machine
  and posts commit statuses. `docs/ci.md` now gives `pxsig report`'s failure exit as 2.
- **docs/agents.md**: the markers, what they change, the approval level, the instruction for the
  assistant, and the MCP recipe for each assistant. **docs/mcp.md** registers the server with the
  local `node` command (`npx pxsig mcp` keeps working). SECURITY.md: a marker is a hint, not
  proof; the reviewed pull request is the guarantee.
- **Changelog fragments.** A pull request adds a file to `changelog.d/` instead of editing
  `CHANGELOG.md`, so open pull requests no longer collide on one file; a release merges them
  (`node scripts/changelog.mjs release <version>`). See `changelog.d/README.md`.
- `docs/cli.md` gains `pxsig help`, a `pxsig doctor` flag table, and `check --full`'s
  `--no-server` and `--timeout-s`.

## 0.3.2 - 2026-10-24

A new story takes one check (or one safe repair) to render and one click to approve every mode and
state, and check and repair errors reach the dashboard. The Overview is in two columns with a
heatmap of stale entries, section headers are in title case, and the README has product shots.

### Added

- **Checking a story that is not registered registers it.** `pxsig check <id>`, `pxsig check
  --full --only`, the MCP's `pxsig_check` and `POST /__pxsig/check` used to select from the manifest
  only, so a story just written was dropped (the MCP said `checked: 0` with no note). A name the
  manifest lacks is now registered first when Storybook is healthy, then rendered in the same run;
  the entries arrive NEW, with no signature, and the registration is logged in `repairs.ndjson`.
  A name that cannot be registered comes back in `skipped` with the reason.
- **Approve a story's entries together.** The inspector's **Approve story · N entries** approves
  every mode and state of a story that waits for a decision in one batch (`POST
  /__pxsig/approve-story`). It is a person's click in the dashboard; entries that pass, did not
  render or were rejected are left out with the reason, and each approval is logged and undone like
  a single one. The MCP has no such tool.
- **Re-check from the dashboard.** A **Re-check** button in the inspector, and on cards with
  nothing to inspect (a render error, a NEW entry not rendered yet), queues the entry on the server.
- `pxsig doctor --repair --stale`, `stale` on `pxsig_doctor` and `POST /__pxsig/repair`: re-check
  stale verdicts too (see Fixed).
- The dashboard opens in a theme a link names (`?theme=dark|light`), over the remembered one.
- **Stale entries by component.** A heatmap on Coverage and on the Overview: one tile per component
  with stale verdicts, coloured by its share of stale entries in five steps, with the count on the
  tile ("3 stale of 10"), highest share first. A tile opens Coverage filtered to that component.
  The UI contract gains an optional `Heatmap` (fallback: plain tiles with a swatch).

### Changed

- **Overview in two columns.** The counts stay across the top; below, open items and stale entries
  by component on the left, and on the right an errors card (render errors and coverage errors,
  each opening where it is fixed, with the safe repair; shown only while there are errors) above
  changed entries per run. One column on a narrow page. On the Overview the coverage banner leaves
  its errors to that card.
- Line charts mark their points solid in the series colour, smaller and with no outline.

### Fixed

- **One repair run for a new story.** "Run safe repairs" registered a new story's entries but
  planned the re-check before registering, so nothing rendered until a second click. The entries
  register adds are now rendered by the same run.
- Repairs: a story whose parameters cannot be read no longer aborts the register step (and every
  later step); it is reported and left out. An existing signature adopted at a new entry's path is
  logged.
- Repairs re-check only what needs it: entries with no usable verdict or render, and those a later
  step gates on. Stale verdicts (a warning) are listed for a person instead of re-checked: four
  render errors used to start a re-check of a thousand stale entries. Orphaned entries are never
  re-rendered.
- The repair's re-check reports what was recorded (`N of M entries re-checked`), and a check that
  could not run as `not re-checked: <why>`, logged as failed; it used to report "N re-checked"
  either way.
- A story checked alone whose render hit Storybook's error page (1 of 1) was taken for a broken
  Storybook and never recorded. Storybook now counts as broken only when three or more renders, and
  at least half, hit its error page; fewer are render errors like any other (server and `pxsig
  check`).
- Check errors reach the dashboard. A failed server check (Storybook down, a broken index) was
  broadcast as an event nothing listened to; the dashboard now shows a running check, and a failed
  one with its error until dismissed.
- Coverage banner: entries that wait for their first approval keep it open, counted on their own,
  with the review queue that approves them. They are warnings, so the banner used to close once the
  errors were repaired. The banner also names the command that moves orphaned baselines aside, and
  the Coverage tab has a "No baseline" count.
- Counts agree. Overview's "Changed" card counted every row not passing (new entries, render
  errors, approved ones); it now counts changes waiting for a decision. "Coverage errors" counted
  entries while the tab badge counted components; it now counts components. An approval marks its
  row in `check.json` (`approved`), so `summary.failed` leaves it out; `summary.changed` and
  `summary.approved` are new.
- `pxsig_doctor` with `repair: 'apply'` wrote the store without its lock. It now goes through the
  server that holds the store, or takes the lock, and refuses while another process holds it.
- A server re-check moves `check.json`'s `generatedAt` (the dashboard's "Last check"); `fullCheckAt`
  keeps when every entry was last checked together, which integrity's "last full check" now reads.
- A second server, started beside one that holds the store, wrote the integrity ledger and its run
  manifest into the store and replaced `server.json`, so clients looked for it instead of the
  running server. It now writes nothing into a store it does not hold and leaves a live server's
  `server.json` alone. `GET /__pxsig/integrity` waits for a reconcile already running instead of
  answering 503.
- `pxsig serve` passes SIGTERM and SIGHUP on to the server it starts; stopping the wrapper used to
  leave the server running with its port, locks and `server.json`.
- Storybook addon: the panel's buttons, "Open dashboard" among them, take their colours from
  Storybook's theme, and the inspector and the dashboard open in Storybook's light or dark mode.
- The placeholder reason of a NEW entry not rendered yet ("run Check, then approve") was hard-coded;
  it is in the copy file.

## 0.3.1 - 2026-10-23

Dashboard fixes: the inspector's Approve button stays in one place from entry to entry, the coverage
banner closes after a repair, icons match the design system's size, and the Overview's Duration
no longer reads NaN after a server check.

### Fixed

- Inspector: the header bar keeps one height and its actions one place from entry to entry. Approve
  moves on to the next entry, and the bar used to reflow with that entry's id, reasons, status badge,
  mode toggle and counter, so the button moved out from under the pointer. The id and reasons now sit
  on one line each (cut with an ellipsis, in full on hover), the badge and mode toggle sit beside the
  title, the counter has a fixed width, and Undo keeps its slot while hidden. On an entry with nothing
  to decide, Reject and Approve stay in place, disabled.
- Dashboard (hydrotik adapter): icons default to the design system's 14px instead of lucide's 24px.
  The theme toggle's sun and moon nearly filled their 28px button and read as different weights;
  they now match the other control icons. Icons sized by CSS (card affordances, Help) are
  unchanged.
- The Overview's Duration card read `NaN` after a check run from the server (`pxsig serve`: the
  dashboard's or the Storybook panel's Check all). The server's check wrote the counts but no
  timings, so a store whose last report came from the server had no `totalMs`. A full re-check now
  records `totalMs`, `renderWallMs`, `concurrency`, `pageLoads` and `rustEngineMs`; a partial one
  keeps the last full run's. A report without timings shows a dash.
- Coverage banner: closes on its own once a safe repair leaves nothing to repair. The repair's
  result message held it open until the page was reloaded, although the server had already pushed
  the clean ledger. The message now goes whenever the ledger turns clean or turns bad again.

## 0.3.0 - 2026-10-22

The dashboard can be built on any design system: a UI contract, a build-time adapter switch,
unstyled diff-viewer primitives, and the instructions an agent needs to write an adapter, shipped in
the package. The dashboard moves onto the design system's Navbar and passes axe.

### Added

- **The dashboard on any design system.** The dashboard renders through a UI contract of 42
  neutral components (`packages/dashboard/src/ui/contract.ts`); a UI adapter, chosen once at build
  time, implements them. The reference adapter renders exactly what the dashboard rendered before.
  `pxsig dashboard build` rebuilds the dashboard on a project's own adapter (`dashboard.ui` in
  `pxsig.config.json`), `pxsig dashboard gaps` reports what the adapter covers, and
  `PXSIG_DASHBOARD_DIR` serves the result. Optional components an adapter leaves out render plain
  fallbacks. The dashboard's source, its docs (`docs/ui/`) and two subpath exports ship in the
  `pxsig` package: `pxsig/dashboard` (the contract's types) and `pxsig/diff-viewer`.
- **Diff-viewer primitives.** The inspector's image stage is built on unstyled, accessible compound
  parts (`pxsig/diff-viewer`): state as `data-*` attributes, geometry as CSS custom properties,
  `className` and `render` props, controlled or uncontrolled.
- **Adapter documentation that CI keeps current.** `docs/ui/build-adapter.md` takes an adapter author
  (or an agent) through every contract component; `docs/ui/features.md` is generated from the
  feature registry. `pnpm ui:check` fails CI on a design-system import outside the adapters, or on
  a feature or component without its documentation.
- `examples/custom-ui`: a deliberately plain adapter, built end to end by `scripts/examples-test.mjs`.

- **`pxsig serve` finds a rebuilt dashboard.** When a project sets `dashboard.ui`, serve uses its
  `pxsig dashboard build` output (`node_modules/.cache/pxsig/dashboard`) while that is newer than
  the adapter's files and from the same pxsig version; otherwise it serves the prebuilt dashboard and
  prints the one command that rebuilds it. It never builds by itself. `PXSIG_DASHBOARD_DIR` still
  wins; without `dashboard.ui` nothing changes.
- **`pnpm typecheck`** (in CI): `tsc --noEmit` over the dashboard, the diff viewer, its test harness
  and the plain example adapter; with `PXSIG_DS_SOURCE`, the reference adapter too.

### Changed

- **Working in a clone needs Node.js 22.18 or later** (the repository's `engines`):
  `pnpm ui:check` and `pnpm ui:docs` read TypeScript with Node's type stripping and stop with a
  clear line on older versions. The published `pxsig` package still runs on Node 20.
- `pxsig dashboard build` writes to the project's `node_modules/.cache/pxsig/dashboard` by default
  (where serve looks) and stamps the folder with `pxsig-build.json`.
- **The dashboard has one top bar.** The design system's `Navbar` replaces the header and the
  section tabs: the report's name, the sections as links (`#overview`, `#stories`, …, the same
  hashes as before, and Back and Forward now move between them), and the review button, project
  picker, connection, last check, theme and review status at the end. Sections that do not fit a
  narrow window move into the bar's More menu.
- **Section counts are badges.** Review Stories, Coverage and Accessibility show how many entries
  need a decision as an accent count after the label, and Runs shows its total in a neutral one.
  Each count is part of the link's accessible name ("Review Stories, 6 to review"), and nothing
  shows at zero. The start-review button keeps its count in its wording.
- **Toolbars line up.** Each toolbar sets one control size, so the Stories search and its selects
  share a height and their labels a line, and "1,024 of 1,024" sits on the controls' line as a
  summary that is announced as the filters change. The inspector's toolbar and the Coverage,
  Diagnostics and scenario rows follow the same rule.
- **Open in Storybook from the inspector.** A Storybook button beside the Pixel heading opens the
  entry's story in Storybook with the entry's globals (theme, colorway, preset), so an `@light`
  entry opens in the light theme. An interaction state, which only a check can set, is noted under
  the entry's id. Check
  rows now carry the entry's `globals`.

### Fixed

- **The hydrotik adapter drops two workarounds** now that the design system fixes them at the
  source: the Columns button is named by its text, and an inline count is separated from its label
  by a word break. The reference dashboard renders identically.
- **The dashboard passes axe** in every section and the open inspector, in both themes: section
  headings in order, accessible names that contain the visible text (story cards, copy-path buttons,
  counted section links), and labelled toolbar selects.

- **Removed stories no longer linger.** `pxsig serve` drops `check.json` rows whose entry is no
  longer in the manifest, on start, whenever the manifest is reloaded and after every check, so a
  story deleted on another branch stops showing as a stale new or failing entry.

## 0.2.5 - 2026-10-20

A fix for the render-error guard found by testing it against a real broken Storybook, and section
tabs that stay in reach.

### Fixed

- **Another page's Vite overlay no longer fails a story that rendered.** Vite sends a transform
  error to every page on the dev server, so while one story file failed to load, healthy stories
  rendering on other pages carried the same overlay and the whole run was refused as a setup
  error. The overlay now counts only when the story did not render; otherwise it is removed from
  the page, and any that arrives later is hidden from screenshots.

### Changed

- **The dashboard's section tabs stay pinned under the header** instead of scrolling away with
  the page.

## 0.2.4 - 2026-10-20

Render errors can no longer become baselines, and the inspector's Pixel panel holds still.

### Fixed

- **A Vite error overlay is a render error, not a design change.** When a module failed to load
  (a story file removed under a running Storybook, for example), every story showed Vite's
  import-error overlay. pxsig captured it as the story, reported each entry as changed, and let it
  be approved. The render check now recognises the overlay, with its message, and a preview that
  never started, so a run where most renders hit them is refused and nothing is recorded.
- **Nothing approves a failed render.** A render error used to keep the previous image and its
  comparison, so it showed as changed with an Approve button. It now carries only the error, the
  dashboard turns Approve off for it (button and `A`), and the server refuses the approval.
- **No approvals mid-check.** The server refuses to approve an entry that is queued or being
  re-checked, because its render on disk is not yet trimmed or compared.
- **Identical renders across many entries are the environment.** The engine records each render's
  hash. When five or more failing entries, and at least a tenth of the run, rendered the same
  image, they become errors ("identical render to N other failing entries"), the check and the
  server say so, and the run summary lists the groups.
- **The Pixel panel keeps its height under the pointer.** Three-digit coordinates wrapped the first
  row, pushing every section below it down; the cell and tile text now truncates instead.

## 0.2.3 - 2026-10-20

Two fixes for reviewing new stories: the inspector shows a new entry's render, and a running
server checks entries added after it started.

### Fixed

- **New entries show their render in the inspector.** An entry with no baseline yet opened to an
  empty stage, because the inspector needed both the baseline and the latest render. It now shows
  the latest render alone, labelled "Latest render (no baseline yet)", so a first render can be
  seen before it is approved. The Pixel panel says there is no baseline to compare against instead
  of asking for the local server.
- **A running server checks entries added after it started.** `pxsig manifest` while `pxsig serve`
  was up added the new stories to the manifest, but the server matched check requests against the
  manifest it had loaded, so a check of the new entries ran nothing ("checked 0"). The server now
  rereads the manifest when a check is requested.

## 0.2.2 - 2026-10-19

A dashboard pass (plainer copy in one translatable file, review sessions, accessibility decisions,
a Help tab), a real undo for approvals, and the first release published without an npm token:
every package goes out through trusted publishing (OIDC).

### Changed

- **Dashboard layout and copy.** Under the latest-check cards, the Overview lists open items
  (changed, new, rejected, render errors, coverage errors, new a11y violations, flaky), each with a
  link. The Duration card shows the rendering time beside the total. Gate settings, status
  definitions, keyboard shortcuts and commands move to a new Help tab; Scenarios, Calibration and
  Performance merge into one Diagnostics tab (old links still work); Stories, Integrity and History
  are labelled Review, Coverage and Runs. Coverage badges show titles instead of raw codes. The
  wording throughout is plainer.
- **Dashboard copy is in one file**, `packages/dashboard/src/copy/en.json`, read through a typed
  `t()` helper with placeholders and plural forms, so the dashboard can be translated.
- **Review sessions in the dashboard.** "Review N changes" (header, Overview, Review tab) opens the
  inspector on the first undecided entry of a queue, largest change first; changed entries and new
  ones (a first baseline) are separate queues. A progress bar counts decisions, and a summary at the
  end lists what was approved and rejected with the next step for each. A rejected entry shows the
  command to re-check it. The Review grid groups cards by component and marks each card's status
  on its edge.
- **Accessibility decisions.** Entries whose only issue is new axe violations have their own review
  queue: Accept puts the violations on the entry's accepted list, Reject marks them for a fix, and
  Undo restores the previous list. The same controls are in the inspector's Accessibility panel.
  Accepts and undos are logged in `<store>/a11y-decisions.ndjson`; decisions are kept in
  `reports/a11y-review.json` until the entry's next check (`POST /__pxsig/a11y-accept`,
  `a11y-reject`, `a11y-unreview`). Approving a visual change still accepts the render's violations,
  and its button now says how many ("Approve · accepts 1 new a11y violation").
- **`pxsig_review` takes `a11y-accept`, `a11y-reject` and `a11y-unreview`** under the same
  explicit-confirm rule, and `pxsig_a11y` reports each entry's accessibility decision.
- **Clickable cards say what they do**: a small icon in the top-right corner. A down-left arrow
  filters the current view (the Coverage count cards filter the component table); an up-right
  arrow goes somewhere else: another tab, the inspector or a review session (explained on Help). The grouped Review grid
  sits each component's cards on an alternating band.
- **Accessibility state is spelled out.** The inspector's Accessibility panel opens with one line
  ("All on this entry's accepted list. Nothing to approve." or "1 new violation…" with Accept /
  Reject), and each violation is marked New or Accepted. The Accessibility tab says how to accept
  new violations, starts the review, and counts accepted entries per rule. "Accepted list" replaces
  "a11y baseline" in the dashboard.
- **Unaccept.** An accepted violation in the inspector has an Unaccept button that takes the rule
  off the entry's accepted list; the report shows it as new at once and it can be accepted again
  (`POST /__pxsig/a11y-unaccept {id, rule?}`, `pxsig_review` action `a11y-unaccept` with `rule`;
  logged). The Accessibility tab's rules table leads with a status (N new / Accepted) and greys out
  rules every entry has accepted.
- **No layout shift in the pixel readout.** It keeps the same rows with or without a pointer over
  the image, so the panels below it no longer move.
- **Files: "Copy path"** replaces the icon-only copy control, which read like a second "open" link.
- **Help** explains how the page is organised, and each section sits beside a drawing of the
  dashboard or the inspector: pointing at a row highlights where it appears. New sections cover the
  inspector and accessibility checks. The Review tab is "Review Stories".
- **Integrity headline wording**: "N components with errors: …", "No errors; N components with
  warnings", "No issues".
- **GitHub Actions run on Node 24.** The CI and release workflows, and the example in `docs/ci.md`,
  use `actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7`,
  `actions/download-artifact@v8`, `actions/cache@v6` and `pnpm/action-setup@v6`.

### Fixed

- **Undo in the dashboard now undoes.** Clearing an approval (`POST /__pxsig/unreview`, the
  inspector's Undo, `pxsig_review` with `unreview`) restores the baseline it replaced from that
  approval's snapshot (a first baseline moves to trash/) and its a11y baseline, and logs the undo.
  It used to clear only the mark and leave the new baseline in place. `undo()` takes `ids` to
  restore part of a batch.
- **No broken images for passing entries.** The engine writes signature images and the diff page
  only for entries that fail the gate; the inspector now says so instead of showing empty images and
  dead links.
- **Inspector shortcuts after a click.** A, R and the arrow keys worked only while focus stayed
  inside the inspector; after Undo or Approve removed the focused button they did nothing.
- **The Storybook addon registered its panel twice** when listed by name
  (`addons: ['@pxsig/storybook-addon']`): Storybook loads both a package's `./manager` export and its
  preset, and the preset already adds the manager. The `./manager` export is gone.
- **Release re-runs.** `Publish pxsig` skips a version that is already published, like the other
  packages, so a re-run after a partial release (or a dry run of a released version) passes.

## 0.2.1 - 2026-10-19

### Fixed

- **`@pxsig/storybook-addon` is published.** Its `package.json` had no `repository`, so npm refused
  the 0.2.0 upload (provenance must match the repository). This is the addon's first release.

## 0.2.0 - 2026-10-19

The first public release.

### Added

- **Workspaces and projects.** `pxsig.workspace.json` lists the packages under test in a monorepo;
  a single package needs only `pxsig.config.json`. Every surface finds the workspace by walking up
  (never past `.git`) and picks a project by name, folder or current directory.
- **Per-project stores.** Each project keeps its manifest, baselines, approvals and a11y baseline in
  `<package>/.pxsig/`, with run output git-ignored by the store's own `.gitignore`. Optional
  `colocated` layout puts baselines in `__pxsig__/` beside the stories.
- **The `.psig` baseline.** One file per entry holds the spec v1 record, the raw signature bytes
  and the baseline image, each section with a sha256. `pxsig cat` shows its header, and works as
  git's textconv for `*.psig`.
- **Layered configuration** with JSON Schemas: story parameters, CLI flags, environment, project
  config, workspace defaults, built-in defaults. `$workspace/` paths. `pxsig config` prints the
  result.
- **New commands:** `pxsig init`, `projects`, `config`, `manifest`, `migrate`, `cat`.
- **Manifest v2:** entries only (story x mode x interaction state); settings come from config.
  Suites for extra mode sets (`manifest.<suite>.json`).
- **Modes** with `extends`, per-mode browser (`chromium`, `firefox`, `webkit`) and viewport.
- **`affects`**: workspace dependencies' sources select every entry automatically.
- **`capture.waitFor`**: per-selector waits for content that animates in script.
- **One server for every project**, with routes under `/p/<project>/`, a project switcher in the
  dashboard, and `server.json` so the CLI, the MCP server and the Storybook addon find it.
- **MCP:** a `project` argument on every tool, and `pxsig_projects`.
- **Storybook addon** as `@pxsig/storybook-addon`, finding the server from Storybook's config folder.
- **Engine binary commands** `pack`, `cat` and `attach`.
- **Doctor setup codes** `project-unlisted`, `project-missing` and `version-skew`.
- **Migration** of a pre-0.2 store, with verification against the old baselines.

### Changed

- Integrity reads baseline images from the `.psig` files; `restore-baseline-image` adds an image to
  a `.psig` with `pxsig attach`, only when the latest render passes the gate, and never changes
  the signature.
- Playwright and axe-core are resolved through Node from the project and the workspace root.
- Configuration keys: `pixelsRoot` and `pixelsDir` became `store.dir` and `store.layout`;
  `affectsAll` became `affects`.

- **Store lock.** One writer per store: `<store>/reports/.lock` (pid, start time, host, command),
  taken by `check --full`, `approve undo` / `verify --adopt`, `migrate --apply`,
  `doctor --repair --apply`, and held by the server for every project it serves. A full check
  against a served project is queued on the server; a dead holder's lock is taken over.
- **`storybook.staticDir`** is implemented: with no Storybook at `storybook.url`, `check --full`,
  `manifest` and the server serve the build themselves on a free port. `--storybook-static` sets it
  for one run.
- **Config flags** (`--storybook-url`, `--storybook-static`, `--storybook-config`, `--grid`,
  `--min-cell-px`, `--settle-ms`) are the top config layer, and `pxsig config` shows the layer that
  set each key.
- **Several projects:** `--all` runs `status`, `list`, `stale`, `a11y`, `history` and `doctor`
  over every project, and they do so by default when no project is chosen; rows carry the project.
  `--workspace` works for every command.
- **`approve plan --new`** plans first baselines (with `--first-baselines` or `--allow-shape`).
- **`approve undo` across machines:** without the local snapshot, it restores from git, only when
  the file's bytes match the sha256 logged as `before`. First baselines are undone by moving them
  to `trash/`.
- **Integrity codes** `legacy-format` (a `.pxsig.json` baseline, with the repair `convert-legacy`
  to `.psig`) and `skipped-unaffected` (left out of a `--since` run with no earlier result).
- **Colocated `.gitattributes`:** `init` and `migrate` add `*.psig binary diff=psig` to the root
  `.gitattributes` for colocated baselines.
- **Release workflow** for tags `v*`: the binary for five platforms as `@pxsig/cli-<platform>-<arch>`
  optional dependencies, published with provenance (see docs/releasing.md).

### Fixed

- Gate precedence: the `PXSIG_*` gate variables and gate flags no longer override a story's
  `parameters.pxsig.gate`. The order is story > flags > environment > project config > defaults.
- Workspace `defaults` paths resolve against the workspace root, as documented.
- Mode `extends` chains resolve through any number of levels; cycles are reported.
- `doctor --fail-on info` no longer fails on `ok`, `excluded` or `drift`.
- `--markdown` is a switch (it took the next word as its value); `pxsig report` errors exit 2;
  every setup error exits 2 instead of printing a stack.
- `check --full` against a project in a multi-project workspace without `--project` refuses
  clearly; `approve` uses the chosen project for its lookups.

### Not yet

- Encryption of `.psig` files (the header field is reserved).
- Published npm packages (the release workflow exists; nothing has been published).
