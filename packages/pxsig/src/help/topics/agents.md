# Coding assistants

pxsig gives assistants everything that reads or checks, and keeps approving for a person.

- **The marker.** Most assistants set a variable in the shell they run commands in (`AI_AGENT`,
  `COPILOT_AGENT`, `CLAUDECODE`, `GEMINI_CLI`, `CURSOR_AGENT`, …; the full table is in
  docs/agents.md). pxsig reads the environment only: it starts nothing and checks nothing on the
  machine. Variables an editor sets in every terminal (`TERM_PROGRAM`, `VSCODE_*`,
  `CURSOR_TRACE_ID`) are not markers. Set `PXSIG_AGENT=1` for an assistant that sets none.
- **Under a marker:** commands that need a person exit 3 and name the assistant ("refused under
  copilot (AI_AGENT=github_copilot_vscode_agent)"), output is plain Markdown, and every log line
  pxsig writes carries `agent` (the assistant's name, never a person's). `pxsig doctor` shows the
  marker this shell carries.
- **A marker is a hint, not proof.** Some assistants set none (Zed, Aider, Continue), and any
  process can set or unset one. The pull request that commits the baselines is where they are
  reviewed.
- **Tell the assistant.** Put this in its instruction file (`pxsig setup` prints it):

  ```
  pxsig (visual baselines): never approve or accept pxsig baselines and never call
  /__pxsig/approve. Ask the person to review changes in the pxsig dashboard. To build pxsig's
  dashboard on our design system, follow node_modules/pxsig/docs/ui/build-adapter.md.
  ```

- **MCP.** Start the server with the local install, `node node_modules/pxsig/bin/pxsig.mjs mcp`
  (no `npx`, no network). `pxsig setup --assistant <name> --print` prints the entry for each
  assistant. When a policy turns MCP off, the CLI gives the same answers.

See also: `pxsig help setup`, `pxsig help approvals`, docs/agents.md, docs/mcp.md.
