# Changelog

All notable changes are listed here. The format follows Keep a Changelog, and versions follow
semantic versioning.

## Unreleased

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
