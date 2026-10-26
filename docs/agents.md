# Coding assistants

pxsig gives a coding assistant everything that reads or checks: status, entries with their images,
re-checks, integrity, help. Approving and accepting baselines stay with a person. This page covers
how pxsig recognises an assistant, what changes when it does, the instruction that tells an
assistant not to approve, and the MCP entry for each assistant.

The aim is traceability and fewer approvals nobody meant (by a person by mistake, a script, or an
assistant acting on its own). It is not authentication: pxsig has no accounts and asks nobody to
sign in. The pull request that commits the baselines is where they are reviewed.

## Markers

Most assistants set an environment variable in the shell they run commands in. pxsig reads the
environment and nothing else: it starts no program and inspects nothing on the machine to find out
(`src/lib/agents.mjs`, with each row's source). The first row that matches names the assistant.

| Variable | Name pxsig reports |
| --- | --- |
| `PXSIG_AGENT` (any value) | the value, or `agent` for `1` or `true` |
| `AI_AGENT` (the cross-vendor variable: VS Code agent mode, Claude Code, opencode) | `copilot` for `github_copilot_…`, `claude-code` for `claude-code_…`, else the value |
| `COPILOT_AGENT`, `COPILOT_CLI`, `COPILOT_AGENT_SESSION_ID` | `copilot` |
| `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_CHILD_SESSION` | `claude-code` |
| `CODEX_THREAD_ID`, `CODEX_CI`, `CODEX_SANDBOX`, `CODEX_SANDBOX_NETWORK_DISABLED` | `codex` |
| `GEMINI_CLI` | `gemini-cli` |
| `CURSOR_AGENT`, `CURSOR_SANDBOX` | `cursor` |
| `CLINE_ACTIVE` (Cline's VS Code terminal mode) | `cline` |
| `ROO_ACTIVE` (Roo Code's VS Code terminal mode) | `roo-code` |
| `AGENT=amp`, `AMP_CURRENT_THREAD_ID` | `amp` |
| `OPENCODE` | `opencode` |

Not markers, because an editor sets them in a person's own terminals too: `TERM_PROGRAM`,
`VSCODE_INJECTION` and the other `VSCODE_*` variables, `GIT_ASKPASS`, `ZED_TERM`,
`CURSOR_TRACE_ID`. `CLAUDECODE` is also set in the Claude Code IDE extensions' integrated
terminals, so a person there is treated as the assistant: use another terminal for the commands
that need a person.

**A marker is a hint, not proof.** Zed, Aider and Continue set none, Windsurf documents none, and
any process can set or unset a variable. For an assistant without a marker, set `PXSIG_AGENT=1` in
the shell it uses.

### What a marker changes

- **Commands that need a person are refused** (exit 3), with the reason: `approve apply needs a
  person at a terminal: refused under copilot (AI_AGENT=github_copilot_vscode_agent)`. These are
  `approve apply`, `approve undo`, `approve verify --adopt`, `check --full --update`, `doctor
  --repair --apply --prune`, `doctor --repair --only log-torn --apply` and `serve --link`
  ([cli.md](cli.md#commands-that-need-a-person)). A real terminal does not change this: several
  assistants run commands in one.
- **Output is plain Markdown**, even in a real terminal ([cli.md](cli.md#output-formats)).
- **Log lines name the assistant.** Every approval, repair and accessibility-decision line pxsig
  writes under a marker carries `agent` (the name above: never a person's name, account or email).
  A `pxsig serve` started under a marker records it on every decision it serves, the dashboard's
  included.
- **`pxsig doctor`** shows `Running under: copilot (AI_AGENT=github_copilot_vscode_agent)`, or
  `no agent marker`.
- **`pxsig serve`** does not print the dashboard link; a person runs `pxsig serve --link` in their
  own terminal ([server.md](server.md#guards)).

Everything else works as without a marker: reads, checks, repairs, `approve plan`, the MCP tools.

## Approval levels

`approvals.level` in `pxsig.config.json` is `standard`, the default and the only level in this
version. It is the markers above, the dashboard link ([server.md](server.md#guards)), the MCP
server that cannot approve ([mcp.md](mcp.md#the-approval-guard)), and the approval log with its
review in the pull request. A stricter level is planned for a later release, opt-in.

## The instruction

Put this in the assistant's instruction file (`pxsig setup` prints it, and offers to create the
file when there is none):

```
pxsig (visual baselines): never approve or accept pxsig baselines and never call
/__pxsig/approve. Ask the person to review changes in the pxsig dashboard. To build pxsig's
dashboard on our design system, follow node_modules/pxsig/docs/ui/build-adapter.md.
```

## Recipes

Every recipe starts the MCP server with the local install,
`node <repo>/node_modules/pxsig/bin/pxsig.mjs mcp`:

- no `npx`, which fetches from the registry when pxsig is not installed;
- no Windows `.cmd` shim, which a client that starts programs without a shell cannot run;
- no network: `bin/pxsig.mjs` hands over to the workspace's own install.

`pxsig setup --assistant <name> --print` prints the recipe for this repository, with `<repo>`
filled in. `pxsig setup` (a person at a terminal) creates the project files below on a typed yes,
only when they do not exist. A settings file in the home folder is printed only.

When a policy turns MCP off, pxsig is unaffected: the CLI gives the same answers in plain Markdown
(`pxsig status`, `pxsig list`, `pxsig entry <id>`).

### VS Code with GitHub Copilot (`--assistant vscode`)

Project file: `.vscode/mcp.json`.

```json
{
  "servers": {
    "pxsig": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${workspaceFolder}/node_modules/pxsig/bin/pxsig.mjs",
        "mcp"
      ],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

Instruction file: `.github/copilot-instructions.md`. Managed machines: VS Code policies ChatMCP
(chat.mcp.access), ChatAgentMode, ChatAllowedMcpServers / ChatDeniedMcpServers; the GitHub "MCP
servers in Copilot" policy and the MCP registry allowlist. The server starts once the workspace is
trusted. Optional, in VS Code settings (printed, never set): "workbench.browser.enableChatTools":
false, and "chat.agent.deniedNetworkDomains" with "localhost" and "127.0.0.1", keep Copilot's
browser tools off the dashboard.

### GitHub Copilot CLI (`--assistant copilot-cli`)

Project file: `.github/mcp.json`.

```json
{
  "mcpServers": {
    "pxsig": {
      "type": "local",
      "command": "node",
      "args": [
        "node_modules/pxsig/bin/pxsig.mjs",
        "mcp"
      ],
      "tools": [
        "*"
      ]
    }
  }
}
```

Instruction file: `.github/copilot-instructions.md`. Managed machines: The MCP registry allowlist
(Copilot CLI 1.0.11 and later). Copilot CLI does not read .vscode/mcp.json. It loads the server
after the folder is trusted.

### Claude Code (`--assistant claude-code`)

Project file: `.mcp.json`.

```json
{
  "mcpServers": {
    "pxsig": {
      "command": "node",
      "args": [
        "node_modules/pxsig/bin/pxsig.mjs",
        "mcp"
      ]
    }
  }
}
```

Instruction file: `CLAUDE.md`. Managed machines: managed-mcp.json and allowedMcpServers. Claude Code
asks before it uses a project's servers.

### Cursor (`--assistant cursor`)

Project file: `.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "pxsig": {
      "command": "node",
      "args": [
        "${workspaceFolder}/node_modules/pxsig/bin/pxsig.mjs",
        "mcp"
      ]
    }
  }
}
```

Instruction file: `AGENTS.md`. Managed machines: The Cursor enterprise MCP allowlist. Cursor asks
before a tool is used.

### Windsurf (Devin Desktop) (`--assistant windsurf`)

Settings: `~/.config/devin/mcp_config.json (Windows: %APPDATA%\devin\mcp_config.json)` (printed
only).

```json
{
  "mcpServers": {
    "pxsig": {
      "command": "node",
      "args": [
        "<repo>/node_modules/pxsig/bin/pxsig.mjs",
        "mcp"
      ]
    }
  }
}
```

Instruction file: `AGENTS.md`. Managed machines: The team admin MCP toggle and allowlist. This file
is in the home folder: add the entry by hand. It takes an absolute path.

### Gemini CLI (`--assistant gemini-cli`)

Project file: `.gemini/settings.json`.

```json
{
  "mcpServers": {
    "pxsig": {
      "command": "node",
      "args": [
        "node_modules/pxsig/bin/pxsig.mjs",
        "mcp"
      ],
      "cwd": "."
    }
  }
}
```

Instruction file: `GEMINI.md`. Managed machines: The system settings file. Gemini CLI connects only
in a trusted folder.

### OpenAI Codex CLI (`--assistant codex`)

Project file: `.codex/config.toml`.

```toml
[mcp_servers.pxsig]
command = "node"
args = ["node_modules/pxsig/bin/pxsig.mjs", "mcp"]
cwd = "<repo>"
```

Instruction file: `AGENTS.md`. Managed machines: Codex enterprise requirements. Codex reads a
project's .codex/config.toml only in a trusted project. cwd is absolute.

### Cline (`--assistant cline`)

Settings: `cline_mcp_settings.json (Cline: MCP Servers → Configure)` (printed only).

```json
{
  "mcpServers": {
    "pxsig": {
      "command": "node",
      "args": [
        "<repo>/node_modules/pxsig/bin/pxsig.mjs",
        "mcp"
      ]
    }
  }
}
```

Instruction file: `.clinerules/pxsig.md`. Cline keeps its servers in its own settings file: add the
entry there by hand.

### Roo Code (`--assistant roo-code`)

Project file: `.roo/mcp.json`.

```json
{
  "mcpServers": {
    "pxsig": {
      "command": "node",
      "args": [
        "node_modules/pxsig/bin/pxsig.mjs",
        "mcp"
      ]
    }
  }
}
```

Instruction file: `.roo/rules/pxsig.md`.

### Continue (`--assistant continue`)

Project file: `.continue/mcpServers/pxsig.yaml`.

```yaml
name: pxsig
version: 0.0.1
schema: v1
mcpServers:
  - name: pxsig
    command: node
    args:
      - node_modules/pxsig/bin/pxsig.mjs
      - mcp
```

Instruction file: `.continue/rules/pxsig.md`.

### Zed (`--assistant zed`)

Project file: `.zed/settings.json`.

```json
{
  "context_servers": {
    "pxsig": {
      "command": "node",
      "args": [
        "node_modules/pxsig/bin/pxsig.mjs",
        "mcp"
      ]
    }
  }
}
```

Instruction file: `AGENTS.md`. Zed's agent sets no marker in the terminal it runs commands in: pxsig
cannot tell it from a person there.

### Aider (`--assistant aider`)

Instruction file: `CONVENTIONS.md`. Aider has no MCP: it can run `pxsig status --plain` and the
other read commands. Load the conventions file with `aider --read CONVENTIONS.md`. Aider sets no
marker in the terminal it runs commands in: pxsig cannot tell it from a person there.

### Another assistant (`--assistant other`)

Settings: the assistant's own MCP settings (printed only).

```
node node_modules/pxsig/bin/pxsig.mjs mcp   (started in the repository root)
```

Instruction file: `AGENTS.md`. Any MCP client that starts a stdio server works. Without a marker of
its own, set PXSIG_AGENT=1 in the shell it runs commands in.
