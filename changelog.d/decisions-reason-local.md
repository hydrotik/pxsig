### Breaking changes

- **New approval log lines carry no `reason`.** `approvals.ndjson` is committed; a reason given
  with an approval (`approve plan --reason`, `check --update --reason`, a `reason` sent to
  `/__pxsig/approve` or `/approve-story`) now stays on the machine, beside the line's `ref`
  (below). `check --update` without `--reason` and `approve verify --adopt` no longer write a
  fixed text: `via` (`check-update`, `adopt`) says how. Lines written before 0.7.6 keep their
  `reason`; nothing rewrites them, and `approve verify --since` passes on a log with both.
  To update: a tool that read `reason` from approvals.ndjson reads it from
  `pxsig approve log --json` (`reason`) on the machine where the decision was made, or keeps its
  own record keyed by the line's `ref`.
- **New accessibility log lines carry no `reason`.** An `a11y-accept` reason and the
  `pxsig a11y --prune --reason` text leave `a11y-decisions.ndjson` for the local file.
  To update: read the reason from `<store>/reports/decisions.ndjson` (`log: "a11y"`, by `ref`) on
  the machine where the decision was made.
- **Undo lines carry `undo: { in, from }` instead of the reason text.** `in` is `terminal`
  (`pxsig approve undo`) or `dashboard` (`unreview`); `from` is `snapshot` or `git`. The PR
  summary's count by route reads the field (and an old line's "(dashboard)" reason).
  To update: a tool that parsed "undo <batch>" from `reason` reads the undone batch from `batch`
  (`<batch>-undo`) and `undo.from` for snapshot or git.
- **`pxsig migrate` lines carry no old path; the trail it copies loses `reason`.** Each migrated
  baseline's line has a `ref` and the pxsig version, and no "moved from <old path>" reason; each
  copied line gains a `ref`, and its reason is kept beside it in the new store's
  `reports/decisions.ndjson`.
  To update: nothing to do; the old paths are in the migration's commit.

### Behaviour changes

- **A reason is kept in `<store>/reports/decisions.ndjson`, only when `reports/` is git-ignored;
  otherwise the CLI says it was not kept.** One line per decision reference:
  `{ at, ref, log, id, batch, via, reason, pxsig }`, no name, host or path. pxsig asks
  `git check-ignore` only when a reason is given (never for a dashboard approval, and the server
  never blocks on it); outside a repository the reason is kept. When `reports/` is not ignored,
  `approve apply`, `check --update` and `a11y --prune` print
  `Reason not kept: <store>/reports/ is not git-ignored. pxsig doctor shows the fix.` once, the
  decision goes through and exit codes are unchanged; `approve plan` writes no reason into
  `approval-plan.json` and shows `Reason: not kept (reports/ is not git-ignored)`.
  To update: nothing to do when the store's reports/ is git-ignored (every store pxsig init made);
  otherwise add `reports/` to the store's .gitignore.
- **`approve log` reads a batch's reason from the local file.** By any of the batch's refs in
  `reports/decisions.ndjson`, else the reason a line written before 0.7.6 carries, else none; a
  clean clone, or a local file that is missing or broken, shows no reasons and exits 0.
  To update: nothing to do; reasons show only on the machine where they were given.
- **`pxsig snapshot` always gives `reason: null`; the Storybook addon panel has no "Reason"
  column.** The snapshot is published with `storybook build`; it never reads the local file, and
  shows no reason from older lines either. The key stays (snapshot version 1).
  To update: nothing to do; the reason for a baseline change is in the pull request that
  committed it.
- **Doctor gains the setup finding `reports-not-ignored` (warn).** Shown by `pxsig doctor`,
  `pxsig_doctor` and Diagnostics while git would pick up the store's `reports/`. Like every setup
  warning it does not change `doctor`'s exit code; `integrity.severity` can change its severity
  (`error` makes `doctor` exit 2).
  To update: add `reports/` to the store's .gitignore, or set `integrity.severity` for the code.
- **An approve or prune reason is stored as one line.** Control characters, line breaks and
  bidirectional overrides become spaces, as a rejection note's do; the limit stays 500 characters.
  To update: nothing to do.
