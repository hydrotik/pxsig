# Integrity

A passing check says nothing about what it did not render: a story with no manifest entry, a
baseline with no image to show, a verdict older than the code it judged. The integrity layer joins
every source pxsig has, gives each entry and each component a status, and repairs what it can
repair with proof. It never writes a signature and never approves anything.

```bash
pxsig doctor                          # per-component status
pxsig doctor --repair                 # the safe repairs, as a dry-run plan
pxsig doctor --repair --apply         # run them
pxsig doctor --ci                     # in CI: fail on error-severity codes only
```

The server keeps the ledger current on its own (on start, after every check, and when sources,
baselines, renders or the manifest change). A full check writes it at the end of its run.

## Sources

| Source | Where | Used for |
| --- | --- | --- |
| Story index | Storybook's `<storybook.url>/index.json` when it answers with a valid index; else a static scan of `*.stories.{tsx,ts,jsx,js}` under `srcRoot`, with ids built by Storybook's rules | `unregistered`, `orphaned` |
| Manifest | `<store>/manifest.json`; suite manifests own their baselines too | every entry |
| Config | `pxsig.config.json`: `nonVisual`, `integrity` | `excluded`, options |
| Baselines | each entry's `.psig` | `unbaselined`, `missing-baseline-image` |
| Latest renders | `<store>/renders/latest/<id>.png` | `missing-render`, `stale` |
| Diffs | `<store>/diffs/latest/`: diff images, and `<id>.baseline.png`, the signature reconstruction the engine writes for failures | fallback display image |
| Last report | `<store>/reports/check.json` rows | `ok`, `changed`, `flaky`, `render-error`, `never-checked`, `drift` |
| Review and approvals | `<store>/reports/review.json`, `<store>/approvals.ndjson` | an approved change is not `changed` |
| a11y baseline | `<store>/a11y.json` | `a11y-new` |
| Source freshness | modification times under the source roots, traced to entries through the engine's import graph (`pxsig affected`); without the binary, or above `maxTracedFiles` edited files, "same component folder" | `stale` |

Reading writes nothing except the ledger.

## Status codes

Codes are stable. They are never renamed, only added to. An entry carries every issue that
applies, most severe first; its status is the first one. A component's status is the most severe
status among its entries.

| Code | Severity | Meaning | Safe repair |
| --- | --- | --- | --- |
| `unregistered` | error | The story is in the index and in scope, but not in the manifest. Nothing renders or checks it. | `register` |
| `render-error` | error | The last render failed: a timeout, a missing selector, Storybook's error page. | `recheck` |
| `never-checked` | error | In the manifest with a signature, but absent from the last report. The reason says why. | `recheck` |
| `missing-baseline-image` | error | The `.psig` baseline has a signature but no image. The dashboard cannot show the baseline. | `restore-baseline-image` |
| `legacy-format` | warn | A pre-0.2 `.pxsig.json` baseline: it holds the signature but cannot hold an image. The issue's `hint` names the fix. | `convert-legacy` |
| `unbaselined` | warn | In the manifest without a baseline: new, waiting for a person to approve its first render. | none |
| `missing-render` | warn | No latest render on disk. | `recheck` |
| `orphaned` | warn | A baseline with no manifest entry, or an entry whose story left the index (renamed or deleted). | none; `--prune` moves the files aside |
| `changed` | warn | The gate failed and nobody approved the change. | none |
| `flaky` | warn | Failed, then passed on a fresh render. | none |
| `stale` | warn | A source the entry depends on changed after its verdict, or its render was rewritten after it. | `recheck` with `--stale` (or where a later step needs a fresh render) |
| `a11y-new` | warn | axe reports violations not in the a11y baseline. | none |
| `skipped-unaffected` | info | A partial run (`check --since` / `--changed`) left it out because no edit it traced can change it, and there was no earlier verdict to carry forward. It has a baseline: ok, but not verified by a run of its own. | none (a full check verifies it) |
| `drift` | info | Passes the gate, but SSIM is below 1. | none |
| `excluded` | info | Left out by `nonVisual`, `parameters.pxsig.disable` or the `no-pxsig` tag. | none |
| `ok` | info | Covered, rendered, checked, fresh and passing. | none |

Override a severity per code in the project config:

```json
{ "integrity": { "severity": { "unbaselined": "error" } } }
```

