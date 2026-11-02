# Migrating

## Upgrading to 0.7

0.7.3: `playwright` is an optional peer dependency, so npm no longer installs it with pxsig. A
project with no `playwright` or `@playwright/test` of its own adds it: `npm install -D playwright`.

0.7.2 needs nothing: `pxsig dashboard check` now renders in UTC and `en-US`, so on a machine
outside UTC a screen that shows a time differs once from an earlier `--compare` run.

0.7.1 needs nothing: its one behaviour change, `pxsig dashboard check` measuring only an open
modal dialog, can only list fewer findings.

0.7.0 changes some defaults, refuses input it used to accept and sends no path over HTTP. Each change
is in `CHANGELOG.md` under 0.7.0 with a `To update:` line; by who acts:

**Scripts and CI.**

- A misspelled or retired flag is now an error (exit 2), not a warning: correct the flag the
  message names, or remove it.
- A number flag needs a whole number in range (`--port 1..65535`, `--retries`, `--settle-ms`,
  `--min-cell-px` from 0, the others from 1): a bad value exits 2 instead of using the default.
- `pxsig doctor` with no manifest prints its error on stdout with a setup preflight; a script that
  matched it on stderr reads stdout, or `--json` (`error`).

**Servers and clients of the HTTP API** ([server.md](server.md)).

- The CLI, the MCP server and the Storybook addon use a pxsig server only when it serves their own
  workspace (`workspaceId` in `GET /__pxsig/status`). Start `pxsig serve` in each workspace that
  uses one, and restart a server started with 0.6.0 so it names its workspace; or set `PXSIG_URL`
  to the server meant.
- `POST /__pxsig/approve-story` answers 403 unless the project sets `approvals.byStory: true`: the
  dashboard approves one entry per decision. Approve each entry on its own, or set the key.
- No answer carries an absolute path. `GET /__pxsig/status`'s `approving` answers `folder` (the
  folder's name) instead of `cwd`; `GET /__pxsig/projects` answers `workspaceId` instead of
  `workspace`. A client that needs the path runs `pxsig projects --json`, which works it out in its
  own process.

**Packages and installs.**

- Peers: `playwright >=1.58` and, for `@pxsig/storybook-addon`, `storybook >=10`. npm 7+ stops
  with `ERESOLVE` on an older pinned version: update, or install with `--legacy-peer-deps`.
- React is an optional peer, `react >=19`, for `pxsig/diff-viewer` and `pxsig dashboard build`.
- `pxsig/workspace` exports five names (`openProject`, `findWorkspace`, `pickProject`,
  `loadProject`, `SetupError`); code that imported another reads it from `openProject()` or
  `pxsig config --json`. `pxsig/dashboard` is types only: `import type`.

**Dashboard builds.** `pxsig dashboard build` with no adapter configured builds `plain`; for the
reference look pass `--ui hydrotik` or set `PXSIG_DS_SOURCE`. The prebuilt dashboard in the
package is unchanged.

**Nothing to do** for the rest: pxsig's own axe-core and its version in the render environment, no
retries of NEW entries, `dashboard check`'s `settled` and `retried` fields, `pxsig init` recording
the Storybook folders (check the config it writes), `pxsig manifest`'s source and warnings, and the
dashboard link's 5 minutes to be accessed (up from 2). Optional: a `label` in
`pxsig.workspace.json` names the workspace in the dashboard's title (`pxsig • <label>`).

## Upgrading to 0.6: deployed Storybooks and stricter input

0.6.0's behaviour changes, each in `CHANGELOG.md` under 0.6.0; by who acts:

- **A Storybook deployed to a shared address** (dev, UAT, pre-prod): the panel no longer connects
  to a pxsig server on each viewer's computer. `storybook build` writes `pxsig-snapshot.json`
  into the build, so the panel shows the committed baselines read-only; option `snapshot: false`
  leaves it out. A Storybook served from this computer keeps the live panel.
- **Story authors:** `pxsig manifest` checks `parameters.pxsig`. A value of the wrong type
  (`grid: '96'`, `ignore: '.live'`, a state with no `name`) is a setup error (exit 2) naming
  the story and the key: fix the parameter it names.
- **CI that runs `pxsig stale`:** above the number of edited files it traces, it now exits 1
  and names `pxsig check --all` instead of passing (`advisoryExit` on warn). Run that check.
- **Scripts calling `pxsig list` or `pxsig a11y`:** a flag without its value (`--component`
  alone) exits 2; give the value.

## Upgrading to 0.4: strict `approve verify`

From 0.4.0, `pxsig approve verify` fails (exit 1) when a baseline has no line in
`approvals.ndjson`. Before, it listed those baselines and passed. A store whose baselines predate
the log fails until a person adopts them once:

```bash
pxsig doctor                                  # warns: N baselines have no approval log line (verify-unlogged)
pxsig approve verify                          # names them and prints the exact command below
pxsig approve verify --adopt [--all-suites]   # a person, in a terminal: type ADOPT
```

Commit the log lines it adds. `--no-strict` keeps the old result where a team needs time.

## Upgrading to 0.5: the a11y gate

