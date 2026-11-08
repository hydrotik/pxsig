### Behaviour changes

- **A decision's batch name is pxsig's own.** `POST /__pxsig/approve` and `/__pxsig/a11y-prune`
  keep a request's `batch` only when it has the shape pxsig makes (`<time>-<via>`, as
  `pxsig approve apply` and `pxsig a11y --prune` send, or an undo's `-undo`). Any other batch is
  replaced by the server's own name (`<time>-<via>`, `<time>-prune` for a prune), never refused,
  so a client cannot write free text into the committed `approvals.ndjson` or
  `a11y-decisions.ndjson`. Until now the server cut it to letters, digits, `_`, `.` and `-` and
  logged it.
  To update: a client that sent its own batch names reads the batch from the answer
  (`entry.batch` for an approve, `batch` for a prune); pxsig's CLI, dashboard and Storybook panel
  need nothing.
