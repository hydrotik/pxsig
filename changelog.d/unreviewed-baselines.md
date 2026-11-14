### Added

- **Unreviewed baselines.** A baseline no person approved (written by `pxsig migrate`,
  `approve verify --adopt`, `check --update`, an assistant, or outside pxsig) is flagged, told from
  `approvals.ndjson`: reviewed means a person's line (the dashboard or the CLI, no assistant
  marker, not an undo) logged exactly the bytes it holds now. The ledger carries `unreviewed` on
  each such entry and `summary.unreviewed` (count, review queue, new, the next ids); `pxsig status`,
  `pxsig doctor` and the MCP `pxsig_status` show them, and the Coverage view has an "Unreviewed"
  tile that lists them in queue order. The queue (baselines written before 0.7.7, or never logged)
  only shrinks; one written without review from 0.7.7 on is named in a `unreviewed-new` setup
  warning. Nothing fails on either. `approvals.reviewOrder` may name a JSON file ordering the
  queue (`first`: components first; `usage`: then the most used).
