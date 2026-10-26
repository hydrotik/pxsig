# Approvals

A baseline changes only when a person accepts it.

- **One entry at a time:** in the dashboard or the Storybook panel, where the images are on screen.
- **Many at once:** `pxsig approve plan` (anyone, agents included) classifies each change as colour
  or shape, blocks shape changes and stale verdicts, and pins every render's hash. `pxsig approve
  apply` is then run by a person at a terminal, who types `APPROVE <n> ENTRIES`.
- **First baselines:** `pxsig approve plan --new --first-baselines`, then `apply`.

Commands that need a person (`approve apply`, `approve undo`, `approve verify --adopt`,
`check --full --update`, `doctor --repair --apply --prune`, `doctor --repair --only log-torn
--apply`, `serve --link`) are refused (exit 3) when output is piped, in CI, or under an assistant's
marker; the message says which (`pxsig help agents`).

The server refuses decisions an agent or a script posts: they need the dashboard link (a one-time
link `pxsig serve` prints for a person at a terminal; `pxsig serve --link` prints a new one) or the
token `pxsig approve apply` reads. No token is in any page. In the Storybook panel a decision opens
a small window of the server for a moment. The MCP server can reject entries and clear
rejections, never approve.

Every approval is a line in `<store>/approvals.ndjson`: when, how (`via`: dashboard, cli, mcp),
why, the batch, the commit it was made on, and the sha256 of the baseline before and after. The
replaced baseline is kept in `<store>/history/<batch>/`. `pxsig approve log` lists batches
(`--trace` adds the commit and pull request each came in by, and no names), `pxsig approve undo
<batch>` restores one, and `pxsig approve verify` checks that every baseline in the repository
went through an approval: a baseline with no log line fails unless `--no-strict`, and `--since
<ref>` also fails a log that was rewritten rather than appended to.

This is a guard against approvals nobody meant, not authentication: the pull request that
commits the baselines is where they are reviewed.

Every log line records how the decision was made (`via`) and the pxsig that wrote it, and no
personal data: the commit that adds a line and the pull request say who approved
(`approvals.identity: "git-email"` adds the git email to each line).

See also: `pxsig help approve`, docs/cli.md#approvals, docs/server.md#guards.
