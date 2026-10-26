# MCP server

`pxsig mcp` runs a Model Context Protocol server on stdio. It gives an agent the same answers as
the CLI: status, entries with their images, re-checks and integrity. It works on the workspace it
starts in (or `PXSIG_WORKSPACE`).

## Registering

Start the server with the local install, from the repository root:

```bash
node node_modules/pxsig/bin/pxsig.mjs mcp
```

No `npx` (it fetches from the registry when pxsig is not installed), no Windows `.cmd` shim (a
client that starts programs without a shell cannot run one), no network. `npx pxsig mcp` keeps
working.

Each assistant keeps the entry in its own file. With Claude Code, in the repository's `.mcp.json`:

```json
{
  "mcpServers": {
    "pxsig": { "command": "node", "args": ["node_modules/pxsig/bin/pxsig.mjs", "mcp"] }
  }
}
```

| Assistant | `pxsig setup --assistant` | Project file | Key |
| --- | --- | --- | --- |
| VS Code with GitHub Copilot | `vscode` | `.vscode/mcp.json` | `servers` |
| GitHub Copilot CLI | `copilot-cli` | `.github/mcp.json` | `mcpServers` |
| Claude Code | `claude-code` | `.mcp.json` | `mcpServers` |
| Cursor | `cursor` | `.cursor/mcp.json` | `mcpServers` |
| Windsurf (Devin Desktop) | `windsurf` | none: the home folder's `mcp_config.json` | `mcpServers` |
| Gemini CLI | `gemini-cli` | `.gemini/settings.json` | `mcpServers` |
| OpenAI Codex CLI | `codex` | `.codex/config.toml` | `[mcp_servers.pxsig]` |
| Cline | `cline` | none: Cline's own settings file | `mcpServers` |
| Roo Code | `roo-code` | `.roo/mcp.json` | `mcpServers` |
| Continue | `continue` | `.continue/mcpServers/pxsig.yaml` | `mcpServers` |
| Zed | `zed` | `.zed/settings.json` | `context_servers` |

`pxsig setup --assistant <name> --print` prints the entry for this repository, the policy that can
turn MCP off on a managed machine, and the instruction for the assistant not to approve.
`pxsig setup` (a person at a terminal) creates the project file and the instruction file on a typed
yes, each only when it does not exist. Every recipe is in [agents.md](agents.md#recipes).

Any MCP client that launches a stdio server works the same way. Start it from the repository root,
or set `PXSIG_WORKSPACE` in its environment.

**When a policy turns MCP off,** pxsig is unaffected: the CLI gives the same answers, in plain
Markdown when an assistant runs it (`pxsig status`, `pxsig list`, `pxsig entry <id>`).

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
| `pxsig_status` | `project` | When the report was written, counts per state, accessibility totals, most changed components, server state, files edited since the report, and `approvals.level`. Start here. |
| `pxsig_list` | `project`, `state` (`problems` default, `changed`, `new`, `error`, `flaky`, `rejected`, `approved`, `drift`, `pass`, `skipped`, `a11y`, `all`), `component`, `mode`, `limit` (50) | Entries with metrics and gate reasons |
| `pxsig_entry` | `project`, `id` (required), `images` (`baseline`, `current`, `diff`; default all three) | One entry in full, with the images inline. Images over about 1.5 MB are replaced by their path. |
| `pxsig_a11y` | `project`, `only_new`, `component`, `limit` (50), `prune_plan`, `mode`, `ids` | axe violations per entry, with each entry's accessibility decision (`accepted`, `rejected` or null) since its last check. With `prune_plan: true`: every accepted rule as `prunable`, `still-fires`, `stale` or `not-covered`, read-only (what `pxsig a11y --prune --dry-run` prints); removing them is a person's, in a terminal |
| `pxsig_affected` | `project`, `files` or `since` | The entries those edits can change |
| `pxsig_stale` | `project`, `limit` (200), `max_files` (400) | Verdicts older than an edit that can change them, and verdicts made on a render of a different size |
| `pxsig_check` | `project`, `ids`, `stories`, `changed_files`, `since`, `all`, `timeout_s` (900) | Re-renders and re-checks the selection, waits, and returns the states and problems. A story (or entry) not in the manifest yet is registered first when Storybook is healthy: its entries come back in `registered`, NEW, with no signature, for a person to approve. A name that cannot be registered comes back in `skipped` with the reason, and `checked: 0` carries a `note`. Never writes baselines. |
| `pxsig_review` | `project`, `action` (`reject`, `unreview`, `a11y-reject`, `a11y-unreview`), `ids`, `confirm` (all three required) | Marks entries for attention: `reject` marks the visual change rejected, `a11y-reject` marks the axe violations for a fix, and `unreview` / `a11y-unreview` clear a rejection. Logged as `via: "mcp"`. There is no approve, accept or unaccept: those are a person's. Needs the server. |
| `pxsig_doctor` | `project`, `component`, `status`, `limit` (40), `repair` (`none`, `plan`, `apply`), `only`, `offline`, `stale` | The integrity ledger, filtered; with `repair`, the plan or the applied repairs (`stale: true` also re-checks stale verdicts). `apply` takes the store lock, or goes through the server that holds it; it refuses while another process holds it. Never prunes, never approves. |
| `pxsig_history` | `project`, `limit` (10) | The last runs |
| `pxsig_help` | `name` (a command, `command subcommand`, topic, setting key or `global`; none: the list of names) | pxsig's own help, the same as `pxsig help <name>`. Read-only. |

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
- Bulk approval (`pxsig approve apply`) and `check --full --update` are refused under an
  assistant's marker, with a message naming it ([agents.md](agents.md#markers)).
- The server's instructions to the model say so: "Approving and accepting are the person's: never
  approve, never accept, and never call `/__pxsig/approve`; ask the person to review in the
  dashboard."
- No MCP result carries the dashboard link, a ticket or a token.

A typical session: `pxsig_status`, then `pxsig_list`, then `pxsig_entry` on what changed, then
`pxsig_check` after a fix.
