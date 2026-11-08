### Breaking changes

- **`approvals.identity` is no longer read.** No approval, accessibility or repair log line, approval
  plan or integrity entry carries a `by`, whatever the key says: pxsig no longer reads the git
  email or `$USER` for any of them. A config that still has the key loads as before (any value),
  and `pxsig doctor` reports it (below). Lines written before 0.7.6 keep their `by`; nothing
  rewrites them, and `approve verify --since` passes on a log with both.
  To update: remove `approvals.identity` from pxsig.config.json; who approved is the commit's author
  and the pull request's reviewer (`pxsig approve log --trace`).

### Behaviour changes

- **`approve log` has no "By" column; `--json` rows have no `by`.** The table is When, Via,
  Entries, Reason, Batch, and `--trace` adds Commit and PR. A `by` on a line written before 0.7.6
  is never shown. `pxsig migrate` writes no `by` on its lines and drops `by`
  from the trail it copies.
  To update: a script that read `by` from `approve log --json` uses `--trace` for the commit and
  pull request.
- **The integrity entry's `approval` is `{ at, via, batch }`.** In `reports/integrity.json`,
  `/__pxsig/integrity` and `pxsig doctor --json`; it no longer has `by`.
  To update: use `pxsig approve log --trace` for who approved.
- **`approval-plan.json` and `repairs.ndjson` have no `by`.** Both are in the store's git-ignored
  `reports/`.
  To update: nothing to do; both are local.
- **Doctor gains the setup findings `approvals-identity` and `log-legacy-personal`.**
  `approvals-identity` (warn for `git-email`, info for `none` or any other value) while the config
  still sets the key; `log-legacy-personal` (info, with a count) while `approvals.ndjson` or
  `a11y-decisions.ndjson` has lines from before 0.7.6 that carry a person's reason or a `by` (a
  reason pxsig wrote itself, such as an undo's or `check --update`'s default, is not counted).
  Shown by `pxsig doctor`, `pxsig_doctor` and Diagnostics. Like every setup warning they do not
  change `doctor`'s exit code, `--fail-on` included; `integrity.severity` can change either
  severity (`error` makes `doctor` exit 2).
  To update: remove `approvals.identity` from pxsig.config.json, or set `integrity.severity` for
  the code; old lines stay (the log is append-only, and git history keeps them either way).
