/**
 * assistants.mjs — how each coding assistant starts pxsig's MCP server, and the sentence that tells
 * it not to approve. One table for `pxsig setup`, `docs/agents.md` and the tests.
 *
 * Every recipe starts the server with `node <repo>/node_modules/pxsig/bin/pxsig.mjs mcp` (decision
 * 9.7): no `npx` (it fetches from the registry when pxsig is not installed), no Windows `.cmd` shim
 * (a spawn without a shell fails on one), no network. A path is relative to the repository when the
 * client starts the server there, else `<repo>` is the repository's absolute path.
 *
 * Files: `project` files are in the repository, and `pxsig setup` may create one when it does not
 * exist; `user` files are in the person's home folder, and pxsig only prints them (decision 9.6).
 */

/** The instruction for the assistant (decision 80), word for word in the docs and `pxsig help agents`. */
export const SNIPPET = `pxsig (visual baselines): never approve or accept pxsig baselines and never call
/__pxsig/approve. Ask the person to review changes in the pxsig dashboard. To build pxsig's
dashboard on our design system, follow node_modules/pxsig/docs/ui/build-adapter.md.
`;

/** The script every recipe runs, relative to the repository. */
export const SCRIPT = 'node_modules/pxsig/bin/pxsig.mjs';

const json = (v) => JSON.stringify(v, null, 2) + '\n';
const abs = (repo) => `${repo.replace(/\\/g, '/').replace(/\/$/, '')}/${SCRIPT}`;
const instruction = (file) => ({ file, text: `${SNIPPET}` });

/**
 * `id`: the name `--assistant` takes. `mcp(repo)`: `{ file, scope, lang, text }` or null (no MCP).
 * `instructions`: the file the snippet goes in. `policy`: what can turn the server off on a managed
 * machine. `notes`: printed after the recipe.
 */
