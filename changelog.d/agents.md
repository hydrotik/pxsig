### Behaviour changes

- **More coding assistants are recognised, in a real terminal too.** pxsig read five variables
  (Claude Code's and Codex's sandbox ones, and `PXSIG_AGENT`). It now reads the marker each
  assistant sets in the shell it runs commands in: `AI_AGENT` (VS Code agent mode, Claude Code,
  opencode), Copilot's, Claude Code's, Codex's, Gemini CLI's, Cursor's, Cline's, Roo Code's, Amp's
  and opencode's (docs/agents.md#markers). Under any of them the commands that need a person
  (`approve apply`, `approve undo`, `approve verify --adopt`, `check --full --update`, `doctor
  --repair --apply --prune`, `doctor --repair --only log-torn --apply`, `serve --link`) exit 3,
  and output is plain Markdown. Before, Copilot agent mode, Gemini CLI, Cursor, Cline and Roo
  Code ran them when they had a terminal. A person whose terminal sets one of these (the Claude
  Code IDE extensions' integrated terminal sets `CLAUDECODE`) runs those commands in another
  terminal. Editor variables (`TERM_PROGRAM`, `VSCODE_*`, `CURSOR_TRACE_ID`) are not markers.
- **Refusals say why.** Exit 3 is unchanged; the message now names the reason: "refused under
  copilot (AI_AGENT=github_copilot_vscode_agent)", "refused in CI (CI is set)" or "refused: output
  is piped".
- **Log lines written under a marker carry `agent`** (the assistant's name, never a person's).
  A `pxsig serve` started under a marker records it on every decision it serves, the dashboard's
  included. Additive; `approve verify` reads lines with and without it.

### Added

- **`pxsig setup`**: the coding assistant's recipe. It prints the MCP entry, which starts the
  server with the local install (`node node_modules/pxsig/bin/pxsig.mjs mcp`, no `npx`), the policy
  that can turn MCP off on a managed machine, and the instruction for the assistant not to
  approve. A person at a terminal is asked which assistant is used and may create the
  repository's MCP file and instruction file, each on a typed yes and only when it does not exist;
  an existing file is never edited. `--assistant <name>` and `--print` (writes nothing; always so
  in CI, piped and under an assistant).
- **`pxsig doctor` shows the assistant marker** this shell carries ("Running under"), and its JSON
  has `agent`.
- **`pxsig_status` has `approvals.level`**, and the MCP server's instructions tell the model
  never to approve or accept and to ask the person to review in the dashboard.
- **`pxsig help agents`**.

### Documentation

- **docs/agents.md**: the markers, what they change, the approval level, the instruction for the
  assistant, and the MCP recipe for each assistant. **docs/mcp.md** registers the server with the
  local `node` command (`npx pxsig mcp` keeps working). SECURITY.md: a marker is a hint, not
  proof; the reviewed pull request is the guarantee.
