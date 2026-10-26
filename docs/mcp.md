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
   warm browsers and engine (re-check, reject).
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
| `pxsig_review` | `project`, `action` (`reject`, `unreview`, `a11y-reject`, `a11y-unreview`), `ids`, `confirm` (all three required) | Marks entries for attention: `reject` marks the visual change rejected, `a11y-reject` marks the axe violations for a fix, and `unreview` / `a11y-unreview` clear a rejection. Logged as `via: "mcp"`. There is no approve, accept or unaccept: those are a person's. Needs the server. |
| `pxsig_doctor` | `project`, `component`, `status`, `limit` (40), `repair` (`none`, `plan`, `apply`), `only`, `offline`, `stale` | The integrity ledger, filtered; with `repair`, the plan or the applied repairs (`stale: true` also re-checks stale verdicts). `apply` takes the store lock, or goes through the server that holds it; it refuses while another process holds it. Never prunes, never approves. |
| `pxsig_history` | `project`, `limit` (10) | The last runs |

## The approval guard

Approving writes a baseline. That is the owner's decision, not the agent's, so the MCP server
cannot approve at all.

- `pxsig_review` has no `approve`, `a11y-accept` or `a11y-unaccept`. It can mark entries rejected
  and clear a rejection: a rejection only asks for attention, and never writes a baseline or an
  accepted list.
- The server enforces this, not only the tool. The MCP server sends the server's MCP token
  (`serve-<port>.mcp.token` beside the CLI's, see [server.md](server.md#guards)), which the
  server accepts on `reject`, `unreview`, `a11y-reject` and `a11y-unreview` only, logged as
  `via: "mcp"`. An `unreview` or `a11y-unreview` of a person's approval or accept is refused
  (403, "clearing an approval needs a person: …"): clearing one would restore the old baseline or
  accepted list, overriding the person.
- `a11y-unaccept` is a person's too, although it makes the report stricter: it edits the accepted
  list a person set.
- `pxsig_review` refuses unless `confirm: true`, and its description tells the model to pass it
  only when the user explicitly asked for this action on these exact entries.
- Bulk approval (`pxsig approve apply`) and `check --full --update` are refused under an agent.

A typical session: `pxsig_status`, then `pxsig_list`, then `pxsig_entry` on what changed, then
`pxsig_check` after a fix.
