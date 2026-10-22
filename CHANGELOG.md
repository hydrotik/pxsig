# Changelog

All notable changes are listed here. The format follows Keep a Changelog, and versions follow
semantic versioning.

## Unreleased

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
