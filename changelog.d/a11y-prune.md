### Added

- **`pxsig a11y --prune`**: accepted axe rules that no longer fire, taken off `a11y.json`. Each
  accepted rule is listed as `prunable` (a row checked after the entry's last accessibility
  decision and last approval, not stale, where axe ran and the rule did not fire), `still-fires`,
  `stale` or `not-covered`, with the command that would decide the rest. `--dry-run` writes
  nothing, is anyone's (assistants included) and exits 0. Without it, a person at a terminal types
  `PRUNE <n> RULES`; only the prunable rules are removed, each entry's removal is a line in
  `a11y-decisions.ndjson` (`action: "prune"`, `via: "cli"`, the batch, the reason and the row it
  relied on), and a decision made in between refuses the whole prune (exit 1). Through `pxsig
  serve` when it holds the store (new route `POST /__pxsig/a11y-prune`, the CLI's token only), so
  the dashboard updates; otherwise under the store lock. Refused (exit 3) when piped, in CI or
  under an assistant's marker. Filters: `--component`, `--mode`, `--only`; `--reason`.
- **`pxsig_a11y { prune_plan: true }`** (MCP): the same list, read-only. No tool removes rules.

No behaviour change: a new flag, a new server route and a new log action. After a prune the
Accessibility view's accepted counts are lower.
