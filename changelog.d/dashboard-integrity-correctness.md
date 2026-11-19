### Behaviour changes

- **The dashboard's coverage block counts integrity and setup findings, by severity.** Its
  headline read "No errors. 50 components with warnings." while listing setup findings: it counted
  components with changed entries, which are the review queue's. It now counts entries with
  integrity findings and setup findings, errors then warnings ("No errors · 2 warnings",
  "1 error · 1 warning · Never checked: 1"), never changed, new or accessibility entries. The block
  shows for an error, a setup warning or a safe repair to run, and no longer for info findings
  alone (such as older approval-log lines) or for changed entries alone.
  To update: nothing to do; the review queues in the top bar still count the changed entries.

### Added

- **The server sends the dashboard's repair plan.** `GET /__pxsig/data` and the `integrity` event
  carry `repair: { entries, steps: [{ action, count }] }`: the steps the dashboard's safe repair
  would run (not blocked, not a person's), recomputed from each ledger.

### Fixed

- **"Run safe repairs" shows only when the repair would do something.** It showed for any setup
  finding, none of which a safe repair fixes, and a click answered "No issues can be repaired
  automatically." It now shows only when the server's plan has a step, as "Run safe repairs · N
  entries", including for a missing render or a legacy baseline, which never offered it. A register
  step blocked without a running Storybook, and the repairs a person runs at a terminal (a torn
  approval log, pruning orphans), never show it.
- **"View components" shows only when entries have findings** (or wait for a first approval); for
  setup findings alone, Coverage had nothing to show about them.
- **Setup findings show a title instead of their code**, for `store-conflict`, `line-endings`,
  `log-torn`, `verify-unlogged`, `reports-not-ignored`, `approvals-identity`,
  `log-legacy-personal`, `path-portability`, `dashboard-stale` and `version-required`.
- **The reference dashboard's coverage block is a named region, not `role="alert"`**, as the UI
  contract asks: a screen reader no longer reads the whole block out each time it renders.
