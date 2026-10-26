# Approvals

A baseline changes only when a person accepts it.

- **One entry at a time:** in the dashboard or the Storybook panel, where the images are on screen.
- **Many at once:** `pxsig approve plan` (anyone, agents included) classifies each change as colour
  or shape, blocks shape changes and stale verdicts, and pins every render's hash. `pxsig approve
  apply` is then run by a person at a terminal, who types `APPROVE <n> ENTRIES`.
- **First baselines:** `pxsig approve plan --new --first-baselines`, then `apply`.

Commands that need a person (`approve apply`, `approve undo`, `approve verify --adopt`,
`check --full --update`, `doctor --repair --apply --prune`, `doctor --repair --only log-torn
--apply`) are refused (exit 3) when output is piped, in CI, or under a known agent.

The server refuses decisions an agent or a script posts: they need a token that only the
dashboard page and `pxsig approve apply` have. The MCP server can reject entries and clear
rejections, never approve.

Every approval is a line in `<store>/approvals.ndjson`: when, how (`via`: dashboard, cli, mcp),
why, the batch, the commit it was made on, and the sha256 of the baseline before and after. The
replaced baseline is kept in `<store>/history/<batch>/`. `pxsig approve log` lists batches,
`pxsig approve undo <batch>` restores one, and `pxsig approve verify` checks that every baseline
in the repository went through an approval.

This is a guard against approvals nobody meant, not authentication: the pull request that
commits the baselines is where they are reviewed.

See also: `pxsig help approve`, docs/cli.md#approvals, docs/server.md#guards.