export const ASSISTANTS = [
  {
    id: 'vscode',
    label: 'VS Code with GitHub Copilot',
    mcp: () => ({
      file: '.vscode/mcp.json',
      scope: 'project',
      lang: 'json',
      text: json({
        servers: {
          pxsig: {
            type: 'stdio',
            command: 'node',
            args: ['${workspaceFolder}/' + SCRIPT, 'mcp'],
            cwd: '${workspaceFolder}',
          },
        },
      }),
    }),
    instructions: instruction('.github/copilot-instructions.md'),
    policy:
      'VS Code policies ChatMCP (chat.mcp.access), ChatAgentMode, ChatAllowedMcpServers / ChatDeniedMcpServers; the GitHub "MCP servers in Copilot" policy and the MCP registry allowlist.',
    notes: [
      'The server starts once the workspace is trusted.',
      'Optional, in VS Code settings (printed, never set): "workbench.browser.enableChatTools": false, and "chat.agent.deniedNetworkDomains" with "localhost" and "127.0.0.1", keep Copilot\'s browser tools off the dashboard.',
    ],
  },
  {
    id: 'copilot-cli',
    label: 'GitHub Copilot CLI',
    mcp: () => ({
      file: '.github/mcp.json',
      scope: 'project',
      lang: 'json',
      text: json({
        mcpServers: {
          pxsig: { type: 'local', command: 'node', args: [SCRIPT, 'mcp'], tools: ['*'] },
        },
      }),
    }),
    instructions: instruction('.github/copilot-instructions.md'),
    policy: 'The MCP registry allowlist (Copilot CLI 1.0.11 and later).',
    notes: [
      'Copilot CLI does not read .vscode/mcp.json. It loads the server after the folder is trusted.',
    ],
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    mcp: () => ({
      file: '.mcp.json',
      scope: 'project',
      lang: 'json',
      text: json({ mcpServers: { pxsig: { command: 'node', args: [SCRIPT, 'mcp'] } } }),
    }),
    instructions: instruction('CLAUDE.md'),
    policy: 'managed-mcp.json and allowedMcpServers.',
    notes: ["Claude Code asks before it uses a project's servers."],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    mcp: () => ({
      file: '.cursor/mcp.json',
      scope: 'project',
      lang: 'json',
      text: json({
        mcpServers: { pxsig: { command: 'node', args: ['${workspaceFolder}/' + SCRIPT, 'mcp'] } },
      }),
    }),
    instructions: instruction('AGENTS.md'),
    policy: 'The Cursor enterprise MCP allowlist.',
    notes: ['Cursor asks before a tool is used.'],
  },
  {
    id: 'windsurf',
    label: 'Windsurf (Devin Desktop)',
    mcp: (repo) => ({
      file: '~/.config/devin/mcp_config.json (Windows: %APPDATA%\\devin\\mcp_config.json)',
      scope: 'user',
      lang: 'json',
      text: json({ mcpServers: { pxsig: { command: 'node', args: [abs(repo), 'mcp'] } } }),
    }),
    instructions: instruction('AGENTS.md'),
    policy: 'The team admin MCP toggle and allowlist.',
    notes: ['This file is in the home folder: add the entry by hand. It takes an absolute path.'],
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    mcp: () => ({
      file: '.gemini/settings.json',
      scope: 'project',
      lang: 'json',
      text: json({ mcpServers: { pxsig: { command: 'node', args: [SCRIPT, 'mcp'], cwd: '.' } } }),
    }),
    instructions: instruction('GEMINI.md'),
    policy: 'The system settings file.',
    notes: ['Gemini CLI connects only in a trusted folder.'],
  },
  {
    id: 'codex',
    label: 'OpenAI Codex CLI',
    mcp: (repo) => ({
      file: '.codex/config.toml',
      scope: 'project',
      lang: 'toml',
      text: `[mcp_servers.pxsig]\ncommand = "node"\nargs = ["${SCRIPT}", "mcp"]\ncwd = "${repo.replace(/\\/g, '/')}"\n`,
    }),
    instructions: instruction('AGENTS.md'),
    policy: 'Codex enterprise requirements.',
    notes: [
      "Codex reads a project's .codex/config.toml only in a trusted project. cwd is absolute.",
    ],
  },
  {
    id: 'cline',
    label: 'Cline',
    mcp: (repo) => ({
      file: 'cline_mcp_settings.json (Cline: MCP Servers → Configure)',
      scope: 'user',
      lang: 'json',
      text: json({ mcpServers: { pxsig: { command: 'node', args: [abs(repo), 'mcp'] } } }),
    }),
    instructions: instruction('.clinerules/pxsig.md'),
    policy: null,
    notes: ['Cline keeps its servers in its own settings file: add the entry there by hand.'],
  },
  {
    id: 'roo-code',
    label: 'Roo Code',
    mcp: () => ({
      file: '.roo/mcp.json',
      scope: 'project',
      lang: 'json',
      text: json({ mcpServers: { pxsig: { command: 'node', args: [SCRIPT, 'mcp'] } } }),
    }),
    instructions: instruction('.roo/rules/pxsig.md'),
    policy: null,
    notes: [],
  },
  {
    id: 'continue',
    label: 'Continue',
    mcp: () => ({
      file: '.continue/mcpServers/pxsig.yaml',
      scope: 'project',
      lang: 'yaml',
      text: `name: pxsig\nversion: 0.0.1\nschema: v1\nmcpServers:\n  - name: pxsig\n    command: node\n    args:\n      - ${SCRIPT}\n      - mcp\n`,
    }),
    instructions: instruction('.continue/rules/pxsig.md'),
    policy: null,
    notes: [],
  },
  {
    id: 'zed',
    label: 'Zed',
    mcp: () => ({
      file: '.zed/settings.json',
      scope: 'project',
      lang: 'json',
      text: json({ context_servers: { pxsig: { command: 'node', args: [SCRIPT, 'mcp'] } } }),
    }),
    instructions: instruction('AGENTS.md'),
    policy: null,
    notes: [
      "Zed's agent sets no marker in the terminal it runs commands in: pxsig cannot tell it from a person there.",
    ],
  },
  {
    id: 'aider',
    label: 'Aider',
    mcp: () => null,
    instructions: instruction('CONVENTIONS.md'),
    policy: null,
    notes: [
      'Aider has no MCP: it can run `pxsig status --plain` and the other read commands. Load the conventions file with `aider --read CONVENTIONS.md`.',
      'Aider sets no marker in the terminal it runs commands in: pxsig cannot tell it from a person there.',
    ],
  },
  {
    id: 'other',
    label: 'Another assistant',
    mcp: () => ({
      file: "the assistant's MCP settings",
      scope: 'user',
      lang: 'text',
      text: `node ${SCRIPT} mcp   (started in the repository root)\n`,
    }),
    instructions: instruction('AGENTS.md'),
    policy: null,
    notes: [
      'Any MCP client that starts a stdio server works. Without a marker of its own, set PXSIG_AGENT=1 in the shell it runs commands in.',
    ],
  },
  { id: 'none', label: 'None', mcp: () => null, instructions: null, policy: null, notes: [] },
];

export const assistant = (id) => ASSISTANTS.find((a) => a.id === id) ?? null;