A spec v1 `.pxsig.json` baseline cannot hold an image, so it reports `legacy-format` (a warning),
not `missing-baseline-image`. `pxsig doctor --repair --apply` converts it to a `.psig` when its
latest render passes the gate; `pxsig migrate` moves a whole pre-0.2 store (see
[migrating.md](migrating.md)); the engine's `pxsig pack` converts one file by hand.

Entries left out of a `check --since` run in CI (a fresh report, no earlier rows) report
`skipped-unaffected`, not `never-checked`, so a PR run is not failed by entries it was right to
skip.

### Setup problems

Problems with the setup sit outside the entries, in `setup`:

| Code | Severity | Meaning |
| --- | --- | --- |
| `storybook-index-broken` | error | Storybook answered, but not with a story index (for example "Unable to index files"). |
| `storybook-unreachable` | info | Storybook did not answer; the static scan was used. |
| `line-endings` | warn | A store record (manifest, `approvals.ndjson`, `a11y.json`) is checked out with CRLF line endings, or git does not treat `.psig` files as binary. Both happen on Windows without the store's `.gitattributes` (`pxsig init` writes it for new stores). The reason names the fix. |
| `log-torn` | warn | Lines of `approvals.ndjson` a crash cut short (a write that never got its newline). Every reading leaves them out; `pxsig doctor --repair --only log-torn --apply` (a person at a terminal) removes them. |
| `path-portability` | warn | A baseline path Windows cannot check out (a reserved name such as `CON` or `NUL`, a trailing dot or space, one of `<>:"\|?*`, over 240 characters), or two baseline paths that differ only in case. |

The workspace-level codes (`project-unlisted`, `project-missing`, `version-skew`) are in
[monorepo.md](monorepo.md). A `warn` setup problem never changes `doctor`'s exit code.

## The ledger

`<store>/reports/integrity.json`, rewritten atomically:

| Field | Content |
| --- | --- |
| `schemaVersion` | `1` |
| `generatedAt` | When it was computed |
| `sources` | What was read: story index (live or static, counts), manifest, config, report, renders, signatures, approvals, review, a11y baseline, staleness method |
| `setup` | Setup problems (above) |
| `summary` | `status` (`clean`, `warnings` or `attention`), `headline`, counts by severity, status and code |
| `components` | One row per component: status, severity, counts per code |
| `entries` | One row per entry: `id`, `story`, `component`, `status`, `severity`, `issues[]` with `code`, `severity`, `reason` |

## Repairs

`pxsig doctor --repair` prints a plan. `--apply` runs it. `--only` limits it to some actions.

| Action | For | What it does |
| --- | --- | --- |
| `register` | `unregistered` | Adds the stories to the manifest, with modes and states from `parameters.pxsig`, and **no signature**. They show as new and wait for a person to approve their first render. The entries it adds are rendered by the `recheck` step of the same run, so a new story takes one run. A story whose parameters cannot be read is reported and left out; the rest go on. An existing signature at a new entry's path (a story renamed back) is adopted as it is, and logged. Needs a running, healthy Storybook. The previous manifest is kept in `<store>/reports/manifest-history/`. |
| `recheck` | `never-checked`, `missing-render`, `render-error`, the entries `register` added; `stale` only with `--stale`, or where `restore-baseline-image` or `convert-legacy` needs a fresh render | Re-renders and re-checks the entries, through the server when it is running. Never writes a baseline, and never re-renders an orphaned entry. The result counts what the check recorded (`N of M entries re-checked`); a check that could not run reports `not re-checked: <why>`. |
| `restore-baseline-image` | `missing-baseline-image` | Takes the entry's latest render, checks it against the signature with a fresh engine check (no cache), and only if it passes the gate, adds it to the `.psig` with `pxsig attach`. Otherwise the entry stays flagged. |
| `convert-legacy` | `legacy-format` | Gates the latest render against the `.pxsig.json` the same way; only if it passes, packs the record (unchanged, read back and compared by `pxsig pack`) with the render as its image into a `.psig` beside it, points the manifest entry at it (the previous manifest is kept in `manifest-history/`) and moves the `.pxsig.json` to `<store>/trash/`. |
| `prune` | `orphaned` | Only with `--prune --apply`, by a person at a terminal, after typing a confirmation phrase. Moves the orphaned files to `<store>/trash/<timestamp>/` and drops manifest entries whose story is gone. Nothing is deleted. |

