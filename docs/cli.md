# Command line

pxsig has two command-line tools with the same name:

- **`pxsig` (npm)**, the one you use: projects, manifests, renders, checks, review, integrity, the
  server and the MCP server. `npx pxsig <command>`.
- **`pxsig` (binary)**, the Rust engine the npm CLI drives. You rarely call it yourself. See
  [The engine binary](#the-engine-binary).

## Common options

| Option | Meaning |
| --- | --- |
| `--project <name or folder>` | The project. Optional inside a project's folder, or when the workspace has one project. `PXSIG_PROJECT` does the same. |
| `--all` | Read commands only: every project in the workspace. (`check --all` keeps its own meaning: every entry.) |
| `--workspace <dir>` | The workspace, for every command and for what it starts (the full check, the server, the report). `PXSIG_WORKSPACE` does the same. |
| `--json` | Print the command's data as one JSON document on stdout. Logs go to stderr. |
| `--plain` (or `--markdown`) | Markdown output. Both are switches: they never take the next word as a value. |
| `--pretty` | Terminal output: colour, aligned tables, links, a spinner, inline images in terminals that support them. |
| `--help` | The command list. |

Config flags, accepted by every command, form the top configuration layer (see
[configuration.md](configuration.md#layers)): `--storybook-url <url>`, `--storybook-static <dir>`,
`--storybook-config <dir>`, `--grid <n>`, `--min-cell-px <n>`, `--settle-ms <n>`. Paths are relative
to the current folder.

### Several projects

The read commands (`status`, `list`, `stale`, `a11y`, `history`, `doctor`) cover every project when
given `--all`, and also when the workspace has several projects and neither `--project` nor the
current folder picks one. Their tables then start with a Project column, `--json` prints
`{ "projects": [{ "project": …, …the single-project data }] }`, and the exit code is the worst one.
Every other command works on one project and exits 2 when none is chosen.

### Output formats

Without a flag, the format is `PXSIG_FORMAT` if set, else `pretty` on a terminal and `plain`
otherwise. A run in CI (`CI` set) or under a known agent environment (or `PXSIG_AGENT` set) gets
`plain`.

`plain` is written for logs and agents: GitHub-flavoured Markdown tables, no colour codes, no
redraws, absolute image paths, and a "Next" section with the exact commands to run. `NO_COLOR` and
`FORCE_COLOR=0` turn colour off in `pretty`.

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | OK |
| 1 | Problems found: changed entries (`check`), stale verdicts (`stale`), integrity issues (`doctor`), a migration that differs (`migrate`) |
| 2 | Usage or setup error: unknown command or project, no project chosen for a command that needs one, no manifest, Storybook unreachable or broken, missing binary, the store locked by another writer, a failed `report` |
| 3 | Needs a person at a terminal (below) |

### Commands that need a person

Writing baselines without reviewing each one, undoing approvals and pruning files are refused
unless stdin and stdout are both a terminal, `CI` is not set, and no agent environment is
detected. They then ask for a typed confirmation phrase. These are: `check --full --update`,
`approve apply`, `approve undo`, `approve verify --adopt`, and `doctor --repair --apply --prune`.

Per-entry approval stays in the dashboard and the Storybook panel, where a person sees the images.

## Setup

### `pxsig init [dir]`

Set a package up. Writes `pxsig.config.json` (unless one exists), the store with its
`.gitignore` and `.gitattributes`, and, when a `pxsig.workspace.json` exists above the folder,
the project's entry in it.

| Flag | Meaning |
| --- | --- |
| `--name <name>` | Project name (default: the folder name). |
| `--src <dir>` | `srcRoot` (default `src`). |
| `--storybook-url <url>` | `storybook.url`. |
| `--storybook-config <dir>` | `storybook.configDir`. `$workspace/` paths are kept as written. |
| `--layout <package\|colocated>` | `store.layout`. With `colocated` (here or in the workspace defaults), init also adds `*.psig binary diff=psig` to the root `.gitattributes` (the workspace's, else the package's) if no line there sets attributes for `*.psig`. |

### `pxsig projects`

The projects in the workspace: name, folder, entry count, integrity headline.

### `pxsig config`

The resolved configuration of a project: the files it came from, absolute paths, the store layout,
the binary in use, and every setting with the layer that set it: `defaults`, `workspace defaults`,
`project config`, `env` or `flags`. `--json` prints the same as one document, with the merged
`config` and a `sources` map (dotted key → layer). Config flags given to `config` show up as
`flags`, so `pxsig config --grid 32` shows what a run with `--grid 32` would use.

### `pxsig manifest [--suite name]`

Rebuild the project's manifest from the running Storybook (or, when `storybook.url` does not
answer, from the build in `storybook.staticDir`, served on a free port): every story under `srcRoot` times its
modes times its interaction states, with `parameters.pxsig` read from the stories. Existing entries
keep their baseline paths; new entries have none. Prints the counts of new, removed and skipped
entries. `--suite` writes `manifest.<suite>.json`.

### `pxsig migrate --from <dir> [--apply] [--no-verify]`

Move a pre-0.2 store into this project. A dry run without `--apply`; `--apply` takes the store
lock. See [migrating.md](migrating.md).

## Status and review

### `pxsig status`

The default command. Counts per state, accessibility totals, the components with the most changed
entries, whether the server is up, the integrity headline, and files edited since the report.

### `pxsig list [state]`

Entries in one state, with SSIM, the share of changed cells, and the first gate reason.

| Flag | Meaning |
| --- | --- |
| `state` | `problems` (default: changed, error, flaky, rejected), `changed`, `new`, `error`, `flaky`, `rejected`, `approved`, `drift`, `pass`, `skipped`, `a11y`, `all`. Also `--state`. |
| `--component <text>` | Entries whose id contains this text. |
| `--mode <name>` | One mode. |
| `--limit <n>` | Rows shown (default 30). |

### `pxsig entry <id>`

One entry: state, metrics, gate reasons, changed regions, accessibility, review decision, a link to
the dashboard, and the paths of its images. `--images baseline,current,diff` chooses the images.

### `pxsig stale [--limit 200]`

Verdicts that cannot be trusted as current: older than an edit to a file that can change the entry
(traced through the import graph), or made on a render of a different size than the one on disk.
Exit 1 when there are any.

### `pxsig history [--limit 10]`

The last runs: when, how many entries, how many changed, which.

### `pxsig a11y [--component text] [--new] [--limit 50]`

axe violations per entry, grouped by rule. `--new` shows only those not in the a11y baseline.

### `pxsig affected <files…> | --since <ref>`

Which entries a set of edited files can change. Files are relative to the current folder.
`--since <ref>` uses the files changed since the merge base with that ref, plus staged, unstaged
and untracked work.

## Checking

### `pxsig check` (quick)

```
pxsig check [ids…] [--changed a.tsx,b.ts] [--since <ref>] [--all]
```

Re-render and re-check some entries. Uses the running server (warm browsers) when there is one;
otherwise runs the full check for just those entries. Never writes baselines. Exit 1 when any
re-checked entry has a problem.

| Flag | Meaning |
| --- | --- |
| `ids…` | Entry ids. |
| `--changed <files>` | The entries these comma-separated files affect. |
| `--since <ref>` | The entries the changes since `<ref>` affect. |
| `--all` | Every entry. |

### `pxsig check --full`

The full check. `check` also takes this path when given `--update`, `--suite` or `--modes`.

```
pxsig check --full [--suite name] [--since <ref> | --changed a,b] [--modes a,b] [--only id,id]
                   [--concurrency 8] [--retries 2] [--no-a11y] [--link-base <url>] [--out <name>]
                   [--update]
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--suite <name>` | none | Check `manifest.<suite>.json`; reports get the suite's name. |
| `--since <ref>` | none | Only the entries affected by changes since `<ref>`. Others carry their previous result forward. |
| `--changed <files>` | none | Only the entries these files affect. |
| `--modes <a,b>` | all | Only these modes. |
| `--only <ids>` | all | Only these entry ids or story ids. |
| `--concurrency <n>` | 8 | Browser pages rendering in parallel. |
| `--retries <n>` | 2 | Re-render failures up to n times; a pass on retry is `flaky`. |
| `--no-a11y` | off | Skip axe. |
| `--link-base <url>` | none | Dashboard URL; the Markdown summary links each entry to `<url>#inspect=<id>`. |
| `--out <name>` | `check` | Report file name (`<store>/reports/<name>.json`). |
| `--update` | off | Write baselines from the renders instead of checking. A person at a terminal only, after typing `UPDATE <n> BASELINES`. Every replaced baseline is snapshotted and logged. |

Entries left out by `--since` / `--changed` keep their previous row. One with no previous row but
a baseline is recorded as unaffected (`skipped-unaffected` in the integrity ledger: ok, not yet
verified) instead of looking never-checked.

**One writer per store.** The full check takes the store lock (`<store>/reports/.lock`). When the
pxsig server holds it, because it serves this project, the selection is queued on the server
(`POST /__pxsig/check`), the check waits for the queue to drain and reports the server's rows;
`--update`, `--suite` and `--no-server` refuse instead. When another check holds it, the check
exits 2 and names it. A lock whose process is gone is stale and taken over.

**Storybook.** When `storybook.url` does not answer and `storybook.staticDir` holds a Storybook build
(`index.json` and `iframe.html`), the check serves that folder itself on a free 127.0.0.1 port. A
Storybook that answers with a broken index is a setup error, never replaced.

Steps: select entries, refuse to run against an unreachable or broken Storybook, render, trim,
check with the engine, retry failures, compare accessibility with its baseline, write reports,
update the integrity ledger. Writes `check.json`, `summary.md` and `junit.xml` in
`<store>/reports/`. Output is plain log lines; `--json` is not supported here (read
`check.json`).

Exit: 0 pass, 1 at least one entry changed, is new or failed to render, 2 setup error.

## Approvals

### `pxsig approve`

The guarded way to accept many changes at once. Every approval, from any surface, is logged in
`<store>/approvals.ndjson` with who, when, how, why, the batch, the git HEAD, and the sha256 of the
baseline before and after. The replaced baseline is kept in `<store>/history/<batch>/`.

| Subcommand | Meaning |
| --- | --- |
| `plan <ids…> --reason "…"` | Classify each changed entry as a `colour` change (content in place) or a `shape` change (moved, added, removed, resized). Shape changes are blocked unless named in `--allow-shape id,id`. Stale verdicts and entries not in state `changed` or `new` are blocked. Pins the sha256 of every render and baseline. Writes `<store>/reports/approval-plan.json`. Safe for anyone. |
| `plan --component <text>` / `plan --all-changed` | Select the changed entries by id text, or all of them. |
| `plan --new [--first-baselines]` | Select the NEW entries: no baseline yet, with a latest render. With nothing to compare, each is a shape change: blocked unless named in `--allow-shape`, or allowed all at once by `--first-baselines`. Combines with the selections above. |
| `apply [plan]` | A person at a terminal only. Needs the server, and no check running. Refuses the whole plan if any render changed since planning, or the plan is older than 24 hours. Asks for `APPROVE <n> ENTRIES`. |
| `log [--limit 10]` | Approvals by batch. |
| `undo <batch>` | Restore the baselines a batch replaced; move first baselines it created to `<store>/trash/`. A person at a terminal only; takes the store lock. Uses `<store>/history/<batch>/` when this machine has it, else git (below). Exits 1 when any entry was refused. |
| `verify [--adopt]` | Baselines whose bytes differ from their last logged approval, and baselines with no approval logged. `--adopt` (a person at a terminal) logs the current baselines as the starting point. |

`--reason` needs at least eight characters. `apply` sends each entry to the server, which writes
it (a NEW entry gets its first baseline, logged with `before: null`).

**Undo on another machine.** `<store>/history/` is not committed, so a teammate or CI does not have
it. Then `undo` reads each approval line's `gitHead` (the HEAD when it was approved) and `before`
(the sha256 of the replaced baseline), and restores the file from that commit, or else from the
newest commit in the file's history whose bytes hash to exactly `before`. A file no commit can
match is refused and left as it is.

## Integrity

### `pxsig doctor`

Integrity per component, and the safe repairs. See [integrity.md](integrity.md#pxsig-doctor).

## Server, MCP, reports

| Command | Meaning |
| --- | --- |
| `pxsig serve [--port 6070] [--watch] [--no-open] [--tab name] [--project a,b]` | The server and dashboard for the workspace. See [server.md](server.md). |
| `pxsig mcp` | The MCP server on stdio. See [mcp.md](mcp.md). |
| `pxsig report [--out dir]` | A static dashboard for one project, which opens from disk. Default `<store>/reports/site/`. Exits 2 on any error. |
| `pxsig dashboard build [--ui path] [--out dir]` | Rebuild the dashboard on this project's design system through a UI adapter (`--ui`, else `dashboard.ui`), with the project's own Vite (`vite`, `@vitejs/plugin-react`, `@vanilla-extract/vite-plugin`, `react`, `react-dom` installed). Default output `node_modules/.cache/pxsig/dashboard`; serve it with `PXSIG_DASHBOARD_DIR`. See [ui/build-adapter.md](ui/build-adapter.md). |
| `pxsig dashboard gaps [--ui path] [--json]` | What the adapter covers of the UI contract: missing, partial and bespoke components and the dashboard files each affects. Exit 1 when a required component is missing or its `conformance.json` is malformed. |
| `pxsig cat <file> [--image out.png]` | Print a baseline's header as JSON (git's textconv for `*.psig`). `--image` writes a `.psig`'s baseline image. |

## The engine binary

The `pxsig` binary from `crates/pxsig-cli`. The npm CLI finds it through `PXSIG_BIN`, the
platform package, or a source checkout's `target/release/`. It takes `-j, --threads <n>`
(`PXSIG_THREADS`) on every command. Exit: 0 pass, 1 visual regression, 2 usage, IO or validation
error.

| Command | Meaning |
| --- | --- |
| `capture <png> [--out file] [--grid 64] [--detail]` | Write a baseline from one render. `--out` ending in `.psig` writes a container with the render as its image; otherwise a spec v1 `.pxsig.json`. Default: `<png stem>.psig`. |
| `compare <png> <baseline> [--out-dir dir] [--json] [gate flags]` | Compare one render with one baseline. Writes `<stem>.diff.html` and `<stem>.diff.png`. |
| `check --manifest m --png-dir d [--root r] [--only ids\|@file] [--out-dir d] [--json\|--format human\|json\|junit\|markdown] [--artifacts all\|failed\|none] [--no-artifacts] [--cache dir] [--history file] [--base-png-dir d] [--tolerance 16] [gate flags]` | Batch check of every manifest entry's `<png-dir>/<id>.png`, in parallel. |
| `baseline --manifest m --png-dir d [--root r] [--only …] [--no-detail] [--json]` | Write a baseline for every entry. |
| `diff <a.png> <b.png> [--tolerance 16] [--mask out.png] [--json]` | Full-resolution pixel diff: changed pixels and change regions. |
| `affected --manifest m [--root r] [--since main] [--files a,b] [--json]` | Entries a change can affect, from the import graph under `srcRoot`. A change under an "affects every entry" path selects all. |
| `report --input check.json [--format markdown\|junit] [--link-base url] [--out file]` | Markdown summary or JUnit from a check result. |
| `trim <dir> [--only …] [--pad 16] [--tolerance 8] [--json]` | Crop renders to content (right and bottom), in place. |
| `pack <record> --out x.psig [--image png] [--entry json]`, `pack --plan plan.json [--json]` | Pack spec v1 records and images into `.psig` files, reading each back to prove it. |
| `cat <file> [--image out.png]` | Print a baseline's header. |
| `attach <psig> <png> [--json]` | Add an image to a `.psig` that has none. Refuses one that has an image; verifies the signature is unchanged. |
| `serve` | The engine as a long-lived process: one JSON request per line on stdin, one response per line on stdout. Methods: `ping`, `capture`, `compare`, `check`, `baseline`, `trim`, `diff`, `affected`. |
| `detail-sweep --input pairs.json` | Raw data for calibrating the detail channel. |

Gate flags: `--threshold`, `--min-ssim`, `--max-changed-pct`, `--max-edge-pct`, `--min-cells`,
`--no-detail`, with environment variables `PXSIG_THRESHOLD`, `PXSIG_MIN_SSIM`,
`PXSIG_MAX_CHANGED_PCT`, `PXSIG_MAX_EDGE_PCT`, `PXSIG_MIN_CELLS`. Each entry's gate is resolved
in this order, last wins: built-in defaults, the manifest's `gate` (the project config), the
environment, the flags, and the story's own `parameters.pxsig.gate`. A story gate is never
overridden by anything run-wide. `--root` falls back to
`PXSIG_ROOT`; `capture --grid` to `PXSIG_GRID`.
