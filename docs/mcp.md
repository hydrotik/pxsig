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

| Assistant                   | `pxsig setup --assistant` | Project file                              | Key                   |
| --------------------------- | ------------------------- | ----------------------------------------- | --------------------- |
| VS Code with GitHub Copilot | `vscode`                  | `.vscode/mcp.json`                        | `servers`             |
| GitHub Copilot CLI          | `copilot-cli`             | `.github/mcp.json`                        | `mcpServers`          |
| Claude Code                 | `claude-code`             | `.mcp.json`                               | `mcpServers`          |
| Cursor                      | `cursor`                  | `.cursor/mcp.json`                        | `mcpServers`          |
| Windsurf (Devin Desktop)    | `windsurf`                | none: the home folder's `mcp_config.json` | `mcpServers`          |
| Gemini CLI                  | `gemini-cli`              | `.gemini/settings.json`                   | `mcpServers`          |
| OpenAI Codex CLI            | `codex`                   | `.codex/config.toml`                      | `[mcp_servers.pxsig]` |
| Cline                       | `cline`                   | none: Cline's own settings file           | `mcpServers`          |
| Roo Code                    | `roo-code`                | `.roo/mcp.json`                           | `mcpServers`          |
| Continue                    | `continue`                | `.continue/mcpServers/pxsig.yaml`         | `mcpServers`          |
| Zed                         | `zed`                     | `.zed/settings.json`                      | `context_servers`     |