Codes with no safe repair (`changed`, `flaky`, `unbaselined`, `a11y-new`, `stale` without
`--stale`, and `orphaned` without `--prune`) are listed under "Needs a person", with what to do.

Stale verdicts are warnings, and re-checking them can take a long time in a large store (every
entry a widely shared file feeds), so a repair of the errors leaves them alone. `pxsig check
--since <ref>` or `pxsig doctor --repair --stale --apply` re-checks them.

### New stories

A story just written is `unregistered` until it is registered. Any of these registers it and
renders it in one step:

- **Run safe repairs** in the dashboard, or `pxsig doctor --repair --apply`;
- `pxsig check <story-id>` or `pxsig check --full --only <story-id>`, the MCP's
  `pxsig_check { stories }`, the Storybook panel's **Check story**, or `POST /__pxsig/check`: a
  name the manifest does not have is registered first when Storybook is healthy. A name that
  cannot be registered (Storybook down, not in the index, outside `srcRoot`, excluded, a mode or
  state the story does not have) is skipped with the reason.

Either way the entries arrive without a signature (`unbaselined`, "Needs a first approval" in the
dashboard's banner) until a person approves their first render; the inspector's **Approve story**
approves every mode and state of a story in one click.

### Guarantees

These hold for every repair, and are covered by tests:

- **Signatures never change.** Every write by the repair code goes through a guard that refuses
  `.psig` and `.pxsig.json` files and the baselines folder. `pxsig attach` (the engine) adds an
  image only to a `.psig` that has none, and `pxsig pack` converts a `.pxsig.json`; both verify
  afterwards that the record and signature bytes are byte for byte the same.
- **A missing image is restored only from a render that passes the gate** against the existing
  signature.
- **Nothing is approved.** New stories arrive without a signature.
- **Nothing is deleted.** Pruning moves files into the store's `trash/`.
- **Every action is logged** in `<store>/reports/repairs.ndjson`: who, when, what, why, the result.
- Each step checks its precondition right before it acts.

## `pxsig doctor`

```
pxsig doctor [--project x] [--component name] [--status code,code] [--limit 40]
             [--offline] [--ci] [--fail-on error|warn|info]
             [--repair [--only register,recheck,restore-baseline-image,convert-legacy,log-torn] [--apply] [--prune] [--stale]]
```

| Flag | Meaning |
| --- | --- |
| `--component` | Only components whose folder contains this text. |
| `--status` | Only entries with these codes (comma-separated). |
| `--limit` | Rows shown per table (default 40). |
| `--offline` | Do not fetch the Storybook index; use the static scan. |
| `--ci` | Same as `--fail-on error`. |
| `--fail-on` | Lowest severity that makes the exit code 1. Default `warn`. `info` also fails on info findings (`skipped-unaffected`), never on `ok`, `excluded` or `drift`. |
| `--repair` | Plan the safe repairs. |
| `--apply` | With `--repair`: run them. |
| `--only` | With `--repair`: these actions only. `log-torn` is planned only when named: with `--apply`, a person at a terminal types `REMOVE <n> TORN LINES` and the approval-log lines a crash cut short are removed (every complete line keeps its bytes). It cannot run beside the server, which appends to that log. |
| `--prune` | With `--repair --apply`: also move orphans to `trash/`. A person at a terminal only. |
| `--stale` | With `--repair`: also re-check entries whose verdict is stale. |

| Exit | Meaning |
| --- | --- |
| 0 | No entry at or above the `--fail-on` severity (for `info`: no info finding) |
| 1 | At least one entry at or above it |
| 2 | Setup error (no manifest, broken Storybook index, unknown project, bad flag) |
| 3 | `--prune` or `--only log-torn --apply` was used where no person is at a terminal, or the store lock's holder went quiet and only a person may take it over |

The MCP tool `pxsig_doctor` and the server's `POST /__pxsig/repair` run the same repairs. Neither
can prune. `pxsig_doctor` with `repair: 'apply'` takes the store lock like the CLI (through the
server when the server holds the store) and refuses, changing nothing, while another process holds
it. `--repair --apply` needs one project and the store lock: when the server holds the
store, the CLI asks the server to run the repairs (`POST /__pxsig/repair`) and reports the result;
`--prune` then refuses, since it cannot run beside the server. Over several projects (`--all`, or
no project chosen in a multi-project workspace) the report covers each one; `--apply` refuses.

The summary's `infoFindings` counts info-severity entries other than `ok`, `excluded` and `drift`.