0.5.0 adds warn mode (`enforcement`, [configuration.md](configuration.md#enforcement)). With no
`enforcement` key, every gate is enforced as before, and every exit code and report is the same,
with one addition: new axe violations (not on an entry's accepted list) are now a gate on `warn`
by default. When a run finds one, it prints one line, `[pxsig] ADVISORY: would have failed (exit
1): N entries with new a11y violations. Not blocking.`, `summary.md` opens with an advisory lead,
and `check.json` carries `enforcement`. The exit stays 0. `enforcement.gates.a11y: "off"` removes
the line; `"enforce"` makes new violations fail the run.

## Migrating a pre-0.2 store

Before 0.2, pxsig kept everything in the folder it was installed in: signatures in `.baselines/`,
baseline images in `.renders/base/`, manifests in `js/pxsig.manifest*.json`, reports in
`.reports/`. Version 0.2 keeps each project's data in the project's store, with one `.psig` file
per baseline. `pxsig migrate` moves an old folder into a project.

```bash
pxsig migrate --from <old pxsig folder> [--project ui]              # dry run: the plan
pxsig migrate --from <old pxsig folder> [--project ui] --apply      # do it (holding the store lock), then verify
pxsig migrate --from <old pxsig folder> [--project ui] --apply --no-verify
```

Set the project up first (`pxsig init`), with the `srcRoot`, `storybook`, `modes`, `gate` and
other settings the old config held. The migration moves data, not settings.

The old manifests give baseline paths relative to the repository root, so run the migration in
the repository the old folder belongs to, with that repository as the workspace.

The old folder is only read. Nothing in it is moved, changed or deleted. Keep it until you are
satisfied, then delete it yourself.

## What moves where

| Old location                                                                 | New location                                                                          | How                                                                                                                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.baselines/**/<id>.pxsig.json` plus `.renders/base/<id>.png`                | `<store>/baselines/<component>/<id>.psig` (or `__pxsig__/` with the colocated layout) | Packed by the engine (`pxsig pack`): the record and the signature bytes unchanged, the PNG bytes unchanged. Each file is read back and must equal its sources. |
| `.baselines/**/<id>.pxsig.json` with no image                                | `<store>/baselines/<component>/<id>.psig`                                             | Packed with the signature only. An approval adds an image later.                                                                                               |
| `js/pxsig.manifest.json`                                                     | `<store>/manifest.json`                                                               | Each entry's `sig` rewritten to the new path. Settings the old manifest repeated are dropped; they come from the config now.                                   |
| `js/pxsig.manifest.<suite>.json`                                             | `<store>/manifest.<suite>.json`                                                       | The same, per suite.                                                                                                                                           |
| `.baselines/approvals.ndjson`                                                | `<store>/approvals.ndjson`                                                            | Copied, then one `migrated` line appended per baseline (below).                                                                                                |
| `.baselines/a11y.json`                                                       | `<store>/a11y.json`                                                                   | Copied.                                                                                                                                                        |
| `.reports/review.json`, `history.ndjson`, `check.json`, `check-<suite>.json` | `<store>/reports/`                                                                    | Copied, so pending reviews and run history survive.                                                                                                            |
| `.renders/latest`, caches, diff output, approval snapshots                   | not migrated                                                                          | The next check regenerates them.                                                                                                                               |

Entries without a signature in the old folder are listed in the new manifest with no baseline; they
show as new.

The plan reports a problem, and `--apply` stops, when two old baselines would land on the same new
path, or a manifest is not readable. `--apply` also refuses to write into a store that already has
any of the target baselines: migrate into an empty store.

## The approvals trail

The old trail is copied as it is. Then pxsig appends one line per migrated baseline:

```json
{
  "at": "…",
  "id": "button--primary",
  "by": "pxsig migrate",
  "via": "migrate",
  "batch": "migrate-…",
  "reason": "moved from <old path>",
  "kind": null,
  "gitHead": null,
  "before": "<sha256 of the old file>",
  "after": "<sha256 of the new .psig>"
}
```

`pxsig approve verify` then starts clean on the new store: every baseline's bytes match its last
logged approval.

## Verification

With `--apply`, unless `--no-verify` is given, pxsig checks that the move changed no verdict. For
each manifest (main and suites) it runs the engine twice on the old folder's latest renders
(`.renders/latest/`): once against the old baselines and once against the new ones, with the same
engine, gate and settings. Every entry must get the same verdict, the same metrics and the same
detail result.

The output lists, per manifest, the entries compared, the passes before and after, and how many
differ, with a sample of ids. The command exits 1 if any entry differs.

A suite whose renders are not on disk has nothing to compare: both runs report the missing render
for every entry, so they agree. For those entries the proof is the read-back in `pack`, which
checks that each `.psig` holds exactly the record, signature and image it was packed from.

## After migrating

1. Run `pxsig doctor`. Entries whose old baseline had no image report `missing-baseline-image`;
   `pxsig doctor --repair --apply` adds the image where the latest render passes the gate.
2. Run `pxsig check --full` and compare the result with the last check from the old folder.
3. Commit the project's config and store. Add `git config diff.psig.textconv "npx pxsig cat"` to
   see `.psig` headers in diffs (see [monorepo.md](monorepo.md#reviewing-psig-changes-in-git)).
   With the colocated layout, `--apply` has already added `*.psig binary diff=psig` to the root
   `.gitattributes` if it was missing: commit that too.
4. Delete the old folder when you no longer need it.

A single `.pxsig.json` baseline that is still referenced by a manifest (a store that was never
migrated, or one file copied in later) shows in `pxsig doctor` as `legacy-format`, a warning.
`pxsig doctor --repair --apply` converts it to a `.psig` in place when its latest render passes
the gate (see [integrity.md](integrity.md#repairs)).
