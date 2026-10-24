# MCP server

`pxsig mcp` runs a Model Context Protocol server on stdio. It gives an agent the same answers as
the CLI: status, entries with their images, re-checks and integrity. It works on the workspace it
starts in (or `PXSIG_WORKSPACE`).

## Registering

From the repository root, with Claude Code:

```bash
claude mcp add pxsig -- npx pxsig mcp
```

Or in the repository's `.mcp.json`:

```json
{
  "mcpServers": {
    "pxsig": { "command": "npx", "args": ["pxsig", "mcp"] }
  }
}
```

Any MCP client that launches a stdio server works the same way. Start it from the repository root,
or set `PXSIG_WORKSPACE` in its environment.

## Where answers come from

1. Each project's `<store>/reports/check.json`, `review.json` and `history.ndjson`. Every producer
   writes them, so reading never needs the server.
2. The pxsig server, when it is running: whether a check is running, and the actions that need its
   warm browsers and engine (re-check, approve, reject).
3. Without the server, `pxsig_check` runs the full check itself for the selected entries (slower),
   and review actions are refused.

## Tools

Every tool takes an optional `project`. With several projects in the workspace it is required;
`pxsig_projects` lists them.

| Tool | Arguments | Returns |
| --- | --- | --- |
| `pxsig_projects` | none | The projects: name, folder, Storybook URL, entry count, integrity headline |
| `pxsig_status` | `project` | When the report was written, counts per state, accessibility totals, most changed components, server state, files edited since the report. Start here. |
| `pxsig_list` | `project`, `state` (`problems` default, `changed`, `new`, `error`, `flaky`, `rejected`, `approved`, `drift`, `pass`, `skipped`, `a11y`, `all`), `component`, `mode`, `limit` (50) | Entries with metrics and gate reasons |
| `pxsig_entry` | `project`, `id` (required), `images` (`baseline`, `current`, `diff`; default all three) | One entry in full, with the images inline. Images over about 1.5 MB are replaced by their path. |
| `pxsig_a11y` | `project`, `only_new`, `component`, `limit` (50) | axe violations per entry, with each entry's accessibility decision (`accepted`, `rejected` or null) since its last check |
| `pxsig_affected` | `project`, `files` or `since` | The entries those edits can change |
| `pxsig_stale` | `project`, `limit` (200), `max_files` (400) | Verdicts older than an edit that can change them, and verdicts made on a render of a different size |
| `pxsig_check` | `project`, `ids`, `stories`, `changed_files`, `since`, `all`, `timeout_s` (900) | Re-renders and re-checks the selection, waits, and returns the states and problems. A story (or entry) not in the manifest yet is registered first when Storybook is healthy: its entries come back in `registered`, NEW, with no signature, for a person to approve. A name that cannot be registered comes back in `skipped` with the reason, and `checked: 0` carries a `note`. Never writes baselines. |
| `pxsig_review` | `project`, `action` (`approve`, `reject`, `unreview`, `a11y-accept`, `a11y-reject`, `a11y-unreview`, `a11y-unaccept`), `ids`, `confirm` (all three required), `rule` (a11y-unaccept) | Visual: approves (the latest render becomes the baseline, accepting its axe violations with it), rejects, or clears the decision; clearing an approval restores the baseline it replaced. Accessibility: puts the entry's current violations on its accepted list, marks them for a fix, clears the decision (restoring the previous list), or takes a rule (default: all) off the accepted list. Needs the server, which refuses decisions that do not come from a person: the tool reports that refusal. |
| `pxsig_doctor` | `project`, `component`, `status`, `limit` (40), `repair` (`none`, `plan`, `apply`), `only`, `offline`, `stale` | The integrity ledger, filtered; with `repair`, the plan or the applied repairs (`stale: true` also re-checks stale verdicts). `apply` takes the store lock, or goes through the server that holds it; it refuses while another process holds it. Never prunes, never approves. |
| `pxsig_history` | `project`, `limit` (10) | The last runs |

## The approval guard

Approving writes a baseline. That is the owner's decision, not the agent's.

- `pxsig_review` refuses unless `confirm: true`.
- Its description tells the model to pass `confirm: true` only when the user explicitly asked, in
  the conversation, to approve or reject those exact entries, and never on its own judgement that
  a change looks intended.
- The server's instructions to the client say the same: never approve baselines unless the user
  asked.
- Every approval through MCP is logged in `approvals.ndjson` with `via: "mcp"`, and can be undone
  with `pxsig approve undo <batch>` by a person at a terminal.
- Bulk approval (`pxsig approve apply`) and `check --full --update` are refused under an agent.
- The server refuses decisions that do not carry its token (see [server.md](server.md#guards)),
  and the MCP server does not have it: `pxsig_review` reaches the server and reports its refusal
  ("approving needs a person: use the dashboard or `pxsig approve` in a terminal"), writing
  nothing. A person decides in the dashboard or with `pxsig approve` in a terminal.

A typical session: `pxsig_status`, then `pxsig_list`, then `pxsig_entry` on what changed, then
`pxsig_check` after a fix.