`pxsig setup --assistant <name> --print` prints the entry for this repository, the policy that can
turn MCP off on a managed machine, and the instruction for the assistant not to approve.
`pxsig setup` (a person at a terminal) creates the project file and the instruction file on a typed
yes, each only when it does not exist. Every recipe is in [agents.md](agents.md#recipes).

Any MCP client that launches a stdio server works the same way. Start it from the repository root,
or set `PXSIG_WORKSPACE` in its environment.

**When a policy turns MCP off,** pxsig is unaffected: the CLI gives the same answers, in plain
Markdown when an assistant runs it (`pxsig status`, `pxsig list`, `pxsig entry <id>`).

## Where answers come from

1. Each project's `<store>/reports/check.json`, `review.json` and `history.ndjson`, and the open
   rejections (`rejections.json`, `rejections.ndjson` and the packets in `rejected/`). Every
   producer writes them, so reading never needs the server.
2. The pxsig server, when it is running: whether a check is running, and the actions that need its
   warm browsers and engine (re-check, reject).
3. Without the server, `pxsig_check` runs the full check itself for the selected entries (slower),
   and review actions are refused.

## Tools

Every tool takes an optional `project`. With several projects in the workspace it is required;
`pxsig_projects` lists them.

| Tool             | Arguments                                                                                                                                                                                                                                     | Returns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pxsig_projects` | none                                                                                                                                                                                                                                          | The projects: name, folder, Storybook URL, entry count, integrity headline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `pxsig_status`   | `project`                                                                                                                                                                                                                                     | When the report was written, counts per state, accessibility totals, most changed components, server state, files edited since the report, `approvals.level`, and `env` (`current`: the environments of the last renders; `mismatched`: entries whose baseline came from another one). With warn mode in the config, `enforcement`: each gate's setting, `warnUntil` and the readiness tally; no tool can change a gate. `openRejections`: how many rejections are open, and with any, `hint` names `pxsig_rejected`. Start here.                                                                                                                                                                                                                                                                                                            |
| `pxsig_list`     | `project`, `state` (`problems` default, `changed`, `new`, `error`, `flaky`, `rejected`, `approved`, `drift`, `pass`, `skipped`, `a11y`, `all`), `text` (`copy`, `copy-reflow`, `moved`, `restyled`, `any`), `component`, `mode`, `limit` (50) | Entries with metrics and gate reasons, and their text labels: `textKind` and `textSummary`, or `textState` when text was not compared ([text labels](#text-labels)). `text` keeps one text kind (`any`: any text change); with `text` and no `state`, every state is searched. A rejected entry carries its reason (`note`); a changed entry whose rejection is still open carries `rejectedBefore: true` and the reason                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `pxsig_entry`    | `project`, `id` (required), `images` (`baseline`, `current`, `diff`, `crops`; default the first three)                                                                                                                                        | One entry in full, with the images inline. Images over about 1.5 MB are replaced by their path. Includes `env`, `baselineEnv`, `envMatch` (`same`, `compatible`, `mismatch`, `unknown`) and `envDiff` ([configuration.md](configuration.md#env)), and `renders` when React renders were counted ([spec.md](spec.md)). With text labels, `textDiff` (the check row's, in full) and `textLines` (one sentence per change) ([text labels](#text-labels)). `rejection`: the open rejection, as `pxsig_rejected` gives it, or null (`a11yRejection` when its violations were rejected); `images` with `crops` adds the crops.                                                                                                                                                                                                                     |
| `pxsig_rejected` | `project`, `ids`, `kind` (`visual`, `a11y`, `all` default), `images` (`none` default, `crops`, `full`), `closed` (false), `limit` (5)                                                                                                         | The open rejections, read before a visual fix ([rejections](#rejections)): each with its reasons, the checks since, the metrics, the changed regions and their crops, the packet folder, `prompt` and `next` (the re-check command), and `next` for all of them. Crops are file references unless `images` asks for them inline. `closed: true`: the last closed rejections, from the log, text only. Read-only; needs no server.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pxsig_a11y`     | `project`, `only_new`, `component`, `limit` (50), `prune_plan`, `mode`, `ids`                                                                                                                                                                 | axe violations per entry, with each entry's accessibility decision (`accepted`, `rejected` or null) since its last check. With `prune_plan: true`: every accepted rule as `prunable`, `still-fires`, `stale` or `not-covered`, read-only (what `pxsig a11y --prune --dry-run` prints); removing them is a person's, in a terminal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pxsig_affected` | `project`, `files` or `since`                                                                                                                                                                                                                 | The entries those edits can change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `pxsig_stale`    | `project`, `limit` (200), `max_files` (400)                                                                                                                                                                                                   | Verdicts older than an edit that can change them, and verdicts made on a render of a different size                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `pxsig_react`    | `project`, `run` (false), `since` (`main`), `limit` (100)                                                                                                                                                                                     | The React Compiler's alerts for the changed component and hook files, compared with the merge base: `summary`, `alerts` (each with its sentence), `functions` (alerts first: `change`, the outcome `before` and `now`, the rules and lines), `base` and `backend` (the compiler: `name` `babel` or `oxc`, versions, and `label` in words). Reads the last `reports/react.json`; `run: true` runs the analysis first, as `pxsig react --since <since>` does (no browser; while the server holds the store nothing is saved and `heldBy` names it). Without results, `ran: false` and why. Alerts only: nothing accepts or silences one ([cli.md](cli.md)).                                                                                                                                                                                    |
| `pxsig_check`    | `project`, `ids`, `stories`, `changed_files`, `since`, `all`, `timeout_s` (900)                                                                                                                                                               | Re-renders and re-checks the selection, waits, and returns the states and problems. A story (or entry) not in the manifest yet is registered first when Storybook is healthy: its entries come back in `registered`, NEW, with no signature, for a person to approve. A name that cannot be registered comes back in `skipped` with the reason, and `checked: 0` carries a `note`. When warn mode applies, `enforcement` (the gates, what would have failed) and `wouldFail`. With `since` or `changed_files`, `react`: the React Compiler's alerts for those files (as `pxsig_react`), or `{ skipped }` and why. Each checked entry that had an open rejection comes back in `rejections`: `closed: passes` or `open: still differs` (accessibility: `closed: no new violations` or `open: new violations remain`). Never writes baselines. |
| `pxsig_review`   | `project`, `action` (`reject`, `unreview`, `a11y-reject`, `a11y-unreview`), `ids`, `confirm` (all three required), `note`                                                                                                                     | Marks entries for attention: `reject` marks the visual change rejected, `a11y-reject` marks the axe violations for a fix, and `unreview` / `a11y-unreview` clear a rejection an assistant made. `note` (reject and a11y-reject): the reason in the person's words, one line of at most 280 characters, kept as an assistant's and never in place of a person's reason. Logged as `via: "mcp"`. There is no approve, accept or unaccept: those are a person's. Needs the server.                                                                                                                                                                                                                                                                                                                                                              |
| `pxsig_doctor`   | `project`, `component`, `status`, `limit` (40), `repair` (`none`, `plan`, `apply`), `only`, `offline`, `stale`                                                                                                                                | The integrity ledger, filtered; with `repair`, the plan or the applied repairs (`stale: true` also re-checks stale verdicts). `apply` takes the store lock, or goes through the server that holds it; it refuses while another process holds it. Never prunes, never approves.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pxsig_history`  | `project`, `limit` (10)                                                                                                                                                                                                                       | The last runs; a run under warn mode carries `wouldFail` and its gates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `pxsig_help`     | `name` (a command, `command subcommand`, topic, setting key or `global`; none: the list of names)                                                                                                                                             | pxsig's own help, the same as `pxsig help <name>`. Read-only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Rejections

A person's rejection stays open past the entry's next check, with the reason, the checks since and
a packet: full-size crops of the changed regions, `rejection.md` and `rejection.json`, in the
store's git-ignored `reports/rejected/<id>/` ([configuration.md](configuration.md#rejections)).
`pxsig_rejected` reads them, and `pxsig rejected` prints the same ([cli.md](cli.md)).

| Field         | Meaning                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `note`, `via` | The leading reason: the newest a person gave, else the newest. `from` says who gave it, in words: an assistant's reads "mcp, an assistant at the person's request" |
| `notes`       | Every reason, newest first, each with `at`, `via`, `from` and `ref` (the decision's opaque reference)                                                              |
| `state`       | The entry's state now: `changed` after a re-check that still differs, while the rejection stays open                                                               |
| `checks`      | The checks since the rejection: `at`, `pass`, and `ssim` (visual) or `new` (accessibility)                                                                         |
| `regions`     | The changed regions in full-size pixels, largest first, each with `crops` (`baseline`, `current`, `diff`), or null when too large to crop                          |
| `packet`      | The packet folder; every path is relative to the store (`store`, relative to the workspace)                                                                        |
| `prompt`      | One paragraph for the fix: the reason, the goal, where the details are and the re-check command                                                                    |
| `next`        | The re-check command; the answer's `next` names every entry shown, and says never to approve                                                                       |

Images are file references by default. `images: "crops"` returns each crop inline under a label
("`<id>` region 1 of 3, 412,88 36×16: baseline"), and `full` also the packet's `baseline.png`,
`current.png` and `mask.png`: at most 18 images per call and 1.5 MB each, the rest as paths.
Reasons are kept only while the store's `reports/` is git-ignored, so they are never committed.
pxsig sends nothing anywhere: a reason or an image reaches a model only through the MCP client
the person runs.

## Text labels

With text capture on ([configuration.md](configuration.md#text)), a check labels what changed in
the text a render draws: each check row's `textDiff` ([spec.md](spec.md#text-labels)). The tools
carry it as follows.

| Field         | Where                       | Meaning                                                                                                                                                                                                                                         |
| ------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `textKind`    | `pxsig_list`, `pxsig_entry` | `copy`, `copy-reflow`, `moved`, `restyled`, `pixel` (changed pixels outside text), or null when no text differs                                                                                                                                 |
| `textState`   | `pxsig_list`, `pxsig_entry` | Why text was not compared: `env-differs` (text is compared only within one environment; a render from this environment approved as the baseline gives labels), `no-baseline` (the baseline has no text record until its next approval), `error` |
| `textSummary` | `pxsig_list`, `pxsig_entry` | The labels in one line: `Copy, reflow: 3 copy changes, 3 runs moved. No pixels changed outside text.`                                                                                                                                           |
| `textDiff`    | `pxsig_entry`               | The row's labels in full: each change's strings (`was` / `now`, or `s`), its move in px (`dx`, `dy`), its box, `path` and stable `key`                                                                                                          |
| `textLines`   | `pxsig_entry`               | One sentence per change, then the changed pixels outside text: `Copy: "1" → "1␠" (whitespace only: a space added)`                                                                                                                              |

An agent can search the source for a changed string and compare against its box with no image
reading. Labels only: a text kind never changes an entry's state, verdict or exit code, and a copy
change is still a change for a person to approve.

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
  accepted list, overriding the person. So is one of a rejection a person made, or gave a reason
  for (403, "clearing a person's rejection needs a person: …"): the reason would go with it. A
  reject on an entry a person rejected keeps the person's decision and reason.
- `a11y-unaccept` is a person's too, although it makes the report stricter: it edits the accepted
  list a person set.
- `pxsig_review` refuses unless `confirm: true`, and its description tells the model to pass it
  only when the user explicitly asked for this action on these exact entries.
- Bulk approval (`pxsig approve apply`) and `check --full --update` are refused under an
  assistant's marker, with a message naming it ([agents.md](agents.md#markers)).
- The server's instructions to the model say so: "Approving and accepting are the person's: never
  approve, never accept, and never call `/__pxsig/approve`; ask the person to review in the
  dashboard." They also say: "Before a visual fix, read pxsig_rejected: the reviewer's reason
  and the changed regions at full size; after the fix, re-check those ids with pxsig_check."
- No MCP result carries the dashboard link, a ticket or a token.

A typical session: `pxsig_status`, then `pxsig_list`, then `pxsig_entry` on what changed, then
`pxsig_check` after a fix. With open rejections: `pxsig_rejected` before the fix, and
`pxsig_check` with those `ids` after it ([agents.md](agents.md#fixing-a-rejection)).
