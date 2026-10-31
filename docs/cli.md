# Command line

pxsig has two command-line tools with the same name:

- **`pxsig` (npm)**, the one you use: projects, manifests, renders, checks, review, integrity, the
  server and the MCP server. `npx pxsig <command>`.
- **`pxsig` (binary)**, the Rust engine the npm CLI drives. You rarely call it yourself. See
  [The engine binary](#the-engine-binary).

## Common options

| Option                       | Meaning                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `--project <name or folder>` | The project. Optional inside a project's folder, or when the workspace has one project. `PXSIG_PROJECT` does the same.             |
| `--all`                      | Read commands only: every project in the workspace. (`check --all` keeps its own meaning: every entry.)                            |
| `--workspace <dir>`          | The workspace, for every command and for what it starts (the full check, the server, the report). `PXSIG_WORKSPACE` does the same. |
| `--json`                     | Print the command's data as one JSON document on stdout. Logs go to stderr.                                                        |
| `--plain` (or `--markdown`)  | Markdown output. Both are switches: they never take the next word as a value.                                                      |
| `--pretty`                   | Terminal output: colour, aligned tables, links, a spinner, inline images in terminals that support them.                           |
| `--help`                     | With a command, that command's page (`pxsig check --help`, `pxsig approve apply --help`); alone, the command list.                 |
| `--version`                  | The versions of this CLI, the engine it would run and the UI contract (`pxsig version` is the same; `--json` as data).             |

Config flags, accepted by every command, form the top configuration layer (see
[configuration.md](configuration.md#layers)): `--storybook-url <url>`, `--storybook-static <dir>`,
`--storybook-config <dir>`, `--grid <n>`, `--min-cell-px <n>`, `--settle-ms <n>`, `--browser <ws://…>`
(render with that Playwright browser server instead of launching one here; [container.md](container.md)).
Paths are relative to the current folder. A flag no command takes, and a number flag (`<n>`) whose
value is not a whole number in its range, exit 2 before anything runs: `--retries`, `--settle-ms`
and `--min-cell-px` start at 0, every other one at 1, and a port is at most 65535.

### Several projects

The read commands (`status`, `list`, `stale`, `a11y`, `history`, `doctor`) cover every project when
given `--all`, and also when the workspace has several projects and neither `--project` nor the
current folder picks one. Their tables then start with a Project column, `--json` prints
`{ "projects": [{ "project": …, …the single-project data }] }`, and the exit code is the worst one.
Every other command works on one project and exits 2 when none is chosen.

### Output formats

Without a flag, the format is `PXSIG_FORMAT` if set, else `pretty` on a terminal and `plain`
otherwise. A run in CI (`CI` set) or under a coding assistant's marker gets `plain`, even in a
real terminal ([agents.md](agents.md#markers); `PXSIG_AGENT` marks any other shell).

`plain` is written for logs and agents: GitHub-flavoured Markdown tables, no colour codes, no
redraws, absolute image paths, and a "Next" section with the exact commands to run. `NO_COLOR` and
`FORCE_COLOR=0` turn colour off in `pretty`.

### Exit codes

| Code           | Meaning                                                                                                                                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0              | OK                                                                                                                                                                                                                                     |
| 1              | Problems found: changed entries (`check`), stale verdicts (`stale`), integrity issues (`doctor`), a migration that differs (`migrate`). Also a typed confirmation that did not match, or a plan a decision made stale: nothing written |
| 2              | Usage or setup error: unknown command, flag or project, no project chosen for a command that needs one, no manifest, Storybook unreachable or broken, missing binary, the store locked by another writer, a failed `report`            |
| 3              | Needs a person at a terminal (below)                                                                                                                                                                                                   |
| `advisoryExit` | Warn mode: only gates on `warn` would have failed. `0` by default, or 10 to 125 when the config sets `enforcement.advisoryExit` ([configuration.md](configuration.md#enforcement))                                                     |

### Warn mode

A gate the committed config sets to `warn` ([configuration.md](configuration.md#enforcement)) runs
the same checks and exits `advisoryExit` where only it would have failed. `check`, `approve
verify`, `doctor` and `stale` then print an ADVISORY first line (which gates, from where, until
when) and last line (what would have failed). Setup errors (2) and refusals (3) are never warned,
and a real failure in another project still wins over an advisory exit.

| Flag                | Who                    | Meaning                                                                                                                                                                                                |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--warn[=gates]`    | a person at a terminal | Warn mode for this run, for the named gates (comma-separated: `visual`, `a11y`, `verify`, `env`, `doctor`, `stale`; all without a value). Refused with exit 3 in CI, under an assistant or when piped. |
| `--enforce[=gates]` | anyone                 | Enforce the named gates (all without a value) whatever the config says. `PXSIG_ENFORCEMENT=enforce` does the same.                                                                                     |

The a11y gate (new axe violations) is on `warn` by default and says nothing unless a new
violation appears; then one ADVISORY line, exit 0.

### Commands that need a person

Writing baselines without reviewing each one, undoing approvals and pruning files are refused
unless stdin and stdout are both a terminal, `CI` is not set, and the environment carries no
coding assistant's marker ([agents.md](agents.md#markers)). They then ask for a typed confirmation
phrase. These are: `check --full --update`, `approve apply`, `approve undo`, `approve verify
--adopt`, `a11y --prune`, `doctor --repair --apply --prune`, `doctor --repair --only log-torn
--apply` and `serve --link`. A refusal exits 3 and says why: "refused under copilot
(AI_AGENT=github_copilot_vscode_agent)", "refused in CI (CI is set)" or "refused: output is piped".

Per-entry approval stays in the dashboard and the Storybook panel, where a person sees the images.

## Help

### `pxsig help [name]`

Alone (or `pxsig --help`), the index: every command and subcommand with its summary and usage,
the commands that need a person, and the topics. `pxsig help topics` lists the topics with their
titles. With a name, one page:

- **a command or subcommand** (`pxsig help check`, `pxsig help approve apply`): usage, flags with
  their defaults and the setting or variable each overrides, exit codes, what it changes (reads
  only, writes the store, writes baselines, needs a person), examples;
- **a topic**: `agents`, `approvals`, `catalog`, `exit-codes`, `platforms`, `troubleshooting`,
  `dashboard`, `ci`;
- **a setting** (`pxsig help gate.threshold`): its file, meaning, values, default, and what it
  changes day to day;
- `global`: the options every command takes.

An unknown name exits 2 and names the nearest ones. `--json` prints the entry as data; the MCP's
`pxsig_help` returns the same. The pages come from `src/help/` in the package; a test keeps them in
step with this page, [configuration.md](configuration.md) and the code.

## Setup

### `pxsig init [dir]`

Set a package up. Writes `pxsig.config.json` (unless one exists), the store with its
`.gitignore` and `.gitattributes`, and, when a `pxsig.workspace.json` exists above the folder,
the project's entry in it.

A new config also records what init finds in the folder, and says so: `.storybook/` as
`storybook.configDir`, and a `storybook-static/` build folder as `storybook.staticDir` (only when
the folder exists). A flag for the same key wins. Paths in the config are relative to the package
folder. With a `staticDir`, `manifest`, `check` and the server serve that build themselves when
nothing answers at `storybook.url`, so no Storybook needs to be running:

```sh
npx storybook build                        # writes storybook-static/
pxsig init --storybook-static storybook-static
pxsig manifest && pxsig check --full
```

| Flag                            | Meaning                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--name <name>`                 | Project name (default: the folder name).                                                                                                                                                                                                                                                                                                                       |
| `--label <text>`                | `label`: the project's label, the dashboard title after "pxsig •" when the workspace has none (1 to 60 characters; default: the project name). A person at a terminal setting up a new config who leaves it out is asked once (Enter keeps the name); CI, an assistant or piped output is never asked. An existing config is not edited: change `label` there. |
| `--src <dir>`                   | `srcRoot` (default `src`).                                                                                                                                                                                                                                                                                                                                     |
| `--storybook-url <url>`         | `storybook.url`.                                                                                                                                                                                                                                                                                                                                               |
| `--storybook-config <dir>`      | `storybook.configDir`. `$workspace/` paths are kept as written.                                                                                                                                                                                                                                                                                                |
| `--storybook-static <dir>`      | `storybook.staticDir`: a Storybook build (`index.json` + `iframe.html`), served on a free port when nothing answers at `storybook.url`.                                                                                                                                                                                                                        |
| `--layout <package\|colocated>` | `store.layout`. With `colocated` (here or in the workspace defaults), init also adds `*.psig binary diff=psig` to the root `.gitattributes` (the workspace's, else the package's) if no line there sets attributes for `*.psig`.                                                                                                                               |

### `pxsig projects`

The projects in the workspace: name, folder, entry count, integrity headline.

### `pxsig config`

The resolved configuration of a project: the files it came from, absolute paths, the store layout,
the binary in use, and every setting with the layer that set it: `defaults`, `workspace defaults`,
`project config`, `env` or `flags`. `--json` prints the same as one document, with the merged
`config` and a `sources` map (dotted key → layer). Config flags given to `config` show up as
`flags`, so `pxsig config --grid 32` shows what a run with `--grid 32` would use.

### `pxsig setup [assistant] [--assistant name] [--print]`

The coding assistant's recipe ([agents.md](agents.md#recipes)). A person at a terminal is asked
which assistant is used here (a numbered list); `pxsig setup vscode` or `--assistant vscode` names it
(`pxsig setup` lists the names). It prints the MCP entry,
which starts the server with the local install (`node node_modules/pxsig/bin/pxsig.mjs mcp`, no
`npx`), the policy that can turn it off on a managed machine, and the instruction for the
assistant not to approve. It then offers the repository's MCP file (for example
`.vscode/mcp.json`) and the instruction file (for example `.github/copilot-instructions.md`),
each created only on a typed yes and only when it does not exist. An existing file is never
edited: the block to add is printed. Files in the home folder are printed, never written; no other
tool's CLI is started.

`--print` prints and writes nothing; so does every run in CI, piped or under an assistant, where
`setup` asks nothing (without `--assistant` it lists the names). `--json` prints the recipe as
data and writes nothing.

### `pxsig manifest [--suite name]`

Rebuild the project's manifest from the running Storybook (or, when `storybook.url` does not
answer, from the build in `storybook.staticDir`, served on a free port): every story under `srcRoot` times its
modes times its interaction states, with `parameters.pxsig` read from the stories. Existing entries
keep their baseline paths; new entries have none. Prints where the stories came from (`from
<storybook.url>/index.json`, or `from <staticDir> (served at …)`) and the counts of new, removed
and skipped entries; `--json` has the same as `source: { url, staticDir }`. It warns, without
changing the exit code, when `srcRoot` does not exist or when no story in the index is under the
project (another package's Storybook on that port); `--json` lists them in `warnings`.
`--suite` writes `manifest.<suite>.json`.

### `pxsig migrate --from <dir> [--apply] [--no-verify]`

Move a pre-0.2 store into this project. A dry run without `--apply`; `--apply` takes the store
lock. See [migrating.md](migrating.md).

## Status and review

### `pxsig status`

The default command. Counts per state, accessibility totals, the components with the most changed
entries, whether the server is up, the integrity headline, and files edited since the report.

### `pxsig list [state]`

Entries in one state, with SSIM, the share of changed cells, and the first gate reason.

| Flag                 | Meaning                                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`              | `problems` (default: changed, error, flaky, rejected), `changed`, `new`, `error`, `flaky`, `rejected`, `approved`, `drift`, `pass`, `skipped`, `a11y`, `all`. Also `--state`. |
| `--component <text>` | Entries whose id contains this text.                                                                                                                                          |
| `--mode <name>`      | One mode.                                                                                                                                                                     |
| `--limit <n>`        | Rows shown (default 30).                                                                                                                                                      |

### `pxsig entry <id>`

One entry: state, metrics, gate reasons, changed regions, accessibility, review decision, a link to
the dashboard, and the paths of its images. `--images baseline,current,diff` chooses the images.

### `pxsig stale [--limit 200]`

Verdicts that cannot be trusted as current: older than an edit to a file that can change the entry
(traced through the import graph), or made on a render of a different size than the one on disk.
Exit 1 when there are any, or when too many files were edited since the oldest verdict to trace
them one by one (the stale gate: `advisoryExit` on [warn](#warn-mode)).

### `pxsig history [--limit 10]`

The last runs: when, how many entries, how many changed, which.

### `pxsig a11y [--component text] [--new] [--sarif file] [--limit 50]`

axe violations per entry, grouped by rule. `--new` shows only those not in the a11y baseline.
`--sarif <file>` also writes the last report's new violations as SARIF 2.1.0 (one result per entry
and rule, at the entry's story file), for code-scanning viewers; it changes no exit code.

### `pxsig a11y --prune [--dry-run] [--component text] [--mode m] [--only id,…] [--reason "…"]`

Accepted axe rules (`<store>/a11y.json`) that a fresh check shows no longer fire. A fixed rule
otherwise stays on the entry's accepted list and would hide the same violation if it came back.
Every accepted rule gets one class:

| Class         | When                                                                                                                                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prunable`    | A row for the entry, in `check.json` or any `check-<suite>.json`, where axe ran and the render did not fail, checked after the entry's last accessibility decision and its last approval, not stale (the test `pxsig stale` uses), and the rule is not among its violations |
| `still-fires` | That row lists the rule                                                                                                                                                                                                                                                     |
| `stale`       | The row is older than a decision, an approval or an edit that can change the entry                                                                                                                                                                                          |
| `not-covered` | No row where axe ran: never checked, `--no-a11y`, a render or axe error, or left out of its run                                                                                                                                                                             |

`--dry-run` lists them and writes nothing; anyone may run it, assistants included, and it exits 0.
It also prints the command that would decide the rest, for example `pxsig check --full --suite
matrix`. Without `--dry-run` it is a person's, at a terminal ([below](#commands-that-need-a-person)):
it lists the prunable rules, asks for `PRUNE <n> RULES`, removes only those, and writes one line
per entry to `<store>/a11y-decisions.ndjson`:
`{ at, via: "cli", action: "prune", id, before, after, rules, batch, reason, evidence: { report,
checkedAt }, pxsig }` (no name unless `approvals.identity` is set). While `pxsig serve` holds the
store it does the write, so the dashboard updates; otherwise the command takes the store lock. A
decision made between the list and the confirmation changes `a11y.json`, and the whole prune is
refused (exit 1): run it again.

### `pxsig affected <files…> | --since <ref>`

Which entries a set of edited files can change. Files are relative to the current folder.
`--since <ref>` uses the files changed since the merge base with that ref, plus staged, unstaged
and untracked work. Each path gets a class ([ci.md](ci.md#how-selection-decides)); a path the
selection cannot trace selects every entry, and the output lists each one (a candidate for
`affects.ignore`). It also lists the unresolved imports that add entries to every run (a
candidate for `affects.aliases` or `affects.unresolved`). `--json` adds `files` (path, status,
class, what it selects, why), `failSafe`, `ignored`, `baselines`, `records`, `otherSuites`,
`warnings`, `unresolved` (file, spec, line, why, accepted, what it selects) and `remote`.

## Checking

### `pxsig check` (quick)

```
pxsig check [ids…] [--changed a.tsx,b.ts] [--since <ref>] [--all]
```

Re-render and re-check some entries. Uses the running server (warm browsers) when there is one;
otherwise runs the full check for just those entries. Never writes baselines. Exit 1 when any
re-checked entry has a problem; exit 2 when every name was skipped.

A story (or entry) id the manifest does not have yet is registered first when Storybook is
healthy, then checked: its entries arrive NEW, with no signature, for a person to approve. A name
that cannot be registered is printed as `not checked: <name>: <why>`.

The last line is the project's integrity (`integrity: <headline>`, from `pxsig doctor`). When the
doctor cannot run it reads `integrity: unavailable (<reason>)`, and `--json` has `integrity: null`
with `integrityUnavailable: "<reason>"`; the exit code does not change.

| Flag                | Meaning                                         |
| ------------------- | ----------------------------------------------- |
| `ids…`              | Entry ids or story ids.                         |
| `--changed <files>` | The entries these comma-separated files affect. |
| `--since <ref>`     | The entries the changes since `<ref>` affect.   |
| `--all`             | Every entry.                                    |

### `pxsig check --full`

The full check. `check` also takes this path when given `--update`, `--suite` or `--modes`.

```
pxsig check --full [--suite name] [--since <ref> | --changed a,b] [--modes a,b] [--only id,id]
                   [--concurrency 8] [--retries 2] [--no-a11y] [--link-base <url>] [--out <name>]
                   [--no-server] [--timeout-s 1800] [--strict-env] [--sarif <file>]
                   [--warn[=gates]] [--enforce[=gates]] [--update]
```

| Flag                                  | Default                | Meaning                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--suite <name>`                      | none                   | Check `manifest.<suite>.json`; reports get the suite's name.                                                                                                                                                                                                                                    |
| `--since <ref>`                       | none                   | Only the entries affected by changes since `<ref>`. Others carry their previous result forward.                                                                                                                                                                                                 |
| `--changed <files>`                   | none                   | Only the entries these files affect.                                                                                                                                                                                                                                                            |
| `--modes <a,b>`                       | all                    | Only these modes.                                                                                                                                                                                                                                                                               |
| `--only <ids>`                        | all                    | Only these entry ids or story ids. A story not in the manifest yet is registered first (healthy Storybook; NEW entries, no signature), or reported as `not checked` with why.                                                                                                                   |
| `--concurrency <n>`                   | 8                      | Browser pages rendering in parallel.                                                                                                                                                                                                                                                            |
| `--retries <n>`                       | 2                      | Re-render failures up to n times; a pass on retry is `flaky`.                                                                                                                                                                                                                                   |
| `--no-a11y`                           | off                    | Skip axe.                                                                                                                                                                                                                                                                                       |
| `--link-base <url>`                   | none                   | Dashboard URL; the Markdown summary links each entry to `<url>#inspect=<id>`.                                                                                                                                                                                                                   |
| `--out <name>`                        | `check`                | Report file name (`<store>/reports/<name>.json`).                                                                                                                                                                                                                                               |
| `--no-server`                         | off                    | Do not hand the check to the server: when the server holds the store, refuse instead of queueing on it.                                                                                                                                                                                         |
| `--timeout-s <n>`                     | 1800                   | Seconds to wait for the server's queue to drain when the check was handed to it.                                                                                                                                                                                                                |
| `--strict-env`                        | off                    | Refuse before rendering (exit 2, nothing written) when a selected baseline was approved in a different render environment ([configuration.md](configuration.md#env)). Also `env.strict` and `PXSIG_STRICT_ENV=1`. Baselines that record no environment never refuse. Not applied to `--update`. |
| `--sarif <file>`                      | none                   | Also write the new axe violations as SARIF 2.1.0, for code-scanning viewers. Changes no exit code.                                                                                                                                                                                              |
| `--warn[=gates]`, `--enforce[=gates]` | config                 | [Warn mode](#warn-mode) for this run.                                                                                                                                                                                                                                                           |
| `--update`                            | off                    | Write baselines from the renders instead of checking. A person at a terminal only, after typing `UPDATE <n> BASELINES`. Every replaced baseline is snapshotted and logged. Refused without a person: exit 3; a wrong phrase: exit 1, nothing written.                                           |
| `--kind <word>`                       | none                   | With `--update`: the kind on each log line (lower case, up to 16 characters). `environment` re-takes baselines for a new render environment and leaves `a11y.json` as it is.                                                                                                                    |
| `--reason <text>`                     | `pxsig check --update` | With `--update`: the reason on each log line.                                                                                                                                                                                                                                                   |

**The render environment.** Each row records the environment of its render (`env`) and its
baseline's (`baselineEnv`), compared as `envMatch` (`same`, `compatible`, `mismatch`, `unknown`).
When any entry's baseline came from a different environment, one line follows the engine line,
for example `[check] env: 12 of 1074 entries rendered in a different environment than their
baseline (browser.version 141→142, fonts.probe: Inter) → pxsig doctor`, and `summary.md` gets a
line too. It is a warning; the exit code is unchanged unless `--strict-env` is given.

With `--since` / `--changed`, a path the selection cannot trace selects every entry; the `check`
line names each such path ([ci.md](ci.md#how-selection-decides)), and `summary.md` names the first.
Entries left out by `--since` / `--changed` keep their previous row. One with no previous row but
a baseline is recorded as unaffected (`skipped-unaffected` in the integrity ledger: ok, not yet
verified) instead of looking never-checked.

**One writer per store.** The full check takes the store lock (`<store>/reports/.lock`). When the
pxsig server holds it, because it serves this project, the selection is queued on the server
(`POST /__pxsig/check`), the check waits for the queue to drain and reports the server's rows;
`--update`, `--suite` and `--no-server` refuse instead. When another check holds it, the check
exits 2 and names it. A lock whose process is gone is stale and taken over; a live holder whose
heartbeat stopped 10 minutes ago can be taken over by a person typing `TAKE OVER`
([monorepo.md](monorepo.md#store-layout)).

**Storybook.** When `storybook.url` does not answer and `storybook.staticDir` holds a Storybook build
(`index.json` and `iframe.html`), the check serves that folder itself on a free 127.0.0.1 port. A
Storybook that answers with a broken index is a setup error, never replaced.

Steps: select entries, refuse to run against an unreachable or broken Storybook, render, trim,
check with the engine, retry failures, compare accessibility with its baseline, write reports,
update the integrity ledger. Writes `check.json`, `summary.md` and `junit.xml` in
`<store>/reports/`. Output is plain log lines; `--json` is not supported here (read
`check.json`).

Exit: 0 pass, 1 at least one entry changed, is new or failed to render (or, with `a11y:
enforce`, has new axe violations), 2 setup error. Under [warn mode](#warn-mode), `advisoryExit`
where only warned gates would have failed. With `--strict-env` and the env gate on warn, the check
renders anyway and lists the baselines it would have refused.

## Approvals

### `pxsig approve`

The guarded way to accept many changes at once. Every approval, from any surface, is logged in
`<store>/approvals.ndjson` with who, when, how, why, the batch, the git HEAD, and the sha256 of the
baseline before and after. The replaced baseline is kept in `<store>/history/<batch>/`.

Approvals are a person's: in the dashboard, or with `pxsig approve` in a terminal. The server
refuses an agent or a script posting to it (see [server.md](server.md#guards)). Who must review a
baseline change in a pull request is set by the code host: see [codeowners.md](codeowners.md).

| Subcommand                                                              | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `plan <ids…> --reason "…"`                                              | Classify each changed entry as a `colour` change (content in place) or a `shape` change (moved, added, removed, resized). Shape changes are blocked unless named in `--allow-shape id,id`. Stale verdicts and entries not in state `changed` or `new` are blocked. Pins the sha256 of every render and baseline. Writes `<store>/reports/approval-plan.json`. Safe for anyone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `plan --component <text>` / `plan --all-changed`                        | Select the changed entries by id text, or all of them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `plan --new [--first-baselines]`                                        | Select the NEW entries: no baseline yet, with a latest render. With nothing to compare, each is a shape change: blocked unless named in `--allow-shape`, or allowed all at once by `--first-baselines`. Combines with the selections above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `apply [plan]`                                                          | A person at a terminal only. Needs the server, and no check running. Refuses the whole plan if any render changed since planning, an entry is no longer in the manifest, or the plan is older than 24 hours. Asks for `APPROVE <n> ENTRIES`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `log [--limit 10] [--trace]`                                            | Approvals by batch. `--trace` adds, from git, the commit that added each batch's log lines (`not committed` until then) and the pull request that merged that commit: the first merge after it on HEAD's first-parent line (`Merge pull request #12`, GitLab's `See merge request !12`), or the commit's own squash subject (`… (#12)`). It shows no names or emails: the commit and the PR say who.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `undo <batch>`                                                          | Restore the baselines a batch replaced; move first baselines it created to `<store>/trash/`. A person at a terminal only; takes the store lock. Uses `<store>/history/<batch>/` when this machine has it, else git (below). An entry approved again in a later batch is refused, so that approval is never reverted silently: undo the later batch first. Exits 1 when any entry was refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `verify [--no-strict] [--since <ref>] [--suite <name> \| --all-suites]` | Baselines whose bytes differ from their last logged approval, and baselines with no approval logged. **Strict by default** (0.4.0): a baseline with no log line fails, with the entries named and the exact `--adopt` command; `--no-strict` reports it without failing. An entry with no baseline yet is not counted. A baseline written by an approval that stopped before its log line (a crash) is listed as `interrupted`, with `approve undo <batch>` as the next step, not as written outside the trail; approval-log lines a crash cut short are left out and counted (`torn`). `--since <ref>` also fails when the log at the merge base with `<ref>` is not a byte prefix of today's (lines removed or changed: the log is append-only), or when there is no merge base (exit 2 when `<ref>` is not a commit). `--suite` verifies one suite; `--all-suites` the main manifest and every suite, listing a suite whose manifest is not in the checkout (git-ignored) as not committed. Exits 1 on a mismatch, an interrupted approval, a baseline with no log line (strict) or a failed `--since`. With the verify gate on [warn](#warn-mode), only the baselines with no log line are warned. Reads only; any caller. |
| `verify --adopt [--suite <name> \| --all-suites]`                       | A person at a terminal: log the current baselines as the starting point, after typing `ADOPT`. For baselines from before pxsig kept a log.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

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

```
pxsig doctor [--component text] [--status code,…] [--ci] [--fail-on error|warn|info] [--offline] [--limit 40]
pxsig doctor --repair [--only actions] [--apply] [--prune] [--stale]
```

| Flag                            | Meaning                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `--component <text>`            | Components whose name contains this text.                                                                                       |
| `--status <code,…>`             | Only these integrity codes.                                                                                                     |
| `--ci`                          | Fail only on error-severity codes (the same as `--fail-on error`).                                                              |
| `--fail-on <error\|warn\|info>` | The lowest severity that makes the exit 1 (default `warn`).                                                                     |
| `--offline`                     | Do not fetch the Storybook index; scan the story files instead.                                                                 |
| `--limit <n>`                   | Components shown (default 40).                                                                                                  |
| `--repair`                      | Plan the safe repairs (a dry run).                                                                                              |
| `--only <actions>`              | Only these repairs: `register`, `recheck`, `restore-baseline-image`, `convert-legacy`, `log-torn` (which runs only when named). |
| `--apply`                       | Run the planned repairs. Takes the store lock.                                                                                  |
| `--prune`                       | With `--repair --apply`: move orphans to `<store>/trash/`. A person at a terminal, after a typed phrase.                        |
| `--stale`                       | Also re-check stale verdicts (left out by default).                                                                             |

Exit: 0 nothing at or above `--fail-on`, 1 findings at or above it (`advisoryExit` with the doctor
gate on [warn](#warn-mode)), 2 a setup error or usage, 3 `--prune` or `log-torn` without a person
at a terminal. The details list has an `Enforcement` row: each gate not enforced, and until when.

Before a manifest exists (a fresh `pxsig init`), `doctor` prints a setup preflight instead: the
engine binary and its version (as `pxsig --version` finds them), the Playwright package that
resolves and its version, whether Playwright's Chromium is at its `executablePath()` (a file check;
no browser starts), the configured `storybook.url` and `storybook.staticDir` (as config; nothing is
fetched), and the assistant marker. Then the error once, and `pxsig manifest` as the next step;
exit 2. With `--json`: `{ error, preflight: { engine, playwright, chromium, storybook, agent },
next }`. The MCP tool `pxsig_doctor` answers the error with the same `{ preflight, next }`.

## Server, MCP, reports

| Command                                                                                                                                                      | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pxsig serve [--port 6070] [--watch] [--no-open] [--tab name] [--project a,b] [--debug]`                                                                     | The server and dashboard for the workspace. See [server.md](server.md). Started by a person at a terminal, it prints the dashboard link (approving from the dashboard needs it once per browser; [server.md](server.md#guards)). `--debug` prints every program it starts ([platforms.md](platforms.md#programs-pxsig-starts)). The dashboard is `PXSIG_DASHBOARD_DIR` if set; else, when a served project sets `dashboard.ui`, its `pxsig dashboard build` output if that is newer than the adapter's files and from this pxsig version; else the prebuilt one, with a line saying which command builds the missing or stale one. Serve never builds.                                                                                                                                                                            |
| `pxsig serve --link [--open] [--copy]`                                                                                                                       | A fresh dashboard link from the running server, printed for a person at a terminal (exit 3 when piped, in CI or under an assistant's marker; exit 2 when no server runs). 5 minutes to access it; it works once. Once opened, that browser can approve, with no time limit, until the server stops or the browser closes. `--open` also opens it in the default browser (macOS and Linux; on Windows it is only printed). `--copy` also copies it to the clipboard and says so (macOS and Linux; opt-in, since any program can read the clipboard).                                                                                                                                                                                                                                                                               |
| `pxsig mcp`                                                                                                                                                  | The MCP server on stdio. See [mcp.md](mcp.md); `pxsig setup` prints each assistant's entry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `pxsig report [--out dir]`                                                                                                                                   | A static dashboard for one project, which opens from disk. Default `<store>/reports/site/`. Exits 2 on any error.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pxsig snapshot [--out file] [--project a,b]`                                                                                                                | A read-only summary of the committed store for a Storybook deployed to a shared server ([team.md](team.md)): per entry, its baseline, last approval (date, event, PR, commit, colour or shape, reason), render environment and accepted a11y rules; per story, the history by batch. Reads the store and git only. Never `by`, `via`, names, emails, paths or images; a migration's reason (the old file path) is left out. In a shallow clone no PR or commit is shown (`shallow: true`), never a wrong one. Every project by default. Without `--out`, the JSON on stdout.                                                                                                                                                                                                                                                      |
| `pxsig dashboard build [--ui path] [--out dir]`                                                                                                              | Rebuild the dashboard on this project's design system through a UI adapter (`--ui`, else `PXSIG_UI_ADAPTER`, else `dashboard.ui`, else `hydrotik` when `PXSIG_DS_SOURCE` is set, else the built-in `plain`), with the project's own Vite (`vite`, `@vitejs/plugin-react`, `@vanilla-extract/vite-plugin`, `react`, `react-dom` installed). Run it in the folder of that `pxsig.config.json`. Default output `node_modules/.cache/pxsig/dashboard`, which `pxsig serve` then uses (below); `--out` writes elsewhere (serve it with `PXSIG_DASHBOARD_DIR`). Refused, with the migration notes, when the adapter's `conformance.json` records an older major UI contract version ([ui/contract-changes.md](ui/contract-changes.md)); an older minor builds and says what falls back. See [ui/build-adapter.md](ui/build-adapter.md). |
| `pxsig dashboard gaps [--ui path] [--json]`                                                                                                                  | What the adapter covers of the UI contract: missing, partial and bespoke components and the dashboard files each affects. Also the UI contract version the adapter is written for against this pxsig's ([ui/contract-changes.md](ui/contract-changes.md)). Exit 1 when a required component is missing, its `conformance.json` is malformed, or it is written for an older major contract version.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `pxsig dashboard check [--ui path] [--build dir] [--out dir] [--reference dir] [--themes dark,light] [--only feature,…] [--compare dir] [--strict] [--json]` | Every dashboard feature's screens on the adapter build (default `node_modules/.cache/pxsig/dashboard`), from sample data that ships with pxsig, in each theme, with Playwright's Chromium: a gallery beside the prebuilt reference dashboard, axe and layout findings (overflow, clipping, control rows, frame edges, overlap) on each screen (advisory; `--strict` fails on any), page errors; with `--compare <dir>`, each screen against an earlier check's output, by the engine (advisory). Reads no project data; writes only `--out` (default `node_modules/.cache/pxsig/dashboard-check`). Exit 1 when a screen does not render; 2 with no build, no Chromium, or an adapter for an older major contract. See [ui/build-adapter.md](ui/build-adapter.md#verify).                                                          |
| `pxsig cat <file> [--image out.png]`                                                                                                                         | Print a baseline's header as JSON (git's textconv for `*.psig`). `--image` writes a `.psig`'s baseline image.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `pxsig browser start [--image tag] [--port 3000]`                                                                                                            | Run Playwright's browser server in the pxsig container image, published on 127.0.0.1 only, and record its endpoint, image and digest in `node_modules/.cache/pxsig/browser.json`. Then `--browser ws://127.0.0.1:3000/` (or `PXSIG_BROWSER_WS`) renders there. The default image is `ghcr.io/hydrotik/pxsig:<this pxsig>-pw<the project's Playwright>`. Exit 2 without the docker CLI or its daemon. See [container.md](container.md#mode-ii-only-the-browser-in-the-container).                                                                                                                                                                                                                                                                                                                                                  |
| `pxsig browser stop`                                                                                                                                         | Stop the recorded browser container and remove its record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `pxsig browser status [--json]`                                                                                                                              | The recorded container: endpoint, image, digest, Playwright, running or not; warns when the project's Playwright is not the image's major.minor. Nothing recorded: exit 0 without starting docker. `browser start`, `stop` and `status` are the only commands that start `docker` ([platforms.md](platforms.md#programs-pxsig-starts)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## The engine binary

The `pxsig` binary from `crates/pxsig-cli`. The npm CLI finds it through `PXSIG_BIN`, the
platform package, or a source checkout's `target/release/`. It takes `-j, --threads <n>`
(`PXSIG_THREADS`) on every command. Exit: 0 pass, 1 visual regression, 2 usage, IO or validation
error.

| Command                                                                                                                                                                                                                                                        | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capture <png> [--out file] [--grid 64] [--detail]`                                                                                                                                                                                                            | Write a baseline from one render. `--out` ending in `.psig` writes a container with the render as its image; otherwise a spec v1 `.pxsig.json`. Default: `<png stem>.psig`.                                                                                                                                                                                                                                                                                                                                                                   |
| `compare <png> <baseline> [--out-dir dir] [--json] [gate flags]`                                                                                                                                                                                               | Compare one render with one baseline. Writes `<stem>.diff.html` and `<stem>.diff.png`.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `check --manifest m --png-dir d [--root r] [--only ids\|@file] [--out-dir d] [--json\|--format human\|json\|junit\|markdown] [--artifacts all\|failed\|none] [--no-artifacts] [--cache dir] [--history file] [--base-png-dir d] [--tolerance 16] [gate flags]` | Batch check of every manifest entry's `<png-dir>/<id>.png`, in parallel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `baseline --manifest m --png-dir d [--root r] [--only …] [--no-detail] [--json]`                                                                                                                                                                               | Write a baseline for every entry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `diff <a.png> <b.png> [--tolerance 16] [--mask out.png] [--json]`                                                                                                                                                                                              | Full-resolution pixel diff: changed pixels and change regions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `affected --manifest m [--root r] [--since main] [--files a,b] [--json]`                                                                                                                                                                                       | Entries a change can affect: each changed path is classified ([ci.md](ci.md#how-selection-decides)); baselines and store records select their entries, the import graph ([ci.md](ci.md#what-counts-as-an-import)) selects story files, and a path nothing traces selects all. JSON: `all`, `reason`, `changed`, `ids`, `traced` (without the fail-safe or unresolved imports), `storyFiles`, `graphFiles`, `mergeBase`, `warnings`, `files`, `baselines`, `records`, `removed`, `failSafe`, `ignored`, `otherSuites`, `unresolved`, `remote`. |
| `report --input check.json [--format markdown\|junit] [--link-base url] [--out file]`                                                                                                                                                                          | Markdown summary or JUnit from a check result.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `trim <dir> [--only …] [--pad 16] [--tolerance 8] [--json]`                                                                                                                                                                                                    | Crop renders to content (right and bottom), in place.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `pack <record> --out x.psig [--image png] [--entry json]`, `pack --plan plan.json [--json]`                                                                                                                                                                    | Pack spec v1 records and images into `.psig` files, reading each back to prove it.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `cat <file> [--image out.png]`                                                                                                                                                                                                                                 | Print a baseline's header.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `attach <psig> <png> [--json]`                                                                                                                                                                                                                                 | Add an image to a `.psig` that has none. Refuses one that has an image; verifies the signature is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `serve`                                                                                                                                                                                                                                                        | The engine as a long-lived process: one JSON request per line on stdin, one response per line on stdout. Methods: `ping`, `capture`, `compare`, `check`, `baseline`, `trim`, `diff`, `affected`.                                                                                                                                                                                                                                                                                                                                              |
| `detail-sweep --input pairs.json`                                                                                                                                                                                                                              | Raw data for calibrating the detail channel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Gate flags: `--threshold`, `--min-ssim`, `--max-changed-pct`, `--max-edge-pct`, `--min-cells`,
`--no-detail`, with environment variables `PXSIG_THRESHOLD`, `PXSIG_MIN_SSIM`,
`PXSIG_MAX_CHANGED_PCT`, `PXSIG_MAX_EDGE_PCT`, `PXSIG_MIN_CELLS`. Each entry's gate is resolved
in this order, last wins: built-in defaults, the manifest's `gate` (the project config), the
environment, the flags, and the story's own `parameters.pxsig.gate`. A story gate is never
overridden by anything run-wide. `--root` falls back to
`PXSIG_ROOT`; `capture --grid` to `PXSIG_GRID`.
